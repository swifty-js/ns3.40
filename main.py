#!/usr/bin/env python3
"""
NS-3 Lark TCP 仿真管理工具
功能: 仿真运行 (sim) / 绘图 (draw) / 汇总报告 (summary)
"""

import argparse
import csv
import glob
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# =============================================================================
# 全局默认配置
# =============================================================================
DEFAULT_DURATION = 20
DEFAULT_N_LEAF = 3
DEFAULT_SIM_SEED = 42
DEFAULT_PROTOCOLS = ["TcpLark", "TcpNewReno", "TcpCubic", "TcpBbr"]
AGENT_SCRIPT = "./contrib/opengym/examples/lark-tcp/test_lark.py"

# 34 个场景定义: (场景名, 接入带宽, 瓶颈带宽, 接入延迟, 瓶颈延迟)
SCENARIOS: List[Tuple[str, str, str, str, str]] = [
    # --- 第一类: 数据中心机架内 (Intra-Rack) ---
    ("intra_rack_10g", "25Gbps", "10Gbps", "1us", "2us"),
    ("intra_rack_25g", "25Gbps", "25Gbps", "1us", "2us"),
    # --- 第二类: Leaf-Spine 架构 ---
    ("leaf_spine_20g", "50Gbps", "20Gbps", "2us", "5us"),
    ("leaf_spine_50g", "50Gbps", "50Gbps", "2us", "5us"),
    # --- 第三类: 过载收敛 (Oversubscription) ---
    ("oversub_4to1_10g", "10Gbps", "2.5Gbps", "2us", "5us"),
    ("oversub_4to1_40g", "40Gbps", "10Gbps", "2us", "5us"),
    ("oversub_2to1_25g", "25Gbps", "12.5Gbps", "2us", "5us"),
    ("oversub_2to1_50g", "50Gbps", "25Gbps", "2us", "5us"),
    # --- 第四类: 拥塞程度梯度 ---
    ("congested_light", "10Gbps", "5Gbps", "2us", "5us"),
    ("congested_medium", "10Gbps", "2Gbps", "2us", "5us"),
    ("congested_heavy", "10Gbps", "1Gbps", "2us", "5us"),
    # --- 第五类: 跨 Pod / 跨数据中心 ---
    ("cross_pod_10g", "25Gbps", "10Gbps", "5us", "50us"),
    ("cross_pod_20g", "50Gbps", "20Gbps", "5us", "50us"),
    ("cross_dc_wan", "10Gbps", "1Gbps", "10us", "5ms"),
    # --- 第六类: RDMA 级超低延迟 ---
    ("rdma_like_25g", "25Gbps", "25Gbps", "500ns", "1us"),
    ("rdma_like_50g", "50Gbps", "50Gbps", "500ns", "1us"),
    # --- 第七类: 混合流量与非对称 ---
    ("mixed_small_flow", "10Gbps", "2Gbps", "2us", "10us"),
    ("mixed_large_flow", "50Gbps", "12.5Gbps", "2us", "10us"),
    ("asymmetric_high", "50Gbps", "1Gbps", "1us", "10us"),
    ("symmetric_low", "1Gbps", "1Gbps", "5us", "20us"),
    # --- 第八类: 数据中心带宽扩展 ---
    ("dc_100m", "1Gbps", "100Mbps", "2us", "5us"),
    ("dc_500m", "1Gbps", "500Mbps", "2us", "5us"),
    ("dc_100g", "100Gbps", "100Gbps", "1us", "2us"),
    ("dc_oversub_10to1", "10Gbps", "1Gbps", "2us", "5us"),
    # --- 第九类: 无线 WiFi ---
    ("wifi_ac", "1Gbps", "400Mbps", "1ms", "5ms"),
    ("wifi_ax", "1Gbps", "600Mbps", "1ms", "3ms"),
    ("wifi_n", "100Mbps", "50Mbps", "2ms", "10ms"),
    ("wifi_legacy", "100Mbps", "10Mbps", "5ms", "20ms"),
    # --- 第十类: 蜂窝移动 (LTE / 5G NR) ---
    ("lte_good", "100Mbps", "50Mbps", "5ms", "20ms"),
    ("lte_poor", "50Mbps", "10Mbps", "10ms", "50ms"),
    ("nr_5g_embb", "1Gbps", "500Mbps", "1ms", "5ms"),
    ("nr_5g_edge", "500Mbps", "100Mbps", "2ms", "10ms"),
    # --- 第十一类: 广域网 / 卫星通信 ---
    ("wan_metro", "10Gbps", "1Gbps", "100us", "2ms"),
    ("wan_longhaul", "10Gbps", "1Gbps", "500us", "25ms"),
    ("satellite_leo", "100Mbps", "50Mbps", "5ms", "20ms"),
    ("satellite_geo", "50Mbps", "10Mbps", "10ms", "300ms"),
]


