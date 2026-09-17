#include "tcp-swift.h"

#include "ns3/log.h"
#include "ns3/simulator.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace ns3 {

NS_LOG_COMPONENT_DEFINE("TcpSwift");
NS_OBJECT_ENSURE_REGISTERED(TcpSwift);

TypeId TcpSwift::GetTypeId() {
  static TypeId tid = TypeId("ns3::TcpSwift")
                          .SetParent<TcpCongestionOps>()
                          .SetGroupName("Internet")
                          .AddConstructor<TcpSwift>();
  return tid;
}

TcpSwift::TcpSwift() = default;

TcpSwift::TcpSwift(const TcpSwift &other)
    : TcpCongestionOps(other), m_alpha(other.m_alpha),
      m_alphaMin(other.m_alphaMin), m_alphaMax(other.m_alphaMax),
      m_gamma(other.m_gamma), m_betaLoss(other.m_betaLoss),
      m_betaEcn(other.m_betaEcn), m_betaTimeout(other.m_betaTimeout) {}

TcpSwift::~TcpSwift() = default;

std::string TcpSwift::GetName() const { return "TcpSwift"; }

Ptr<TcpCongestionOps> TcpSwift::Fork() { return CopyObject<TcpSwift>(this); }

void TcpSwift::UpdateMeasurements(Ptr<const TcpSocketState> tcb,
                                  uint32_t segmentsAcked) {
  const uint64_t nowUs =
      static_cast<uint64_t>(Simulator::Now().GetMicroSeconds());
  const uint32_t segmentSize =
      std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);

  if (m_lastRtt > Time(0)) {
    const double lastRttUs = static_cast<double>(m_lastRtt.GetMicroSeconds());
    if (m_minRttUs == 0.0 || lastRttUs < m_minRttUs) {
      m_minRttUs = lastRttUs;
    }
    if (m_inSlowStart &&
        (m_slowStartMinRttUs == 0.0 || lastRttUs < m_slowStartMinRttUs)) {
      m_slowStartMinRttUs = lastRttUs;
    }
  }

  if (tcb->m_minRtt > Time(0) && tcb->m_minRtt != Time::Max()) {
    const double socketMinRttUs =
        static_cast<double>(tcb->m_minRtt.GetMicroSeconds());
    if (m_minRttUs == 0.0 || socketMinRttUs < m_minRttUs) {
      m_minRttUs = socketMinRttUs;
    }
  }

  if (segmentsAcked == 0) {
    return;
  }

  m_totalAckedBytes += static_cast<uint64_t>(segmentsAcked) * segmentSize;
  m_ackSamples.push_back({nowUs, m_totalAckedBytes});
  if (m_ackSamples.size() > ACK_WINDOW_CAPACITY) {
    m_ackSamples.pop_front();
  }

  uint64_t windowUs = 5000;
  if (m_minRttUs > 0.0) {
    windowUs =
        static_cast<uint64_t>(std::clamp(2.0 * m_minRttUs, 5000.0, 1000000.0));
  }
  while (m_ackSamples.size() >= 2 &&
         nowUs - m_ackSamples.front().timeUs > windowUs) {
    m_ackSamples.pop_front();
  }

  if (m_ackSamples.size() >= 2) {
    const uint64_t spanUs = nowUs - m_ackSamples.front().timeUs;
    const uint64_t deliveredBytes =
        m_totalAckedBytes - m_ackSamples.front().totalBytes;
    if (spanUs > 0 && deliveredBytes > 0) {
      const double deliveryRate = deliveredBytes / (spanUs / 1e6);
      m_bandwidthSamples.push_back(deliveryRate);
      if (m_bandwidthSamples.size() > BW_WINDOW_LENGTH) {
        m_bandwidthSamples.pop_front();
      }
      m_maxBandwidth = *std::max_element(m_bandwidthSamples.begin(),
                                         m_bandwidthSamples.end());
    }
  }

  if (m_maxBandwidth > 0.0 && m_minRttUs > 0.0) {
    m_bdpBytes = m_maxBandwidth * (m_minRttUs / 1e6);
  }
}

