/* -*-  Mode: C++; c-file-style: "gnu"; indent-tabs-mode:nil; -*- */
#include "tcp-swift.h"

#include "ns3/core-module.h"
#include "ns3/log.h"

namespace ns3 {

NS_LOG_COMPONENT_DEFINE("ns3::TcpSwift");
NS_OBJECT_ENSURE_REGISTERED(TcpSwift);

TypeId TcpSwift::GetTypeId(void) {
  static TypeId tid = TypeId("ns3::TcpSwift")
                          .SetParent<TcpRlBase>()
                          .SetGroupName("Internet")
                          .AddConstructor<TcpSwift>();
  return tid;
}

TcpSwift::TcpSwift(void) : TcpRlBase() {}

TcpSwift::TcpSwift(const TcpSwift &sock) : TcpRlBase(sock) {}

TcpSwift::~TcpSwift(void) {}

std::string TcpSwift::GetName() const { return "TcpSwift"; }

Ptr<TcpCongestionOps> TcpSwift::Fork() { return CopyObject<TcpSwift>(this); }

void TcpSwift::CreateGymEnv() {
  NS_LOG_FUNCTION(this);
  Ptr<TcpSwiftEnv> env = CreateObject<TcpSwiftEnv>();
  env->SetSocketUuid(TcpRlBase::GenerateUuid());
  m_tcpGymEnv = env;

  ConnectSocketCallbacks();
}

} // namespace ns3