# =============================================================================
# 仿真运行 (run_sim)
# =============================================================================
def run_sim(
    protocol: str,
    scenario: str,
    access_bw: str,
    bottleneck_bw: str,
    access_delay: str,
    bottleneck_delay: str,
    log_dir: str,
    duration: int = DEFAULT_DURATION,
    n_leaf: int = DEFAULT_N_LEAF,
    sim_seed: int = DEFAULT_SIM_SEED,
    enable_udp_burst: int = 0,
) -> bool:
    """运行单个仿真场景，返回是否成功"""
    os.makedirs(log_dir, exist_ok=True)
    prefix = os.path.join(log_dir, f"{scenario}_{protocol}")
    flowmon_file = f"{prefix}.flowmonitor"

    # 断点续跑: flowmonitor 已存在则跳过
    if os.path.isfile(flowmon_file):
        print(f"[SKIP] {scenario}_{protocol} - flowmonitor already exists")
        return True

    print(f"[INFO] Running: Protocol={protocol}, Scenario={scenario}")
    print(
        f"[INFO]   Access: {access_bw} @ {access_delay}, "
        f"Bottleneck: {bottleneck_bw} @ {bottleneck_delay}"
    )

    ns3_cmd = (
        f"lark-tcp"
        f" --transport_prot={protocol}"
        f" --access_bandwidth={access_bw}"
        f" --bottleneck_bandwidth={bottleneck_bw}"
        f" --access_delay={access_delay}"
        f" --bottleneck_delay={bottleneck_delay}"
        f" --duration={duration}"
        f" --nLeaf={n_leaf}"
        f" --simSeed={sim_seed}"
        f" --enable_udp_burst={enable_udp_burst}"
        f" --prefix_name={prefix}"
    )

    ns3_log = f"{prefix}_ns3.log"
    start_time = time.time()

    try:
        if protocol == "TcpLark":
            # TcpLark: 后台启动 ns-3，等待 RL 环境就绪后启动 Python 智能体
            with open(ns3_log, "w") as log_f:
                ns3_proc = subprocess.Popen(
                    ["./ns3", "run", ns3_cmd],
                    stdout=log_f,
                    stderr=subprocess.STDOUT,
                )

            time.sleep(5)
            for _ in range(60):
                if ns3_proc.poll() is not None:
                    break
                try:
                    with open(ns3_log, "r") as f:
                        if "Waiting for Python" in f.read():
                            agent_log = f"{prefix}_agent.log"
                            with open(agent_log, "w") as af:
                                subprocess.run(
                                    [
                                        sys.executable,
                                        AGENT_SCRIPT,
                                        "--start=0",
                                        "--iterations=1",
                                    ],
                                    stdout=af,
                                    stderr=subprocess.STDOUT,
                                )
                            break
                except FileNotFoundError:
                    pass
                time.sleep(1)

            ns3_proc.wait()
            if ns3_proc.returncode != 0:
                print(f"[ERROR] Simulation failed: {scenario}_{protocol}")
                return False
        else:
            # 非 RL 协议: 直接同步运行
            with open(ns3_log, "w") as log_f:
                result = subprocess.run(
                    ["./ns3", "run", ns3_cmd],
                    stdout=log_f,
                    stderr=subprocess.STDOUT,
                )
            if result.returncode != 0:
                print(f"[ERROR] Simulation failed: {scenario}_{protocol}")
                return False

    except Exception as e:
        print(f"[ERROR] Exception in {scenario}_{protocol}: {e}")
        return False

    elapsed = int(time.time() - start_time)
    print(f"[INFO] Completed: {scenario} with {protocol} in {elapsed}s")
    return True


