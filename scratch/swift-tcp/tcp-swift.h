#ifndef TCP_SWIFT_H
#define TCP_SWIFT_H

#include "ns3/tcp-congestion-ops.h"
#include "ns3/tcp-socket-state.h"

#include <cstdint>
#include <deque>
#include <string>
#include <utility>

namespace ns3 {

class TcpSwift : public TcpCongestionOps {
public:
  static TypeId GetTypeId();

  TcpSwift();
  TcpSwift(const TcpSwift &other);
  ~TcpSwift() override;

  std::string GetName() const override;
  uint32_t GetSsThresh(Ptr<const TcpSocketState> tcb,
                       uint32_t bytesInFlight) override;
  void IncreaseWindow(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked) override;
  void PktsAcked(Ptr<TcpSocketState> tcb, uint32_t segmentsAcked,
                 const Time &rtt) override;
  void
  CongestionStateSet(Ptr<TcpSocketState> tcb,
                     const TcpSocketState::TcpCongState_t newState) override;
  void CwndEvent(Ptr<TcpSocketState> tcb,
                 const TcpSocketState::TcpCAEvent_t event) override;
  Ptr<TcpCongestionOps> Fork() override;

private:
  enum class CongestionType { LOSS, ECN, TIMEOUT };

  struct AckSample {
    uint64_t timeUs;
    uint64_t totalBytes;
  };

  struct WindowDecision {
    uint32_t ssThresh;
    uint32_t cWnd;
  };

  void UpdateMeasurements(Ptr<const TcpSocketState> tcb,
                          uint32_t segmentsAcked);
  void AdaptAlpha(double reward);
  double GetBdp(uint32_t cWnd) const;
  double GetHyStartThreshold() const;
  CongestionType ClassifyCongestion(Ptr<const TcpSocketState> tcb) const;
  WindowDecision ComputeCongestionResponse(Ptr<const TcpSocketState> tcb,
                                           CongestionType type);
  WindowDecision ComputeWindowIncrease(Ptr<const TcpSocketState> tcb,
                                       uint32_t segmentsAcked);
  WindowDecision ApplySafetyBounds(Ptr<const TcpSocketState> tcb,
                                   WindowDecision decision) const;

  static constexpr std::size_t BW_WINDOW_LENGTH = 40;
  static constexpr std::size_t ACK_WINDOW_CAPACITY = 4096;

  double m_alpha{1.10};
  double m_alphaMin{0.85};
  double m_alphaMax{1.30};
  double m_gamma{1.0};
  double m_betaLoss{0.70};
  double m_betaEcn{0.75};
  double m_betaTimeout{0.50};

  uint32_t m_consecutiveDecreases{0};
  uint32_t m_consecutiveIncreases{0};
  uint32_t m_freezeAcksRemaining{0};
  bool m_inSlowStart{true};

  std::deque<AckSample> m_ackSamples;
  std::deque<double> m_bandwidthSamples;
  uint64_t m_totalAckedBytes{0};
  double m_maxBandwidth{0.0};
  double m_minRttUs{0.0};
  double m_slowStartMinRttUs{0.0};
  double m_bdpBytes{0.0};
  Time m_lastRtt{Time(0)};

  bool m_rewardInitialized{false};
  double m_rewardEma{0.0};
  double m_rewardBaseline{0.0};

  bool m_ecnCongestionDetected{false};
  bool m_hasPendingCwnd{false};
  uint32_t m_pendingCwnd{0};
};

} // namespace ns3

#endif
