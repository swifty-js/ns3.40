/* -*-  Mode: C++; c-file-style: "gnu"; indent-tabs-mode:nil; -*- */
#ifndef TCP_LARK_H
#define TCP_LARK_H

#include "../rl-tcp/tcp-rl.h" // Inherit base logic from RL example
#include "tcp-swift-env.h"

namespace ns3 {

class TcpSwift : public TcpRlBase {
public:
  static TypeId GetTypeId(void);

  TcpSwift();
  TcpSwift(const TcpSwift &sock);
  ~TcpSwift();

  virtual std::string GetName() const;
  virtual Ptr<TcpCongestionOps> Fork();

private:
  virtual void CreateGymEnv();
};

} // namespace ns3

#endif /* TCP_LARK_H */
