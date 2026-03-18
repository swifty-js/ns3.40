"""
Lark TCP Congestion Control Algorithm - Deep Optimized Implementation

Optimization priority:
  1. Maximize throughput (primary)
  2. Minimize transmission delay (secondary)
  3. Minimize loss/retransmission rate (tertiary)
  4. Inter-flow fairness (quaternary)

Core design:
  - Accurate BDP estimation using windowed max-filter on delivery rate
  - Aggressive slow start with 2x BDP target
  - AIMD-style congestion avoidance: V_t = max(alpha*BDP, W) + gamma*MSS
  - Differentiated congestion response: ECN (mild) vs Loss (moderate)
  - Reward-aware online alpha adaptation for throughput maximization
  - Consecutive-decrease protection with exponential backoff limit
"""

import logging
from collections import deque
from tcp_base import TcpEventBased

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("TcpLark")
logger.setLevel(logging.WARNING)


class TcpLark(TcpEventBased):
    # ECN State Constants
    ECN_DISABLED = 0
    ECN_IDLE = 1
    ECN_CE_RCVD = 2
    ECN_SENDING_ECE = 3
    ECN_ECE_RCVD = 4
    ECN_CWR_SENT = 5

    # CA State Constants
    CA_OPEN = 0
    CA_DISORDER = 1
    CA_CWR = 2
    CA_RECOVERY = 3
    CA_LOSS = 4

    # CA Event Constants
    CA_EVENT_TX_START = 0
    CA_EVENT_CWND_RESTART = 1
    CA_EVENT_COMPLETE_CWR = 2
    CA_EVENT_LOSS = 3
    CA_EVENT_ECN_NO_CE = 4
    CA_EVENT_ECN_IS_CE = 5

    # Called Function Constants
    FUNC_GET_SS_THRESH = 0
    FUNC_INCREASE_WINDOW = 1

    def __init__(self):
        super(TcpLark, self).__init__()

        # --- Core parameters (throughput-optimized) ---
        self.alpha_base = 1.50  # Target cwnd = alpha * BDP
        self.alpha_min = 1.20
        self.alpha_max = 2.00
        self.gamma = 3.0  # Additive increase: gamma * MSS per ACK event

        # Multiplicative decrease factors (window retention ratios)
        self.beta_loss = 0.80  # Retain 80% on packet loss
        self.beta_ecn = 0.90  # Retain 90% on ECN (milder, proactive)
        self.beta_timeout = 0.60  # Retain 60% on timeout (severe)

        # Consecutive decrease protection
        self.max_consecutive_decreases = 3

        # BDP estimation window
        self.bw_window_len = 20  # Windowed max-filter length for bandwidth
        self.rtt_window_len = 40  # Recent RTT samples for statistics

        # Per-flow state
        self.flow_states = {}

        # Reward-based adaptation
        self.reward_ema = 0.0  # Exponential moving average of reward
        self.reward_alpha = 0.1  # EMA smoothing factor

    def _get_flow_state(self, socket_uuid):
        if socket_uuid not in self.flow_states:
            self.flow_states[socket_uuid] = {
                # Bandwidth estimation (windowed max-filter)
                "bw_samples": deque(maxlen=self.bw_window_len),
                "max_bw": 0.0,  # Max observed delivery rate (B/s)
                # RTT tracking
                "rtt_samples": deque(maxlen=self.rtt_window_len),
                "min_rtt_us": float("inf"),  # Baseline propagation RTT
                # BDP
                "bdp": 0.0,
                # Adaptive alpha (per-flow)
                "alpha": self.alpha_base,
                # Congestion counters
                "consecutive_decreases": 0,
                "consecutive_increases": 0,
                "loss_count": 0,
                "ecn_count": 0,
                "last_decrease_time_us": 0,
                # State tracking
                "prev_cwnd": 0,
                "prev_time_us": 0,
                # Throughput tracking for reward adaptation
                "throughput_ema": 0.0,
                # Phase tracking
                "in_slow_start": True,
            }
        return self.flow_states[socket_uuid]

    def _update_bandwidth(self, state, obs):
        """Update windowed max-filter bandwidth estimate."""
        segmentSize = obs[6]
        segmentsAcked = obs[7]
        lastRtt_us = obs[9]
        minRtt_us = obs[10]

        # Update min RTT
        if lastRtt_us > 0:
            state["rtt_samples"].append(lastRtt_us)
            if lastRtt_us < state["min_rtt_us"]:
                state["min_rtt_us"] = lastRtt_us

        if minRtt_us > 0 and minRtt_us < state["min_rtt_us"]:
            state["min_rtt_us"] = minRtt_us

        # Compute delivery rate: bytes_delivered / RTT
        if lastRtt_us > 0 and segmentsAcked > 0 and segmentSize > 0:
            delivery_rate = (segmentsAcked * segmentSize) / (lastRtt_us / 1e6)
            state["bw_samples"].append(delivery_rate)
            # Windowed max
            state["max_bw"] = max(state["bw_samples"])
            # Throughput EMA
            if state["throughput_ema"] == 0:
                state["throughput_ema"] = delivery_rate
            else:
                state["throughput_ema"] = (
                    0.9 * state["throughput_ema"] + 0.1 * delivery_rate
                )

        # Update BDP = max_bw * min_rtt
        if state["max_bw"] > 0 and state["min_rtt_us"] < float("inf"):
            state["bdp"] = state["max_bw"] * (state["min_rtt_us"] / 1e6)

    def _get_bdp(self, state, cWnd):
        """Get BDP with safe fallback."""
        if state["bdp"] > 0:
            return state["bdp"]
        # Fallback: assume cwnd is close to BDP (conservative)
        return max(cWnd, 1)

    def _adapt_alpha(self, state, obs, reward):
        """Adapt alpha based on RTT inflation and reward signal."""
        lastRtt_us = obs[9]
        alpha = state["alpha"]

        # Factor 1: RTT ratio feedback
        if (
            lastRtt_us > 0
            and state["min_rtt_us"] > 0
            and state["min_rtt_us"] < float("inf")
        ):
            rtt_ratio = lastRtt_us / state["min_rtt_us"]

            if rtt_ratio < 1.5:
                # Minimal queuing -> increase aggressiveness
                alpha = min(alpha + 0.05, self.alpha_max)
                state["consecutive_increases"] += 1
            elif rtt_ratio < 2.5:
                # Moderate queuing -> gentle increase
                alpha = min(alpha + 0.02, self.alpha_max)
            elif rtt_ratio > 4.0:
                # Heavy queuing -> reduce
                alpha = max(alpha - 0.02, self.alpha_min)
                state["consecutive_increases"] = 0

        # Factor 2: Reward signal from C++ env
        if reward is not None:
            self.reward_ema = (
                1 - self.reward_alpha
            ) * self.reward_ema + self.reward_alpha * float(reward)
            # Positive reward trend -> more aggressive
            if self.reward_ema > 2.0:
                alpha = min(alpha + 0.01, self.alpha_max)
            elif self.reward_ema < -5.0:
                alpha = max(alpha - 0.01, self.alpha_min)

        # Factor 3: Stable growth bonus
        if state["consecutive_increases"] > 5:
            alpha = min(alpha + 0.02, self.alpha_max)

        state["alpha"] = alpha
        return alpha

    def _detect_congestion(self, obs, state):
        """
        Detect congestion from observation signals.

        Returns:
            (is_congested, congestion_type)
            congestion_type: "loss" | "ecn" | "timeout" | None
        """
        calledFunc = obs[11]
        caState = obs[12]
        ecnState = obs[14]

        # Signal 1: Explicit loss (GetSsThresh called)
        if calledFunc == self.FUNC_GET_SS_THRESH:
            state["loss_count"] += 1
            if caState == self.CA_LOSS:
                return True, "timeout"
            return True, "loss"

        # Signal 2: ECN CE received during IncreaseWindow
        if ecnState in (self.ECN_CE_RCVD, self.ECN_ECE_RCVD):
            state["ecn_count"] += 1
            return True, "ecn"

        return False, None

    def _congestion_response(self, obs, state, cong_type):
        """
        Compute cwnd and ssThresh on congestion event.
        Differentiated response by congestion type.
        Consecutive decrease protection prevents over-reduction.
        """
        cWnd = obs[5]
        segmentSize = obs[6]
        simTime_us = obs[2]
        bdp = self._get_bdp(state, cWnd)
        min_cwnd = max(4 * segmentSize, 1)

        # Consecutive decrease protection
        state["consecutive_decreases"] += 1
        state["consecutive_increases"] = 0

        if state["consecutive_decreases"] > self.max_consecutive_decreases:
            # Too many consecutive reductions -> hold current window
            new_cwnd = max(cWnd, min_cwnd)
            new_ssThresh = new_cwnd
            return new_ssThresh, new_cwnd

        if cong_type == "timeout":
            beta = self.beta_timeout
        elif cong_type == "ecn":
            beta = self.beta_ecn
        elif cong_type == "loss":
            beta = self.beta_loss
        else:
            beta = self.beta_loss

        new_cwnd = max(int(beta * cWnd), min_cwnd)

        # ssThresh: set to max(new_cwnd, BDP) to allow faster recovery
        new_ssThresh = max(new_cwnd, int(bdp))
        new_ssThresh = max(new_ssThresh, min_cwnd)

        state["last_decrease_time_us"] = simTime_us

        return new_ssThresh, new_cwnd

    def _increase_window(self, obs, state, alpha):
        """
        Compute cwnd increase during non-congestion phase.
        Two modes: slow start (exponential) and congestion avoidance (AIMD).
        """
        ssThresh = obs[4]
        cWnd = obs[5]
        segmentSize = obs[6]
        segmentsAcked = obs[7]
        bytesInFlight = obs[8]
        bdp = self._get_bdp(state, cWnd)

        # Reset consecutive decrease counter
        state["consecutive_decreases"] = 0

        if segmentSize <= 0:
            segmentSize = 1448

        if cWnd < ssThresh and state["in_slow_start"]:
            # === SLOW START ===
            # Target: 3x BDP (more aggressive to reach full capacity faster)
            target_ss = max(int(3.0 * bdp), 20 * segmentSize)

            # Standard exponential: +2 MSS per ACKed segment to boost start
            increase = 2 * segmentsAcked * segmentSize

            # When very far below BDP, accelerate heavily
            if bdp > 0 and cWnd < 0.5 * bdp:
                increase = 4 * segmentsAcked * segmentSize

            new_cwnd = min(cWnd + increase, target_ss)

            # If we've reached target, exit slow start
            if new_cwnd >= target_ss:
                state["in_slow_start"] = False
                new_ssThresh = new_cwnd

            new_ssThresh = ssThresh

        else:
            # === CONGESTION AVOIDANCE ===
            state["in_slow_start"] = False

            # Lark formula: V_t = max(alpha * BDP, W) + gamma * MSS
            target_rate = alpha * bdp
            gamma_bytes = self.gamma * segmentSize

            new_cwnd = int(max(target_rate, cWnd) + gamma_bytes)

            # Utilization-aware boost: if pipe is under-utilized, grow faster
            if bytesInFlight > 0 and cWnd > 0:
                utilization = bytesInFlight / cWnd
                if utilization < 0.8:
                    new_cwnd += 2 * segmentSize
                if utilization < 0.5:
                    new_cwnd += 4 * segmentSize

            new_ssThresh = ssThresh

        return new_ssThresh, new_cwnd

    def get_action(self, obs, reward, done, info):
        """
        Main entry point for congestion control decision.

        Observation vector (15 params from ns-3):
        [0]  socketUuid, [1] envType, [2] simTime_us, [3] nodeId,
        [4]  ssThresh, [5] cWnd, [6] segmentSize, [7] segmentsAcked,
        [8]  bytesInFlight, [9] lastRtt_us, [10] minRtt_us,
        [11] calledFunc, [12] caState, [13] caEvent, [14] ecnState

        Returns: [new_ssThresh, new_cWnd]
        """
        socketUuid = obs[0]
        cWnd = obs[5]
        segmentSize = obs[6]

        state = self._get_flow_state(socketUuid)

        # Update bandwidth/RTT estimates
        self._update_bandwidth(state, obs)

        # Adapt alpha using reward + RTT signals
        alpha = self._adapt_alpha(state, obs, reward)

        # Detect congestion
        is_congested, cong_type = self._detect_congestion(obs, state)

        if is_congested:
            new_ssThresh, new_cWnd = self._congestion_response(obs, state, cong_type)
        else:
            new_ssThresh, new_cWnd = self._increase_window(obs, state, alpha)

        # === Safety bounds ===
        min_cwnd = max(4 * segmentSize, 1) if segmentSize > 0 else 4
        bdp = self._get_bdp(state, cWnd)

        # Max cwnd: generous cap to allow full pipe utilization
        if bdp > 0 and segmentSize > 0:
            max_cwnd = max(int(10 * bdp), 200 * segmentSize)
        else:
            max_cwnd = max(cWnd * 4, 200 * segmentSize if segmentSize > 0 else cWnd * 4)

        new_cWnd = max(min_cwnd, min(new_cWnd, max_cwnd))
        new_ssThresh = max(min_cwnd, new_ssThresh)

        state["prev_cwnd"] = new_cWnd
        state["prev_time_us"] = obs[2]

        return [new_ssThresh, new_cWnd]
