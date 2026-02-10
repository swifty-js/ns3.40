/* -*-  Mode: C++; c-file-style: "gnu"; indent-tabs-mode:nil; -*- */
#include "tcp-lark.h"

#include "ns3/core-module.h"
#include "ns3/log.h"

namespace ns3 {

NS_LOG_COMPONENT_DEFINE("ns3::TcpLark");
NS_OBJECT_ENSURE_REGISTERED(TcpLark);

TypeId TcpLark::GetTypeId(void) {
  static TypeId tid = TypeId("ns3::TcpLark")
                          .SetParent<TcpRlBase>()
                          .SetGroupName("Internet")
                          .AddConstructor<TcpLark>();
  return tid;
}

TcpLark::TcpLark(void) : TcpRlBase() {}

TcpLark::TcpLark(const TcpLark &sock) : TcpRlBase(sock) {}

TcpLark::~TcpLark(void) {}

std::string TcpLark::GetName() const { return "TcpLark"; }

Ptr<TcpCongestionOps> TcpLark::Fork() { return CopyObject<TcpLark>(this); }

void TcpLark::CreateGymEnv() {
  NS_LOG_FUNCTION(this);
  Ptr<TcpLarkEnv> env = CreateObject<TcpLarkEnv>();
  env->SetSocketUuid(TcpRlBase::GenerateUuid());
  m_tcpGymEnv = env;

  ConnectSocketCallbacks();
}

} // namespace ns3