def cmd_sim(args):
    """执行仿真 (compare / compare-udp)"""
    enable_udp = 1 if args.udp else 0
    log_dir = "./logs/comparison-udp" if args.udp else "./logs/comparison"
    protocols = args.protocols or DEFAULT_PROTOCOLS
    scenarios = SCENARIOS

    # 如果指定了场景过滤
    if args.scenario:
        scenarios = [s for s in scenarios if s[0] in args.scenario]
        if not scenarios:
            print(f"[ERROR] No matching scenarios: {args.scenario}")
            sys.exit(1)

    total = len(scenarios) * len(protocols)
    done = 0
    failed = 0

    for (
        scenario_name,
        access_bw,
        bottleneck_bw,
        access_delay,
        bottleneck_delay,
    ) in scenarios:
        for protocol in protocols:
            ok = run_sim(
                protocol=protocol,
                scenario=scenario_name,
                access_bw=access_bw,
                bottleneck_bw=bottleneck_bw,
                access_delay=access_delay,
                bottleneck_delay=bottleneck_delay,
                log_dir=log_dir,
                duration=args.duration,
                n_leaf=args.n_leaf,
                sim_seed=args.sim_seed,
                enable_udp_burst=enable_udp,
            )
            done += 1
            if not ok:
                failed += 1
            print(f"[PROGRESS] {done}/{total} (failed: {failed})")

    print(f"\n[DONE] {done - failed}/{total} succeeded, {failed} failed")


# =============================================================================
# 汇总报告 (summary)
# =============================================================================
def cmd_summary(args):
    """从已有日志中提取指标，生成 CSV 报告 (同时处理 TCP 和 UDP)"""
    search_dirs = [
        "./logs/lark",
        "./logs/comparison",
        "./logs/lark-udp",
        "./logs/comparison-udp",
    ]

    os.makedirs("./logs/summary", exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = f"./logs/summary/results_{timestamp}.csv"

    fieldnames = [
        "Scenario",
        "Protocol",
        "Type",
        "AccessBW",
        "BottleneckBW",
        "Throughput_Mbps",
        "LossRate_Pct",
    ]
    rows = []
    for search_dir in search_dirs:
        if not os.path.isdir(search_dir):
            continue
        tag = "udp" if "udp" in search_dir.lower() else "tcp"
        for flowmon in glob.glob(os.path.join(search_dir, "*.flowmonitor")):
            basename = os.path.basename(flowmon).replace(".flowmonitor", "")
            parts = basename.rsplit("_", 1)
            if len(parts) != 2:
                continue
            scenario, protocol = parts

            log_file = flowmon.replace(".flowmonitor", "_ns3.log")
            if not os.path.isfile(log_file):
                continue

            with open(log_file, "r") as f:
                content = f.read()

            throughput = _grep_first(r"Throughput: ([\d.]+)", content) or "N/A"
            loss_rate = _grep_first(r"Loss Rate: ([\d.]+)", content) or "N/A"
            access_bw = _grep_first(r"AccessBW:\s*([\d.]+[A-Za-z]*)", content) or "N/A"
            bottleneck_bw = (
                _grep_first(r"BottleneckBW:\s*([\d.]+[A-Za-z]*)", content) or "N/A"
            )

            rows.append(
                {
                    "Scenario": scenario,
                    "Protocol": protocol,
                    "Type": tag,
                    "AccessBW": access_bw,
                    "BottleneckBW": bottleneck_bw,
                    "Throughput_Mbps": throughput,
                    "LossRate_Pct": loss_rate,
                }
            )

    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"[INFO] Summary saved to {out_path} ({len(rows)} records)")


def _grep_first(pattern: str, text: str) -> Optional[str]:
    m = re.search(pattern, text)
    return m.group(1) if m else None


# =============================================================================
# 数据模型 (FlowMonitor 解析)
# =============================================================================
@dataclass
class FlowData:
    flow_id: int
    src_addr: str
    dst_addr: str
    protocol: int
    tx_bytes: int
    rx_bytes: int
    tx_packets: int
    rx_packets: int
    lost_packets: int
    delay_sum_ns: float
    jitter_sum_ns: float
    duration_ns: float

    @property
    def throughput_mbps(self) -> float:
        if self.duration_ns > 0:
            return (self.rx_bytes * 8) / (self.duration_ns / 1e9) / 1e6
        return 0.0

    @property
    def avg_delay_ms(self) -> float:
        if self.rx_packets > 0:
            return (self.delay_sum_ns / self.rx_packets) / 1e6
        return 0.0

    @property
    def avg_jitter_ms(self) -> float:
        if self.rx_packets > 1:
            return (self.jitter_sum_ns / (self.rx_packets - 1)) / 1e6
        return 0.0

    @property
    def loss_rate(self) -> float:
        if self.tx_packets > 0:
            return (self.lost_packets / self.tx_packets) * 100
        return 0.0


