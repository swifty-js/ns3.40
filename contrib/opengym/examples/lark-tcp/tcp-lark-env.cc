/* -*-  Mode: C++; c-file-style: "gnu"; indent-tabs-mode:nil; -*- */
#include "tcp-lark-env.h"

#include "ns3/log.h"
#include "ns3/simulator.h"

#include <algorithm>
#include <limits>

namespace ns3 {

NS_LOG_COMPONENT_DEFINE("ns3::TcpLarkEnv");
NS_OBJECT_ENSURE_REGISTERED(TcpLarkEnv);

// Observation space upper bound (1e9 fits uint64_t and matches Python space)
static constexpr uint64_t OBS_HIGH = 1000000000ULL;

// Clamp a value into [0, OBS_HIGH] to guarantee it fits the declared space.
static inline uint64_t SafeObs(uint64_t v) { return std::min(v, OBS_HIGH); }

// Safely convert a Time to microseconds; negative / uninitialized → 0.
static inline uint64_t SafeTimeUs(const Time &t) {
  if (t <= Time(0) || t == Time::Max()) {
    return 0;
  }
  int64_t us = t.GetMicroSeconds();
  return us > 0 ? SafeObs(static_cast<uint64_t>(us)) : 0;
}

TcpLarkEnv::TcpLarkEnv()
    : TcpGymEnv(), m_calledFunc(CalledFunc_t::INCREASE_WINDOW),
      m_bytesInFlight(0), m_segmentsAcked(0), m_rtt(Time(0)),
      m_caEvent(TcpSocketState::CA_EVENT_TX_START), m_ecnCeCounter(0),
      m_ecnCongestionDetected(false), m_lastEcnTime(Time(0)),
      m_totalBytesAcked(0), m_lastAckTime(Time(0)), m_hasPendingCwnd(false),
      m_pendingCwnd(0) {
  NS_LOG_FUNCTION(this);
}

TcpLarkEnv::~TcpLarkEnv() {
  NS_LOG_FUNCTION(this);
  m_tcb = nullptr;
}

TypeId TcpLarkEnv::GetTypeId(void) {
  static TypeId tid = TypeId("ns3::TcpLarkEnv")
                          .SetParent<TcpGymEnv>()
                          .SetGroupName("OpenGym")
                          .AddConstructor<TcpLarkEnv>();
  return tid;
}

void TcpLarkEnv::DoDispose() {
  NS_LOG_FUNCTION(this);
  m_tcb = nullptr;
  TcpGymEnv::DoDispose();
}

Ptr<OpenGymSpace> TcpLarkEnv::GetObservationSpace() {
  uint32_t parameterNum = 15;
  float low = 0.0;
  float high = static_cast<float>(OBS_HIGH);
  std::vector<uint32_t> shape = {parameterNum};
  std::string dtype = TypeNameGet<uint64_t>();
  Ptr<OpenGymBoxSpace> box =
      CreateObject<OpenGymBoxSpace>(low, high, shape, dtype);
  return box;
}

Ptr<OpenGymDataContainer> TcpLarkEnv::GetObservation() {
  uint32_t parameterNum = 15;
  std::vector<uint32_t> shape = {parameterNum};
  Ptr<OpenGymBoxContainer<uint64_t>> box =
      CreateObject<OpenGymBoxContainer<uint64_t>>(shape);

  // [0] socketUuid  [1] envType  [2] simTime_us  [3] nodeId
  box->AddValue(SafeObs(m_socketUuid));
  box->AddValue(0);
  box->AddValue(SafeObs(static_cast<uint64_t>(
      std::max(int64_t(0), Simulator::Now().GetMicroSeconds()))));
  box->AddValue(SafeObs(m_nodeId));

  if (!m_tcb) {
    // tcb not yet set — fill remaining 11 slots with zeros
    for (uint32_t i = 4; i < parameterNum; i++) {
      box->AddValue(0);
    }
    return box;
  }

  // [4] ssThresh — guard against UINT32_MAX sentinel
  uint64_t ssThresh = m_tcb->m_ssThresh;
  if (ssThresh >= std::numeric_limits<uint32_t>::max()) {
    ssThresh = OBS_HIGH;
  }
  box->AddValue(SafeObs(ssThresh));

  // [5] cWnd
  box->AddValue(SafeObs(m_tcb->m_cWnd));

  // [6] segmentSize — must be > 0 on the Python side; clamp 0 to safe default
  uint64_t segSize = m_tcb->m_segmentSize;
  if (segSize == 0) {
    segSize = 1;
  }
  box->AddValue(SafeObs(segSize));

  // [7] segmentsAcked
  box->AddValue(SafeObs(m_segmentsAcked));

  // [8] bytesInFlight
  box->AddValue(SafeObs(m_bytesInFlight));

  // [9] lastRtt_us — negative / zero means "not available"
  box->AddValue(SafeTimeUs(m_rtt));

  // [10] minRtt_us
  box->AddValue(SafeTimeUs(m_tcb->m_minRtt));

  // [11] calledFunc (enum 0..4)
  box->AddValue(static_cast<uint64_t>(m_calledFunc));

  // [12] congState (enum 0..5)
  box->AddValue(static_cast<uint64_t>(m_tcb->m_congState));

  // [13] caEvent (enum 0..7)
  box->AddValue(static_cast<uint64_t>(m_caEvent));

  // [14] ecnState (enum 0..5)
  box->AddValue(static_cast<uint64_t>(m_tcb->m_ecnState));

  return box;
}

void TcpLarkEnv::TxPktTrace(Ptr<const Packet>, const TcpHeader &,
                            Ptr<const TcpSocketBase>) {}

void TcpLarkEnv::RxPktTrace(Ptr<const Packet>, const TcpHeader &,
                            Ptr<const TcpSocketBase>) {}

uint32_t TcpLarkEnv::GetSsThresh(Ptr<const TcpSocketState> tcb,
                                 uint32_t bytesInFlight) {
  NS_LOG_FUNCTION(this << bytesInFlight);

  if (!tcb) {
    NS_LOG_WARN("GetSsThresh called with null tcb");
    return std::max(bytesInFlight / 2, 1u);
  }

  m_calledFunc = CalledFunc_t::GET_SS_THRESH;
  m_tcb = tcb;
  m_bytesInFlight = bytesInFlight;
  m_segmentsAcked = 0;
  m_rtt = Time(0);

  // Safe defaults before Notify — Python may set new values via ExecuteActions
  uint32_t segSize = std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);
  m_new_ssThresh =
      std::max(static_cast<uint32_t>(tcb->m_ssThresh), 2u * segSize);
  m_new_cWnd = std::max(static_cast<uint32_t>(tcb->m_cWnd), 2u * segSize);

