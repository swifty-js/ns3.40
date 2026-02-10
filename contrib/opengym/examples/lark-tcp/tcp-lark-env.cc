/* -*-  Mode: C++; c-file-style: "gnu"; indent-tabs-mode:nil; -*- */
#include "tcp-lark-env.h"

#include "ns3/log.h"
#include "ns3/simulator.h"

namespace ns3 {

NS_LOG_COMPONENT_DEFINE("ns3::TcpLarkEnv");
NS_OBJECT_ENSURE_REGISTERED(TcpLarkEnv);

TcpLarkEnv::TcpLarkEnv()
    : TcpGymEnv(), m_calledFunc(CalledFunc_t::INCREASE_WINDOW),
      m_bytesInFlight(0), m_segmentsAcked(0), m_rtt(Time(0)),
      m_caEvent(TcpSocketState::CA_EVENT_TX_START), m_ecnCeCounter(0),
      m_ecnCongestionDetected(false), m_lastEcnTime(Time(0)),
      m_totalBytesAcked(0), m_lastAckTime(Time(0)), m_hasPendingCwnd(false),
      m_pendingCwnd(0) {
  NS_LOG_FUNCTION(this);
}

TcpLarkEnv::~TcpLarkEnv() { NS_LOG_FUNCTION(this); }

TypeId TcpLarkEnv::GetTypeId(void) {
  static TypeId tid = TypeId("ns3::TcpLarkEnv")
                          .SetParent<TcpGymEnv>()
                          .SetGroupName("OpenGym")
                          .AddConstructor<TcpLarkEnv>();
  return tid;
}

void TcpLarkEnv::DoDispose() { NS_LOG_FUNCTION(this); }

Ptr<OpenGymSpace> TcpLarkEnv::GetObservationSpace() {
  uint32_t parameterNum = 15;
  float low = 0.0;
  float high = 1000000000.0;
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

  box->AddValue(m_socketUuid);
  box->AddValue(0);
  box->AddValue(Simulator::Now().GetMicroSeconds());
  box->AddValue(m_nodeId);

  if (!m_tcb) {
    for (uint32_t i = 4; i < parameterNum; i++) {
      box->AddValue(0);
    }
    return box;
  }

  box->AddValue(m_tcb->m_ssThresh);
  box->AddValue(m_tcb->m_cWnd);
  box->AddValue(m_tcb->m_segmentSize);
  box->AddValue(m_segmentsAcked);
  box->AddValue(m_bytesInFlight);
  box->AddValue(m_rtt.GetMicroSeconds());

  if (m_tcb->m_minRtt == Time::Max()) {
    box->AddValue(0);
  } else {
    box->AddValue(m_tcb->m_minRtt.GetMicroSeconds());
  }

  box->AddValue(m_calledFunc);
  box->AddValue(m_tcb->m_congState);
  box->AddValue(m_caEvent);
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
    return bytesInFlight / 2;
  }

  m_calledFunc = CalledFunc_t::GET_SS_THRESH;
  m_tcb = tcb;
  m_bytesInFlight = bytesInFlight;
  m_segmentsAcked = 0;
  m_rtt = Time(0);

  m_new_ssThresh = tcb->m_ssThresh;
  m_new_cWnd = tcb->m_cWnd;

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

  // Apply deferred cwnd from GetSsThresh if pending
  if (m_hasPendingCwnd) {
    tcb->m_cWnd = m_pendingCwnd;
    m_hasPendingCwnd = false;
    NS_LOG_INFO("Applied deferred cwnd=" << m_pendingCwnd
                                         << " from GetSsThresh");
  }

  m_calledFunc = CalledFunc_t::INCREASE_WINDOW;
  m_tcb = tcb;
  m_segmentsAcked = segmentsAcked;
  m_bytesInFlight = tcb->m_bytesInFlight;
  m_totalBytesAcked += segmentsAcked * tcb->m_segmentSize;

  m_new_ssThresh = tcb->m_ssThresh;
  m_new_cWnd = tcb->m_cWnd;

  // Throughput-first reward: high bonus for acked data, mild RTT penalty
  float throughputBonus = static_cast<float>(segmentsAcked) * 1.0;

  float rttPenalty = 0.0;
  if (m_rtt > Time(0) && tcb->m_minRtt > Time(0) &&
      tcb->m_minRtt != Time::Max()) {
    double rttRatio = m_rtt.GetDouble() / tcb->m_minRtt.GetDouble();
    if (rttRatio > 2.0) {
      rttPenalty = (rttRatio - 1.5) * 0.5;
    }
  }

  m_envReward = throughputBonus - rttPenalty;
  m_lastAckTime = Simulator::Now();

  Notify();
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
  m_rtt = rtt;
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
