/* -*-  Mode: C++; c-file-style: "gnu"; indent-tabs-mode:nil; -*- */
#ifndef TCP_LARK_H
#define TCP_LARK_H

#include "../rl-tcp/tcp-rl.h" // Inherit base logic from RL example
#include "tcp-lark-env.h"

namespace ns3 {

class TcpLark : public TcpRlBase {
public:
  static TypeId GetTypeId(void);

  TcpLark();
  TcpLark(const TcpLark &sock);
  ~TcpLark();

  virtual std::string GetName() const;
  virtual Ptr<TcpCongestionOps> Fork();

private:
  virtual void CreateGymEnv();
};

} // namespace ns3

#endif /* TCP_LARK_H */