  if (tcb->m_ecnState == TcpSocketState::ECN_CE_RCVD ||
      tcb->m_ecnState == TcpSocketState::ECN_ECE_RCVD) {
    m_ecnCongestionDetected = true;
    m_ecnCeCounter++;
    m_lastEcnTime = Simulator::Now();
  }

  if (m_ecnCongestionDetected) {
    m_envReward = -5.0;
    m_ecnCongestionDetected = false;
  } else {
    m_envReward = -15.0;
  }

  Notify();

  // Validate Python's action: ensure ssThresh and cwnd are sane
  uint32_t minWnd = 2 * segSize;
  m_new_ssThresh = std::max(m_new_ssThresh, minWnd);
  m_new_cWnd = std::max(m_new_cWnd, minWnd);

  // Cache Python's cwnd decision; apply in next IncreaseWindow call
  // (GetSsThresh receives const tcb, cannot modify cwnd directly)
  m_hasPendingCwnd = true;
  m_pendingCwnd = m_new_cWnd;

  return m_new_ssThresh;
}

void TcpLarkEnv::IncreaseWindow(Ptr<TcpSocketState> tcb,
                                uint32_t segmentsAcked) {
  NS_LOG_FUNCTION(this << segmentsAcked);

  if (!tcb) {
    NS_LOG_WARN("IncreaseWindow called with null tcb");
    return;
  }

  uint32_t segSize = std::max(static_cast<uint32_t>(tcb->m_segmentSize), 1u);

  // Apply deferred cwnd from GetSsThresh if pending
  if (m_hasPendingCwnd) {
    uint32_t safePending = std::max(m_pendingCwnd, 2u * segSize);
    tcb->m_cWnd = safePending;
    m_hasPendingCwnd = false;
    NS_LOG_INFO("Applied deferred cwnd=" << safePending << " from GetSsThresh");
  }

  m_calledFunc = CalledFunc_t::INCREASE_WINDOW;
  m_tcb = tcb;
  m_segmentsAcked = segmentsAcked;
  m_bytesInFlight = tcb->m_bytesInFlight;
  m_totalBytesAcked += static_cast<uint64_t>(segmentsAcked) * segSize;

  // Safe defaults before Notify
  m_new_ssThresh =
      std::max(static_cast<uint32_t>(tcb->m_ssThresh), 2u * segSize);
  m_new_cWnd = std::max(static_cast<uint32_t>(tcb->m_cWnd), 2u * segSize);

  // Throughput-first reward: high bonus for acked data, mild RTT penalty
  float throughputBonus = static_cast<float>(segmentsAcked) * 1.0f;

  float rttPenalty = 0.0f;
  if (m_rtt > Time(0) && tcb->m_minRtt > Time(0) &&
      tcb->m_minRtt != Time::Max()) {
    double rttRatio = m_rtt.GetDouble() / tcb->m_minRtt.GetDouble();
    if (rttRatio > 2.0) {
      rttPenalty = static_cast<float>((rttRatio - 1.5) * 0.5);
    }
  }

  m_envReward = throughputBonus - rttPenalty;
  m_lastAckTime = Simulator::Now();

  Notify();

  // Validate and apply Python's action
  uint32_t minWnd = 2 * segSize;
  m_new_cWnd = std::max(m_new_cWnd, minWnd);
  tcb->m_cWnd = m_new_cWnd;
}