double TcpSwift::GetBdp(uint32_t cWnd) const {
  return m_bdpBytes > 0.0 ? m_bdpBytes : std::max(cWnd, 1u);
}

double TcpSwift::GetHyStartThreshold() const {
  if (m_minRttUs <= 0.0) {
    return 1.25;
  }
  const double minRttMs = m_minRttUs / 1000.0;
  if (minRttMs <= 1.0) {
    return 1.25;
  }
  if (minRttMs <= 5.0) {
    return 1.30;
  }
  return 1.40;
}

void TcpSwift::AdaptAlpha(double reward) {
  if (m_lastRtt > Time(0) && m_minRttUs > 0.0) {
    const double minRttMs = m_minRttUs / 1000.0;
    const double slack = 0.3 + 0.15 * std::sqrt(std::max(0.0, minRttMs - 1.0));
    const double rttRatio = m_lastRtt.GetMicroSeconds() / m_minRttUs;
    const double lowThreshold = 1.0 + slack;
    const double middleThreshold = 1.0 + 2.0 * slack;
    const double highThreshold = 1.0 + 4.0 * slack;

    if (rttRatio < lowThreshold) {
      const double ramp = minRttMs > 5.0 ? 0.02 : 0.03;
      m_alpha = std::min(m_alpha + ramp, m_alphaMax);
      m_consecutiveIncreases++;
    } else if (rttRatio < middleThreshold) {
      m_alpha = std::min(m_alpha + 0.01, m_alphaMax);
    } else if (rttRatio > highThreshold) {
      const double step = minRttMs > 5.0 ? 0.03 : 0.02;
      m_alpha = std::max(m_alpha - step, m_alphaMin);
      m_consecutiveIncreases = 0;
    }
  }

  if (!m_rewardInitialized) {
    m_rewardEma = reward;
    m_rewardBaseline = reward;
    m_rewardInitialized = true;
  } else {
    m_rewardEma = 0.85 * m_rewardEma + 0.15 * reward;
    m_rewardBaseline = 0.98 * m_rewardBaseline + 0.02 * reward;
  }

  const double margin = std::max(0.25, 0.1 * std::abs(m_rewardBaseline));
  if (m_rewardEma > m_rewardBaseline + margin) {
    m_alpha = std::min(m_alpha + 0.01, m_alphaMax);
  } else if (m_rewardEma < m_rewardBaseline - 4.0 * margin) {
    m_alpha = std::max(m_alpha - 0.01, m_alphaMin);
  }

  if (m_consecutiveIncreases > 8) {
    m_alpha = std::min(m_alpha + 0.01, m_alphaMax);
  }
}

TcpSwift::CongestionType
TcpSwift::ClassifyCongestion(Ptr<const TcpSocketState> tcb) const {
  if (tcb->m_congState == TcpSocketState::CA_LOSS) {
    return CongestionType::TIMEOUT;
  }
  if (tcb->m_ecnState == TcpSocketState::ECN_CE_RCVD ||
      tcb->m_ecnState == TcpSocketState::ECN_ECE_RCVD ||
      tcb->m_congState == TcpSocketState::CA_CWR) {
    return CongestionType::ECN;
  }
  return CongestionType::LOSS;
}

TcpSwift::WindowDecision
TcpSwift::ComputeCongestionResponse(Ptr<const TcpSocketState> tcb,
                                    CongestionType type) {
  const uint32_t cWnd = tcb->m_cWnd;
  const uint32_t segmentSize =
      std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);
  const uint32_t minCwnd = 4 * segmentSize;

  m_consecutiveDecreases++;
  m_consecutiveIncreases = 0;
  m_freezeAcksRemaining = 4;

  if (m_consecutiveDecreases > 3) {
    const uint32_t heldCwnd = std::max(cWnd, minCwnd);
    return {heldCwnd, heldCwnd};
  }

  double beta = m_betaLoss;
  if (type == CongestionType::TIMEOUT) {
    beta = m_betaTimeout;
    m_inSlowStart = true;
    m_slowStartMinRttUs = 0.0;
  } else if (type == CongestionType::ECN) {
    beta = m_betaEcn;
  }

  const double bdp = GetBdp(cWnd);
  const uint32_t newCwnd =
      std::max(static_cast<uint32_t>(beta * cWnd), minCwnd);
  const double reference = std::min(
      static_cast<double>(cWnd), std::max(bdp, static_cast<double>(minCwnd)));
  const uint32_t newSsThresh =
      std::max(static_cast<uint32_t>(beta * reference), newCwnd);
  return {newSsThresh, newCwnd};
}