@dataclass
class ScenarioResult:
    scenario: str
    protocol: str
    flows: List[FlowData] = field(default_factory=list)

    @property
    def total_throughput_mbps(self) -> float:
        return sum(f.throughput_mbps for f in self.flows if f.protocol == 6)

    @property
    def avg_delay_ms(self) -> float:
        tcp = [f for f in self.flows if f.protocol == 6 and f.rx_packets > 0]
        return float(np.mean([f.avg_delay_ms for f in tcp])) if tcp else 0.0

    @property
    def avg_jitter_ms(self) -> float:
        tcp = [f for f in self.flows if f.protocol == 6 and f.rx_packets > 1]
        return float(np.mean([f.avg_jitter_ms for f in tcp])) if tcp else 0.0

    @property
    def total_loss_rate(self) -> float:
        tcp = [f for f in self.flows if f.protocol == 6]
        tx = sum(f.tx_packets for f in tcp)
        lost = sum(f.lost_packets for f in tcp)
        return (lost / tx) * 100 if tx > 0 else 0.0


# =============================================================================
# FlowMonitor XML 解析
# =============================================================================
def _parse_ns_time(time_str: str) -> float:
    if not time_str:
        return 0.0
    time_str = time_str.strip("+").replace("ns", "")
    try:
        return float(time_str)
    except ValueError:
        return 0.0


def parse_flowmonitor(filepath: str) -> List[FlowData]:
    tree = ET.parse(filepath)
    root = tree.getroot()

    flow_info = {}
    for c in root.findall(".//Ipv4FlowClassifier/Flow"):
        fid = int(c.get("flowId"))
        flow_info[fid] = {
            "src_addr": c.get("sourceAddress"),
            "dst_addr": c.get("destinationAddress"),
            "protocol": int(c.get("protocol")),
        }

    flows = []
    for f in root.findall(".//FlowStats/Flow"):
        fid = int(f.get("flowId"))
        info = flow_info.get(fid, {"src_addr": "", "dst_addr": "", "protocol": 0})
        first_tx = _parse_ns_time(f.get("timeFirstTxPacket"))
        last_rx = _parse_ns_time(f.get("timeLastRxPacket"))
        dur = last_rx - first_tx if last_rx > first_tx else 0

        flows.append(
            FlowData(
                flow_id=fid,
                src_addr=info["src_addr"],
                dst_addr=info["dst_addr"],
                protocol=info["protocol"],
                tx_bytes=int(f.get("txBytes", 0)),
                rx_bytes=int(f.get("rxBytes", 0)),
                tx_packets=int(f.get("txPackets", 0)),
                rx_packets=int(f.get("rxPackets", 0)),
                lost_packets=int(f.get("lostPackets", 0)),
                delay_sum_ns=_parse_ns_time(f.get("delaySum")),
                jitter_sum_ns=_parse_ns_time(f.get("jitterSum")),
                duration_ns=dur,
            )
        )
    return flows


def load_all_results(logs_dir: str) -> List[ScenarioResult]:
    results = []
    for fp in glob.glob(os.path.join(logs_dir, "**", "*.flowmonitor"), recursive=True):
        m = re.match(r"(.+)_(Tcp\w+)\.flowmonitor", os.path.basename(fp))
        if m:
            results.append(
                ScenarioResult(m.group(1), m.group(2), parse_flowmonitor(fp))
            )
    return results


# =============================================================================
# 绘图函数
# =============================================================================
PROTOCOL_COLORS_BAR = ["#2ecc71", "#3498db", "#e74c3c", "#9b59b6"]
PROTOCOL_COLORS_MAP = {
    "TcpLark": "#2ecc71",
    "TcpNewReno": "#3498db",
    "TcpCubic": "#e74c3c",
    "TcpBbr": "#9b59b6",
}
PROTOCOL_ORDER = ["TcpLark", "TcpNewReno", "TcpCubic", "TcpBbr"]
FLOW_COLORS = {
    "TcpNewReno": "#1f77b4",
    "TcpCubic": "#ff7f0e",
    "TcpBbr": "#2ca02c",
    "TcpLark": "#d62728",
}