void TcpLarkEnv::PktsAcked(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked,
                           const Time &rtt) {
  NS_LOG_FUNCTION(this << segmentsAcked << rtt);

  if (!tcb) {
    NS_LOG_WARN("PktsAcked called with null tcb");
    return;
  }

  m_tcb = tcb;
  m_segmentsAcked = segmentsAcked;
  // Only accept positive RTT values
  m_rtt = (rtt > Time(0)) ? rtt : Time(0);
}

void TcpLarkEnv::CongestionStateSet(
    Ptr<TcpSocketState> tcb, const TcpSocketState::TcpCongState_t newState) {
  NS_LOG_FUNCTION(this << newState);

  if (!tcb) {
    NS_LOG_WARN("CongestionStateSet called with null tcb");
    return;
  }

  m_tcb = tcb;
}

void TcpLarkEnv::CwndEvent(Ptr<TcpSocketState> tcb,
                           const TcpSocketState::TcpCAEvent_t event) {
  NS_LOG_FUNCTION(this << event);

  if (!tcb) {
    NS_LOG_WARN("CwndEvent called with null tcb");
    return;
  }

  m_tcb = tcb;
  m_caEvent = event;

  switch (event) {
  case TcpSocketState::CA_EVENT_ECN_IS_CE:
    m_ecnCeCounter++;
    m_ecnCongestionDetected = true;
    m_lastEcnTime = Simulator::Now();
    break;
  case TcpSocketState::CA_EVENT_ECN_NO_CE:
    m_ecnCongestionDetected = false;
    break;
  default:
    break;
  }
}

} // namespace ns3