TcpSwift::WindowDecision
TcpSwift::ComputeWindowIncrease(Ptr<const TcpSocketState> tcb,
                                uint32_t segmentsAcked) {
  const uint32_t ssThresh = tcb->m_ssThresh;
  const uint32_t cWnd = tcb->m_cWnd;
  const uint32_t segmentSize =
      std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);
  const double bdp = GetBdp(cWnd);

  if (m_freezeAcksRemaining > 0) {
    m_freezeAcksRemaining--;
    return {ssThresh, cWnd};
  }

  m_consecutiveDecreases = 0;

  if (cWnd < ssThresh && m_inSlowStart) {
    if (m_lastRtt > Time(0) && m_slowStartMinRttUs > 0.0 &&
        m_lastRtt.GetMicroSeconds() >
            GetHyStartThreshold() * m_slowStartMinRttUs) {
      m_inSlowStart = false;
      return {std::max(ssThresh, cWnd), cWnd};
    }

    const uint64_t target = std::max<uint64_t>(static_cast<uint64_t>(2.0 * bdp),
                                               10ULL * segmentSize);
    uint64_t increase = static_cast<uint64_t>(segmentsAcked) * segmentSize;
    if (cWnd < 0.3 * bdp && m_minRttUs > 0.0 && m_lastRtt > Time(0) &&
        m_lastRtt.GetMicroSeconds() < 1.2 * m_minRttUs) {
      increase *= 2;
    }

    const uint64_t grown =
        std::min<uint64_t>(static_cast<uint64_t>(cWnd) + increase, target);
    const uint32_t newCwnd = static_cast<uint32_t>(
        std::min<uint64_t>(grown, std::numeric_limits<uint32_t>::max()));
    if (grown >= target) {
      m_inSlowStart = false;
      return {newCwnd, newCwnd};
    }
    return {ssThresh, newCwnd};
  }

  m_inSlowStart = false;
  const uint64_t targetRate = static_cast<uint64_t>(m_alpha * bdp);
  const uint64_t gammaBytes = std::max<uint64_t>(
      static_cast<uint64_t>(m_gamma * segmentSize), segmentSize);
  uint64_t newCwnd = cWnd;

  if (targetRate > cWnd) {
    const uint64_t gap = targetRate - cWnd;
    const uint64_t step =
        std::max({gammaBytes, static_cast<uint64_t>(segmentSize), gap / 16});
    newCwnd = std::min<uint64_t>(static_cast<uint64_t>(cWnd) + step,
                                 targetRate + gammaBytes);
  } else if (targetRate < cWnd) {
    const uint64_t excess = cWnd - targetRate;
    newCwnd = std::max<uint64_t>(
        cWnd - std::max<uint64_t>(excess / 2, segmentSize), targetRate);
  } else {
    newCwnd = static_cast<uint64_t>(cWnd) + gammaBytes;
  }

  if (tcb->m_bytesInFlight > 0 && cWnd > 0 && m_lastRtt > Time(0) &&
      m_minRttUs > 0.0) {
    const double utilization = static_cast<double>(tcb->m_bytesInFlight) / cWnd;
    const bool rttOk = m_lastRtt.GetMicroSeconds() < 1.3 * m_minRttUs;
    if (rttOk) {
      const bool longRtt = m_minRttUs > 5000.0;
      if (utilization < 0.4) {
        newCwnd += longRtt ? segmentSize : 2ULL * segmentSize;
      } else if (utilization < 0.5 && !longRtt) {
        newCwnd += segmentSize;
      }
    }
  }

  return {ssThresh, static_cast<uint32_t>(std::min<uint64_t>(
                        newCwnd, std::numeric_limits<uint32_t>::max()))};
}