def plot_protocol_comparison(results: List[ScenarioResult], output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    scenarios: Dict[str, Dict[str, ScenarioResult]] = {}
    for r in results:
        scenarios.setdefault(r.scenario, {})[r.protocol] = r
    cmp = {k: v for k, v in scenarios.items() if len(v) > 1}
    if not cmp:
        print("No multi-protocol comparison data found")
        return

    x = np.arange(len(cmp))
    width = 0.2

    for metric, ylabel, title, getter in [
        (
            "throughput",
            "Throughput (Mbps)",
            "Protocol Throughput Comparison",
            lambda r: r.total_throughput_mbps,
        ),
        (
            "delay",
            "Average Delay (ms)",
            "Protocol Delay Comparison",
            lambda r: r.avg_delay_ms,
        ),
        (
            "loss",
            "Packet Loss Rate (%)",
            "Protocol Packet Loss Comparison",
            lambda r: r.total_loss_rate,
        ),
    ]:
        fig, ax = plt.subplots(figsize=(14, 6))
        for i, proto in enumerate(PROTOCOL_ORDER):
            vals = [getter(cmp[s][proto]) if proto in cmp[s] else 0 for s in cmp]
            ax.bar(
                x + i * width, vals, width, label=proto, color=PROTOCOL_COLORS_BAR[i]
            )
        ax.set_ylabel(ylabel)
        ax.set_title(title)
        ax.set_xticks(x + width * 1.5)
        ax.set_xticklabels(list(cmp.keys()), rotation=45, ha="right")
        ax.legend()
        ax.grid(axis="y", alpha=0.3)
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, f"{metric}_comparison.png"), dpi=150)
        plt.close()

    print(f"Protocol comparison charts saved to: {output_dir}")


def plot_lark_scenarios(results: List[ScenarioResult], output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    lark = sorted(
        [r for r in results if r.protocol == "TcpLark"], key=lambda r: r.scenario
    )
    if not lark:
        print("No TcpLark data found")
        return

    names = [r.scenario for r in lark]
    colors = plt.cm.viridis(np.linspace(0.2, 0.8, len(names)))
    fig, axes = plt.subplots(3, 1, figsize=(14, 12))

    for ax, vals, xlabel, title in [
        (
            axes[0],
            [r.total_throughput_mbps for r in lark],
            "Throughput (Mbps)",
            "TcpLark Throughput by Scenario",
        ),
        (
            axes[1],
            [r.avg_delay_ms for r in lark],
            "Average Delay (ms)",
            "TcpLark Delay by Scenario",
        ),
        (
            axes[2],
            [r.avg_jitter_ms for r in lark],
            "Average Jitter (ms)",
            "TcpLark Jitter by Scenario",
        ),
    ]:
        ax.barh(names, vals, color=colors)
        ax.set_xlabel(xlabel)
        ax.set_title(title)
        ax.grid(axis="x", alpha=0.3)
        fmt = ".1f" if "Throughput" in xlabel else ".4f"
        mx = max(vals) if vals else 1
        for i, v in enumerate(vals):
            ax.text(v + mx * 0.01, i, f"{v:{fmt}}", va="center", fontsize=8)

    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "lark_scenarios.png"), dpi=150)
    plt.close()
    print(f"Lark scenario charts saved to: {output_dir}")