TcpSwift::WindowDecision
TcpSwift::ApplySafetyBounds(Ptr<const TcpSocketState> tcb,
                            WindowDecision decision) const {
  const uint64_t segmentSize =
      std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);
  const uint64_t minCwnd = 4 * segmentSize;
  const double bdp = GetBdp(tcb->m_cWnd);
  const uint64_t maxCwnd =
      std::max<uint64_t>(static_cast<uint64_t>(4.0 * bdp), 200 * segmentSize);
  decision.cWnd = static_cast<uint32_t>(std::clamp<uint64_t>(
      decision.cWnd, minCwnd,
      std::min<uint64_t>(maxCwnd, std::numeric_limits<uint32_t>::max())));
  decision.ssThresh =
      static_cast<uint32_t>(std::max<uint64_t>(decision.ssThresh, minCwnd));
  return decision;
}

uint32_t TcpSwift::GetSsThresh(Ptr<const TcpSocketState> tcb,
                               uint32_t bytesInFlight) {
  if (!tcb) {
    return std::max(bytesInFlight / 2, 1u);
  }

  UpdateMeasurements(tcb, 0);

  double reward = -10.0;
  if (m_ecnCongestionDetected) {
    reward = -3.0;
    m_ecnCongestionDetected = false;
  } else if (tcb->m_congState == TcpSocketState::CA_LOSS) {
    reward = -20.0;
  }
  AdaptAlpha(reward);

  WindowDecision decision = ApplySafetyBounds(
      tcb, ComputeCongestionResponse(tcb, ClassifyCongestion(tcb)));
  m_hasPendingCwnd = true;
  m_pendingCwnd = decision.cWnd;
  return decision.ssThresh;
}

void TcpSwift::IncreaseWindow(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked) {
  if (!tcb) {
    return;
  }

  const uint32_t segmentSize =
      std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);
  if (m_hasPendingCwnd) {
    tcb->m_cWnd = std::max(m_pendingCwnd, 2 * segmentSize);
    m_hasPendingCwnd = false;
  }

  UpdateMeasurements(tcb, segmentsAcked);

  double reward = std::min(static_cast<double>(segmentsAcked) * 0.5, 5.0);
  if (m_lastRtt > Time(0) && tcb->m_minRtt > Time(0) &&
      tcb->m_minRtt != Time::Max()) {
    const double rttRatio = m_lastRtt.GetDouble() / tcb->m_minRtt.GetDouble();
    if (rttRatio > 1.5) {
      reward -= std::min((rttRatio - 1.5) * 0.3, 3.0);
    }
  }
  AdaptAlpha(reward);

  WindowDecision decision;
  if (tcb->m_ecnState == TcpSocketState::ECN_CE_RCVD ||
      tcb->m_ecnState == TcpSocketState::ECN_ECE_RCVD) {
    decision = ComputeCongestionResponse(tcb, CongestionType::ECN);
  } else {
    decision = ComputeWindowIncrease(tcb, segmentsAcked);
  }
  decision = ApplySafetyBounds(tcb, decision);
  tcb->m_cWnd = decision.cWnd;
}

void TcpSwift::PktsAcked(Ptr<TcpSocketState> tcb, uint32_t, const Time &rtt) {
  if (tcb && rtt > Time(0)) {
    m_lastRtt = rtt;
  }
}

void TcpSwift::CongestionStateSet(
    Ptr<TcpSocketState>, const TcpSocketState::TcpCongState_t newState) {
  if (newState == TcpSocketState::CA_LOSS) {
    m_hasPendingCwnd = false;
  }
}

void TcpSwift::CwndEvent(Ptr<TcpSocketState>,
                         const TcpSocketState::TcpCAEvent_t event) {
  if (event == TcpSocketState::CA_EVENT_ECN_IS_CE) {
    m_ecnCongestionDetected = true;
  } else if (event == TcpSocketState::CA_EVENT_ECN_NO_CE) {
    m_ecnCongestionDetected = false;
  }
}

} // namespace ns3