def plot_radar_chart(results: List[ScenarioResult], output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    pdata: Dict[str, Dict[str, list]] = {}
    for r in results:
        pdata.setdefault(
            r.protocol, {"throughput": [], "delay": [], "jitter": [], "loss": []}
        )
        pdata[r.protocol]["throughput"].append(r.total_throughput_mbps)
        pdata[r.protocol]["delay"].append(r.avg_delay_ms)
        pdata[r.protocol]["jitter"].append(r.avg_jitter_ms)
        pdata[r.protocol]["loss"].append(r.total_loss_rate)

    if len(pdata) < 2:
        print("At least 2 protocols required for radar chart")
        return

    metrics = ["Throughput", "Low Delay", "Low Jitter", "Low Loss"]
    protos = list(pdata.keys())

    raw = {}
    for p in protos:
        raw[p] = [
            np.mean(pdata[p]["throughput"]),
            1 / (np.mean(pdata[p]["delay"]) + 0.001),
            1 / (np.mean(pdata[p]["jitter"]) + 0.001),
            100 - np.mean(pdata[p]["loss"]),
        ]

    all_v = np.array([raw[p] for p in protos])
    mx, mn = np.max(all_v, axis=0), np.min(all_v, axis=0)
    rng = mx - mn + 1e-10
    norm = {p: [(v - mn[i]) / rng[i] for i, v in enumerate(raw[p])] for p in protos}

    angles = np.linspace(0, 2 * np.pi, len(metrics), endpoint=False).tolist()
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
    for p in protos:
        v = norm[p] + norm[p][:1]
        c = PROTOCOL_COLORS_MAP.get(p, "#333333")
        ax.plot(angles, v, "o-", linewidth=2, label=p, color=c)
        ax.fill(angles, v, alpha=0.25, color=c)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(metrics)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.0))
    ax.set_title("Protocol Performance Radar Chart", y=1.08)
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, "radar_comparison.png"), dpi=150)
    plt.close()
    print(f"Radar chart saved to: {output_dir}")


def generate_summary_table(results: List[ScenarioResult], output_dir: str):
    os.makedirs(output_dir, exist_ok=True)
    if not results:
        return
    rows = [
        {
            "Scenario": r.scenario,
            "Protocol": r.protocol,
            "Throughput (Mbps)": f"{r.total_throughput_mbps:.2f}",
            "Delay (ms)": f"{r.avg_delay_ms:.4f}",
            "Jitter (ms)": f"{r.avg_jitter_ms:.4f}",
            "Loss (%)": f"{r.total_loss_rate:.2f}",
        }
        for r in results
    ]
    csv_path = os.path.join(output_dir, "summary.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys())
        w.writeheader()
        w.writerows(rows)
    print(f"Summary table saved to: {csv_path}")


def plot_flow_throughput_comparison(log_dir: str, output_dir: str):
    log_files = glob.glob(os.path.join(log_dir, "*_ns3.log"))
    if not log_files:
        print(f"No ns3.log files found in: {log_dir}")
        return

    data: Dict[str, Dict[str, Dict[int, float]]] = {}
    for lf in log_files:
        name = os.path.basename(lf).replace("_ns3.log", "")
        m = re.match(r"(.+)_(Tcp\w+)$", name)
        if not m:
            continue
        scenario, proto = m.group(1), m.group(2)
        with open(lf, "r") as f:
            content = f.read()
        matches = re.findall(
            r"TCP Flow (\d+).*?Throughput:\s+([\d.]+)\s+Mbps", content, re.DOTALL
        )
        data.setdefault(scenario, {})[proto] = {
            int(fid): float(tp) for fid, tp in matches
        }

    scenarios = sorted(data.keys())
    protos = ["TcpNewReno", "TcpCubic", "TcpBbr", "TcpLark"]
    avail = set()
    for s in scenarios:
        avail.update(data[s].keys())
    protos = [p for p in protos if p in avail]
    flows = [1, 3, 5]

    if not scenarios or not protos:
        print("No valid throughput data found for plotting")
        return

    fig, axes = plt.subplots(
        len(scenarios), len(flows), figsize=(14, 4 * len(scenarios))
    )
    fig.suptitle(
        "TCP Flow Throughput Comparison (Flow 1, 3, 5)",
        fontsize=14,
        fontweight="bold",
    )
    if len(scenarios) == 1:
        axes = axes.reshape(1, -1)

    x = np.arange(len(protos))
    for i, sc in enumerate(scenarios):
        for j, fid in enumerate(flows):
            ax = axes[i, j]
            tps = [data[sc].get(p, {}).get(fid, 0) for p in protos]
            bars = ax.bar(
                x,
                tps,
                0.6,
                color=[FLOW_COLORS[p] for p in protos],
                edgecolor="black",
                linewidth=0.5,
            )
            for bar, val in zip(bars, tps):
                if val > 0:
                    ax.text(
                        bar.get_x() + bar.get_width() / 2,
                        bar.get_height() + 5,
                        f"{val:.1f}",
                        ha="center",
                        va="bottom",
                        fontsize=8,
                    )
            ax.set_xticks(x)
            ax.set_xticklabels([p.replace("Tcp", "") for p in protos], fontsize=9)
            ax.set_ylabel("Throughput (Mbps)", fontsize=9)
            if i == 0:
                ax.set_title(f"Flow {fid}", fontsize=11, fontweight="bold")
            if j == 0:
                ax.annotate(
                    sc.replace("_", " ").title(),
                    xy=(-0.4, 0.5),
                    xycoords="axes fraction",
                    fontsize=10,
                    fontweight="bold",
                    rotation=90,
                    va="center",
                    ha="center",
                )
            ax.grid(axis="y", linestyle="--", alpha=0.3)
            ax.set_ylim(0, max(tps) * 1.2 if max(tps) > 0 else 100)

    plt.tight_layout(rect=[0.05, 0, 1, 0.96])
    os.makedirs(output_dir, exist_ok=True)
    out = os.path.join(output_dir, "flow_throughput_comparison.png")
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Flow throughput comparison saved to: {out}")


def cmd_draw(args):
    """生成绘图"""
    datasets = [
        ("./logs/comparison", "./logs/plots"),
        ("./logs/comparison-udp", "./logs/plots-udp"),
    ]
    if args.comparison_dir:
        out = args.output_dir or (
            "./logs/plots-udp"
            if "udp" in args.comparison_dir.lower()
            else "./logs/plots"
        )
        datasets = [(args.comparison_dir, out)]

    print("=" * 60)
    print("NS-3 FlowMonitor Data Visualization")
    print("=" * 60)

    ok = 0
    for cdir, odir in datasets:
        if not os.path.isdir(cdir):
            print(f"Warning: Directory not found: {cdir}")
            continue
        results = load_all_results(cdir)
        print(f"\n--- Processing: {cdir} -> {odir} ---")
        print(f"Loaded {len(results)} test results from {cdir}")
        if not results:
            print(f"Warning: No flowmonitor files found in {cdir}")
            continue
        plot_lark_scenarios(results, odir)
        plot_protocol_comparison(results, odir)
        plot_radar_chart(results, odir)
        generate_summary_table(results, odir)
        plot_flow_throughput_comparison(cdir, odir)
        ok += 1

    print(f"\nAll charts generated! ({ok}/{len(datasets)} datasets processed)")


# =============================================================================
# CLI 入口
# =============================================================================
def main():
    parser = argparse.ArgumentParser(
        description="NS-3 Lark TCP 仿真管理工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
使用示例:
  python main.py sim                        # 运行全部纯 TCP 仿真
  python main.py sim --udp                  # 运行全部 TCP+UDP 仿真
  python main.py sim --scenario wifi_ac     # 只跑 wifi_ac 场景
  python main.py draw                       # 生成全部绘图
  python main.py draw --comparison-dir ./logs/comparison
  python main.py summary                    # 生成汇总 CSV (TCP + UDP)
""",
    )
    sub = parser.add_subparsers(dest="command", help="子命令")

    # --- sim ---
    p_sim = sub.add_parser("sim", help="运行仿真")
    p_sim.add_argument("--udp", action="store_true", help="启用 UDP 突发干扰流")
    p_sim.add_argument(
        "--scenario", nargs="+", help="只运行指定场景 (空格分隔多个场景名)"
    )
    p_sim.add_argument(
        "--protocols",
        nargs="+",
        default=None,
        help="指定协议列表 (默认: TcpLark TcpNewReno TcpCubic TcpBbr)",
    )
    p_sim.add_argument(
        "--duration", type=int, default=DEFAULT_DURATION, help="仿真时长 (秒)"
    )
    p_sim.add_argument(
        "--n-leaf", type=int, default=DEFAULT_N_LEAF, help="每侧叶子节点数"
    )
    p_sim.add_argument(
        "--sim-seed", type=int, default=DEFAULT_SIM_SEED, help="随机种子"
    )

    # --- draw ---
    p_draw = sub.add_parser("draw", help="生成绘图")
    p_draw.add_argument("--comparison-dir", default=None, help="指定单个数据目录")
    p_draw.add_argument("--output-dir", default=None, help="指定输出目录")

    # --- summary ---
    p_summary = sub.add_parser(
        "summary", help="生成汇总 CSV 报告 (同时包含 TCP 和 UDP)"
    )

    args = parser.parse_args()

    if args.command == "sim":
        cmd_sim(args)
    elif args.command == "draw":
        cmd_draw(args)
    elif args.command == "summary":
        cmd_summary(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
