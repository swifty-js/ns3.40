#!/usr/bin/env python3
"""Audited publication-figure pipeline for the TcpSwift papers.

Reads the raw FlowMonitor artifacts under logs/comparison and
logs/comparison-udp, recomputes forward-direction-only KPIs (audit rule A),
regenerates logs/summary/kpi_forward.csv, applies the dataset exclusion rules
recorded in logs/error.txt (rules B/C/D plus the pre-v3.0.0 revision
boundary), verifies the kept scenario sets against the S1-S19 / 15-scenario
lists published in the thesis, and renders every figure referenced by
docs/thesis.tex and docs/NJUPT_Professional_Thesis_draft1.

Rules encoded here (see logs/error.txt and thesis chapter 4 for provenance):
  A. Metric definition: only forward bulk-transfer flows (proto 6,
     10.1.x -> 10.2.x) enter goodput/delay/jitter/loss/Jain.
  B. Revision control: a (setting, scenario) group is usable only when all
     four protocol artifacts share the same sink port AND that port is the
     current sim.cc revision (50000). Mixed groups and whole-group old
     revision (5000) runs are excluded.
  C. Duplicate configs: dc_oversub_10to1 == congested_heavy and
     satellite_leo == lte_good were generated from identical link parameters;
     the aliases are excluded (originals retained).
  D. Degenerate BBR: on microsecond-RTT high-rate paths the ns-3.40 BBR
     implementation collapses to ~2 Mbps (util < 1%); those BBR data points
     are excluded and the scenario becomes a 3-protocol comparison.
"""

from __future__ import annotations

import csv
import json
import math
import re
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager
from matplotlib.lines import Line2D
from matplotlib.patches import FancyBboxPatch

REPO_ROOT = Path(__file__).resolve().parents[2]
LOGS_DIR = REPO_ROOT / "logs"
PLOTS_DIR = REPO_ROOT / "docs" / "plots"
KPI_CSV = LOGS_DIR / "summary" / "kpi_forward.csv"

PROTOCOL_ORDER = ["TcpSwift", "TcpNewReno", "TcpCubic", "TcpBbr"]
PROTOCOL_LABEL = {
    "TcpSwift": "Swift",
    "TcpNewReno": "NewReno",
    "TcpCubic": "CUBIC",
    "TcpBbr": "BBR",
}
PROTOCOL_COLORS = {
    "TcpSwift": "#0072B2",
    "TcpNewReno": "#E69F00",
    "TcpCubic": "#009E73",
    "TcpBbr": "#D55E00",
}

NEW_PORT = "50000"
OLD_PORT = "5000"

# Link parameters used at data-generation time:
# scenario -> (access rate, bottleneck rate, access delay, bottleneck delay)
SCENARIO_LINKS = {
    "intra_rack_10g": ("25Gbps", "10Gbps", "1us", "2us"),
    "intra_rack_25g": ("25Gbps", "25Gbps", "1us", "2us"),
    "leaf_spine_20g": ("50Gbps", "20Gbps", "2us", "5us"),
    "leaf_spine_50g": ("50Gbps", "50Gbps", "2us", "5us"),
    "oversub_4to1_10g": ("10Gbps", "2.5Gbps", "2us", "5us"),
    "oversub_4to1_40g": ("40Gbps", "10Gbps", "2us", "5us"),
    "oversub_2to1_25g": ("25Gbps", "12.5Gbps", "2us", "5us"),
    "oversub_2to1_50g": ("50Gbps", "25Gbps", "2us", "5us"),
    "congested_light": ("10Gbps", "5Gbps", "2us", "5us"),
    "congested_medium": ("10Gbps", "2Gbps", "2us", "5us"),
    "congested_heavy": ("10Gbps", "1Gbps", "2us", "5us"),
    "cross_pod_10g": ("25Gbps", "10Gbps", "5us", "50us"),
    "cross_pod_20g": ("50Gbps", "20Gbps", "5us", "50us"),
    "cross_dc_wan": ("10Gbps", "1Gbps", "10us", "5ms"),
    "rdma_like_25g": ("25Gbps", "25Gbps", "500ns", "1us"),
    "rdma_like_50g": ("50Gbps", "50Gbps", "500ns", "1us"),
    "mixed_small_flow": ("10Gbps", "2Gbps", "2us", "10us"),
    "mixed_large_flow": ("50Gbps", "12.5Gbps", "2us", "10us"),
    "asymmetric_high": ("50Gbps", "1Gbps", "1us", "10us"),
    "symmetric_low": ("1Gbps", "1Gbps", "5us", "20us"),
    "dc_100m": ("1Gbps", "100Mbps", "2us", "5us"),
    "dc_500m": ("1Gbps", "500Mbps", "2us", "5us"),
    "dc_100g": ("100Gbps", "100Gbps", "1us", "2us"),
    "dc_oversub_10to1": ("10Gbps", "1Gbps", "2us", "5us"),
    "wifi_ac": ("1Gbps", "400Mbps", "1ms", "5ms"),
    "wifi_ax": ("1Gbps", "600Mbps", "1ms", "3ms"),
    "wifi_n": ("100Mbps", "50Mbps", "2ms", "10ms"),
    "wifi_legacy": ("100Mbps", "10Mbps", "5ms", "20ms"),
    "lte_good": ("100Mbps", "50Mbps", "5ms", "20ms"),
    "lte_poor": ("50Mbps", "10Mbps", "10ms", "50ms"),
    "nr_5g_embb": ("1Gbps", "500Mbps", "1ms", "5ms"),
    "nr_5g_edge": ("500Mbps", "100Mbps", "2ms", "10ms"),
    "wan_metro": ("10Gbps", "1Gbps", "100us", "2ms"),
    "wan_longhaul": ("10Gbps", "1Gbps", "500us", "25ms"),
    "satellite_leo": ("100Mbps", "50Mbps", "5ms", "20ms"),
    "satellite_geo": ("50Mbps", "10Mbps", "10ms", "300ms"),
}

DUPLICATE_ALIASES = {
    "dc_oversub_10to1": "congested_heavy",
    "satellite_leo": "lte_good",
}

# Published scenario numbering (thesis table `tab:scenarios`).
S_ORDER = [
    ("S1", "intra_rack_10g"),
    ("S2", "intra_rack_25g"),
    ("S3", "leaf_spine_20g"),
    ("S4", "asymmetric_high"),
    ("S5", "congested_heavy"),
    ("S6", "symmetric_low"),
    ("S7", "dc_500m"),
    ("S8", "dc_100m"),
    ("S9", "cross_dc_wan"),
    ("S10", "wan_metro"),
    ("S11", "wifi_ac"),
    ("S12", "wifi_ax"),
    ("S13", "wifi_n"),
    ("S14", "wifi_legacy"),
    ("S15", "nr_5g_embb"),
    ("S16", "nr_5g_edge"),
    ("S17", "lte_good"),
    ("S18", "lte_poor"),
    ("S19", "satellite_geo"),
]
SID_BY_SCENARIO = {scenario: sid for sid, scenario in S_ORDER}
UDP_PAIRED_SIDS = [
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
    "S7",
    "S8",
    "S10",
    "S13",
    "S14",
    "S16",
    "S17",
    "S18",
    "S19",
]
DEGENERATE_BBR_UTIL = 0.01


def rate_mbps(text: str) -> float:
    match = re.match(r"([\d.]+)([GMK]?)bps", text)
    return (
        float(match.group(1))
        * {"G": 1000.0, "M": 1.0, "K": 1e-3, "": 1e-6}[match.group(2)]
    )


def delay_ms(text: str) -> float:
    match = re.match(r"([\d.]+)(ns|us|ms|s)", text)
    return (
        float(match.group(1))
        * {"ns": 1e-6, "us": 1e-3, "ms": 1.0, "s": 1e3}[match.group(2)]
    )


def ns_value(text: str | None) -> float:
    return float((text or "0ns").strip("+").replace("ns", ""))


def forward_kpi(path: Path) -> dict:
    root = ET.parse(path).getroot()
    forward_ids: set[int] = set()
    ports: set[str] = set()
    for c in root.findall(".//Ipv4FlowClassifier/Flow"):
        if int(c.get("protocol")) != 6:
            continue
        ports.add(c.get("destinationPort"))
        if (c.get("sourceAddress") or "").startswith("10.1.") and (
            c.get("destinationAddress") or ""
        ).startswith("10.2."):
            forward_ids.add(int(c.get("flowId")))
    goodputs: list[float] = []
    delays: list[float] = []
    jitters: list[float] = []
    tx_packets = 0
    lost_packets = 0
    for flow in root.findall(".//FlowStats/Flow"):
        if int(flow.get("flowId")) not in forward_ids:
            continue
        rx_packets = int(flow.get("rxPackets"))
        rx_bytes = int(flow.get("rxBytes"))
        duration_s = (
            ns_value(flow.get("timeLastRxPacket"))
            - ns_value(flow.get("timeFirstTxPacket"))
        ) / 1e9
        if duration_s > 0:
            goodputs.append(rx_bytes * 8 / duration_s / 1e6)
        if rx_packets > 0:
            delays.append(ns_value(flow.get("delaySum")) / rx_packets / 1e6)
        if rx_packets > 1:
            jitters.append(ns_value(flow.get("jitterSum")) / (rx_packets - 1) / 1e6)
        tx_packets += int(flow.get("txPackets"))
        lost_packets += int(flow.get("lostPackets"))
    n = len(goodputs)
    total = sum(goodputs)
    squares = sum(value * value for value in goodputs)
    jain = (total * total) / (n * squares) if n and squares > 0 else 0.0
    return {
        "nflow": n,
        "ports": "/".join(sorted(ports)),
        "goodput": total,
        "delay": sum(delays) / len(delays) if delays else 0.0,
        "jitter": sum(jitters) / len(jitters) if jitters else 0.0,
        "loss": 100.0 * lost_packets / tx_packets if tx_packets else 0.0,
        "jain": jain,
    }


def derive_rows() -> list[dict]:
    rows: list[dict] = []
    for setting, directory in [
        ("tcp_only", LOGS_DIR / "comparison"),
        ("udp_burst", LOGS_DIR / "comparison-udp"),
    ]:
        for path in sorted(directory.glob("*.flowmonitor")):
            base = path.name[: -len(".flowmonitor")]
            match = re.match(r"^(.+)_(Tcp[A-Za-z0-9]+?)(?:_s(\d+))?$", base)
            scenario, protocol = match.group(1), match.group(2)
            if scenario not in SCENARIO_LINKS:
                continue
            kpi = forward_kpi(path)
            access_rate, bottleneck, access_delay, bottleneck_delay = SCENARIO_LINKS[
                scenario
            ]
            rows.append(
                {
                    "Setting": setting,
                    "Scenario": scenario,
                    "Protocol": protocol,
                    "BottleneckMbps": rate_mbps(bottleneck),
                    "BaseOwdMs": round(
                        2 * delay_ms(access_delay) + delay_ms(bottleneck_delay), 4
                    ),
                    "Flows": kpi["nflow"],
                    "SinkPort": kpi["ports"],
                    "Goodput_Mbps": round(kpi["goodput"], 2),
                    "Util": round(kpi["goodput"] / rate_mbps(bottleneck), 4),
                    "Delay_ms": round(kpi["delay"], 4),
                    "Jitter_ms": round(kpi["jitter"], 4),
                    "Loss_pct": round(kpi["loss"], 4),
                    "Jain": round(kpi["jain"], 4),
                    "Source": path.relative_to(REPO_ROOT).as_posix(),
                }
            )
    return rows


def write_and_verify_csv(rows: list[dict]) -> str:
    fieldnames = list(rows[0].keys())
    previous = None
    if KPI_CSV.exists():
        with KPI_CSV.open(newline="") as handle:
            previous = [dict(row) for row in csv.DictReader(handle)]
    with KPI_CSV.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    if previous is None:
        return "kpi_forward.csv created"
    current = [{key: str(row[key]) for key in fieldnames} for row in rows]
    if len(previous) != len(current):
        return f"kpi_forward.csv ROW COUNT CHANGED: {len(previous)} -> {len(current)}"
    changed = sum(1 for a, b in zip(previous, current) if a != b)
    return (
        "kpi_forward.csv regenerated: identical to previous version"
        if changed == 0
        else f"kpi_forward.csv regenerated: {changed} rows CHANGED vs previous version"
    )


def audit(rows: list[dict]) -> dict:
    groups: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    for row in rows:
        groups[(row["Setting"], row["Scenario"])][row["Protocol"]] = row

    exclusions: list[dict] = []
    kept: dict[str, list[str]] = {"tcp_only": [], "udp_burst": []}
    for (setting, scenario), protocols in sorted(groups.items()):
        ports = {row["SinkPort"] for row in protocols.values()}
        detail = ",".join(
            f"{proto}:{protocols[proto]['SinkPort'].split('/')[-1]}"
            for proto in sorted(protocols)
        )
        if set(protocols) != set(PROTOCOL_ORDER):
            exclusions.append(
                {
                    "rule": "B",
                    "setting": setting,
                    "scenario": scenario,
                    "protocol": "*",
                    "reason": f"incomplete protocol set ({detail})",
                }
            )
            continue
        if len(ports) > 1:
            exclusions.append(
                {
                    "rule": "B",
                    "setting": setting,
                    "scenario": scenario,
                    "protocol": "*",
                    "reason": f"mixed sink port across protocols ({detail}); artifacts from two sim.cc revisions",
                }
            )
            continue
        if OLD_PORT in next(iter(ports)).split("/"):
            exclusions.append(
                {
                    "rule": "B",
                    "setting": setting,
                    "scenario": scenario,
                    "protocol": "*",
                    "reason": "whole group generated by the superseded sim.cc revision (sink port 5000); not comparable with the retained revision",
                }
            )
            continue
        if scenario in DUPLICATE_ALIASES:
            exclusions.append(
                {
                    "rule": "C",
                    "setting": setting,
                    "scenario": scenario,
                    "protocol": "*",
                    "reason": f"duplicate of {DUPLICATE_ALIASES[scenario]} (identical link parameters at generation time)",
                }
            )
            continue
        kept[setting].append(scenario)

    degenerate: list[tuple[str, str]] = []
    for setting, scenarios in kept.items():
        for scenario in scenarios:
            row = groups[(setting, scenario)]["TcpBbr"]
            if float(row["Util"]) < DEGENERATE_BBR_UTIL:
                degenerate.append((setting, scenario))
                exclusions.append(
                    {
                        "rule": "D",
                        "setting": setting,
                        "scenario": scenario,
                        "protocol": "TcpBbr",
                        "reason": f"goodput {row['Goodput_Mbps']} Mbps = {100 * float(row['Util']):.2f}% of bottleneck; ns-3.40 BBR pacing/RTT-resolution breakdown",
                    }
                )

    expected_tcp = [scenario for _, scenario in S_ORDER]
    expected_udp = [scenario for sid, scenario in S_ORDER if sid in UDP_PAIRED_SIDS]
    assert sorted(kept["tcp_only"]) == sorted(expected_tcp), (
        f"TCP kept set diverges from published S1-S19: {sorted(kept['tcp_only'])}"
    )
    assert sorted(kept["udp_burst"]) == sorted(expected_udp), (
        f"UDP kept set diverges from the published 15-scenario list: {sorted(kept['udp_burst'])}"
    )

    view: dict[str, dict[str, dict[str, dict]]] = {"tcp_only": {}, "udp_burst": {}}
    for setting in view:
        for scenario in kept[setting]:
            view[setting][scenario] = {
                proto: row
                for proto, row in groups[(setting, scenario)].items()
                if not (proto == "TcpBbr" and (setting, scenario) in degenerate)
            }
    return {"view": view, "exclusions": exclusions, "degenerate": degenerate}


def configure_style() -> None:
    available = {font.name for font in font_manager.fontManager.ttflist}
    cjk = [
        name
        for name in ["PingFang SC", "Songti SC", "Hiragino Sans GB", "Microsoft YaHei"]
        if name in available
    ]
    plt.rcParams.update(
        {
            "font.family": ["Helvetica", "Arial", "DejaVu Sans"] + cjk,
            "axes.unicode_minus": False,
            "figure.dpi": 150,
            "savefig.dpi": 300,
            "savefig.bbox": "tight",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.alpha": 0.22,
            "grid.linewidth": 0.6,
            "axes.titleweight": "bold",
            "axes.titlesize": 10,
            "axes.labelsize": 9,
            "xtick.labelsize": 8,
            "ytick.labelsize": 8,
            "legend.fontsize": 8,
        }
    )


def save_figure(fig: plt.Figure, stem: str) -> list[str]:
    outputs = []
    for extension in ("png", "pdf", "svg"):
        path = PLOTS_DIR / f"{stem}.{extension}"
        fig.savefig(path)
        outputs.append(path.name)
    plt.close(fig)
    return outputs


def grouped_bars(
    ax: plt.Axes,
    view: dict[str, dict[str, dict]],
    sids: list[str],
    value_key: str,
    width: float = 0.19,
) -> None:
    x = np.arange(len(sids))
    for index, protocol in enumerate(PROTOCOL_ORDER):
        offsets, values = [], []
        for position, sid in enumerate(sids):
            scenario = dict(S_ORDER)[sid]
            row = view.get(scenario, {}).get(protocol)
            if row is None:
                continue
            offsets.append(position + (index - 1.5) * width)
            values.append(float(row[value_key]))
        ax.bar(
            offsets,
            values,
            width=width,
            label=PROTOCOL_LABEL[protocol],
            color=PROTOCOL_COLORS[protocol],
            edgecolor="white",
            linewidth=0.5,
        )
    ax.set_xticks(x)
    ax.set_xticklabels(sids)


def plot_goodput(view: dict, plots: list) -> None:
    sids = [sid for sid, _ in S_ORDER]
    fig, ax = plt.subplots(figsize=(9.6, 3.6))
    grouped_bars(ax, view["tcp_only"], sids, "Goodput_Mbps")
    ax.set_yscale("log")
    ax.set_ylabel("Aggregate forward goodput (Mbps)")
    ax.set_title("Forward goodput across the 19 audited scenarios (TCP-only)")
    for position, sid in enumerate(sids):
        scenario = dict(S_ORDER)[sid]
        if "TcpBbr" not in view["tcp_only"].get(scenario, {}):
            ax.annotate(
                "BBR\nexcl.",
                (position + 0.29, ax.get_ylim()[0] * 1.6),
                fontsize=6,
                ha="center",
                color="#8B0000",
            )
    ax.legend(ncol=4, loc="upper center", bbox_to_anchor=(0.5, 1.22), frameon=False)
    fig.tight_layout()
    plots.append(
        {
            "stem": "fig01_goodput_clean",
            "files": save_figure(fig, "fig01_goodput_clean"),
        }
    )


def plot_delay(view: dict, plots: list) -> None:
    sids = [sid for sid, _ in S_ORDER]
    fig, ax = plt.subplots(figsize=(9.6, 3.6))
    grouped_bars(ax, view["tcp_only"], sids, "Delay_ms")
    for position, sid in enumerate(sids):
        scenario = dict(S_ORDER)[sid]
        rows = view["tcp_only"].get(scenario, {})
        if rows:
            base_owd = float(next(iter(rows.values()))["BaseOwdMs"])
            ax.hlines(
                max(base_owd, 1e-3),
                position - 0.42,
                position + 0.42,
                color="#222222",
                linestyle=(0, (3, 2)),
                linewidth=1.0,
                zorder=5,
            )
    ax.set_yscale("log")
    ax.set_ylabel("Mean one-way delay (ms)")
    ax.set_title("Forward one-way delay; dashes mark the base propagation OWD")
    handles, labels = ax.get_legend_handles_labels()
    handles.append(
        Line2D([], [], color="#222222", linestyle=(0, (3, 2)), linewidth=1.0)
    )
    labels.append("Base OWD")
    ax.legend(
        handles,
        labels,
        ncol=5,
        loc="upper center",
        bbox_to_anchor=(0.5, 1.22),
        frameon=False,
    )
    fig.tight_layout()
    plots.append(
        {"stem": "fig02_delay_clean", "files": save_figure(fig, "fig02_delay_clean")}
    )


def plot_tradeoff(view: dict, plots: list) -> None:
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    for protocol in PROTOCOL_ORDER:
        xs, ys = [], []
        for scenario, rows in view["tcp_only"].items():
            row = rows.get(protocol)
            if row is None:
                continue
            xs.append(max(float(row["Delay_ms"]), 1e-2))
            ys.append(float(row["Util"]) * 100.0)
        ax.scatter(
            xs,
            ys,
            s=42,
            color=PROTOCOL_COLORS[protocol],
            label=PROTOCOL_LABEL[protocol],
            alpha=0.8,
            edgecolor="white",
            linewidth=0.6,
        )
    for sid in ["S8", "S9", "S19"]:
        scenario = dict(S_ORDER)[sid]
        row = view["tcp_only"][scenario]["TcpSwift"]
        ax.annotate(
            sid,
            (float(row["Delay_ms"]), float(row["Util"]) * 100.0),
            textcoords="offset points",
            xytext=(6, 4),
            fontsize=8,
            color="#0072B2",
        )
    ax.set_xscale("log")
    ax.set_xlabel("Mean one-way delay (ms, log scale)")
    ax.set_ylabel("Bottleneck utilization (%)")
    ax.set_ylim(0, 108)
    ax.set_title("Utilization-delay trade-off (TCP-only, 19 scenarios)")
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout()
    plots.append(
        {
            "stem": "fig03_tradeoff_clean",
            "files": save_figure(fig, "fig03_tradeoff_clean"),
        }
    )


def plot_udp_burst(view: dict, plots: list) -> None:
    sids = UDP_PAIRED_SIDS
    fig, axes = plt.subplots(2, 1, figsize=(9.6, 5.6), sharex=True)
    width = 0.19
    x = np.arange(len(sids))
    for index, protocol in enumerate(PROTOCOL_ORDER):
        drop_offsets, drops, loss_offsets, losses = [], [], [], []
        for position, sid in enumerate(sids):
            scenario = dict(S_ORDER)[sid]
            tcp_row = view["tcp_only"].get(scenario, {}).get(protocol)
            udp_row = view["udp_burst"].get(scenario, {}).get(protocol)
            if tcp_row is None or udp_row is None:
                continue
            tcp_goodput = float(tcp_row["Goodput_Mbps"])
            drop_offsets.append(position + (index - 1.5) * width)
            drops.append(
                100.0 * (float(udp_row["Goodput_Mbps"]) - tcp_goodput) / tcp_goodput
            )
            loss_offsets.append(position + (index - 1.5) * width)
            losses.append(
                max(float(udp_row["Loss_pct"]) - float(tcp_row["Loss_pct"]), 0.0)
            )
        axes[0].bar(
            drop_offsets,
            drops,
            width=width,
            color=PROTOCOL_COLORS[protocol],
            label=PROTOCOL_LABEL[protocol],
            edgecolor="white",
            linewidth=0.5,
        )
        axes[1].bar(
            loss_offsets,
            losses,
            width=width,
            color=PROTOCOL_COLORS[protocol],
            label=PROTOCOL_LABEL[protocol],
            edgecolor="white",
            linewidth=0.5,
        )
    axes[0].axhline(0, color="#444444", linewidth=0.8)
    axes[0].set_ylabel("Goodput change under burst (%)")
    axes[0].set_title("Cross-traffic robustness on the 15 paired scenarios")
    axes[0].legend(
        ncol=4, loc="upper center", bbox_to_anchor=(0.5, 1.28), frameon=False
    )
    axes[1].set_yscale("symlog", linthresh=0.1)
    axes[1].set_ylabel("Added loss under burst (pp)")
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(sids)
    for position, sid in enumerate(sids):
        scenario = dict(S_ORDER)[sid]
        if "TcpBbr" not in view["udp_burst"].get(scenario, {}):
            axes[0].annotate(
                "BBR excl.",
                (position, axes[0].get_ylim()[0] * 0.97),
                fontsize=6,
                ha="center",
                color="#8B0000",
            )
    fig.tight_layout()
    plots.append(
        {
            "stem": "fig04_udp_burst_clean",
            "files": save_figure(fig, "fig04_udp_burst_clean"),
        }
    )


def plot_audit_funnel(exclusions: list[dict], plots: list) -> None:
    mixed = sum(
        1
        for item in exclusions
        if item["rule"] == "B" and "mixed sink port" in item["reason"]
    )
    old_revision = sum(
        1
        for item in exclusions
        if item["rule"] == "B" and "superseded" in item["reason"]
    )
    duplicates = sum(1 for item in exclusions if item["rule"] == "C")
    bbr_points = sum(1 for item in exclusions if item["rule"] == "D")
    stages = [
        ("All (setting, scenario) groups\n288 artifacts", 72),
        (f"After rule B: revision mixing\n(-{mixed} groups)", 72 - mixed),
        (
            f"After rule B: whole-group old revision\n(-{old_revision} groups)",
            72 - mixed - old_revision,
        ),
        (
            f"After rule C: duplicate configs\n(-{duplicates} groups)",
            72 - mixed - old_revision - duplicates,
        ),
    ]
    fig, ax = plt.subplots(figsize=(7.4, 3.9))
    y = np.arange(len(stages))[::-1]
    values = [count for _, count in stages]
    colors = ["#9ECAE1", "#6BAED6", "#4292C6", "#2171B5"]
    bars = ax.barh(y, values, height=0.62, color=colors, edgecolor="white")
    for bar, (label, count) in zip(bars, stages):
        ax.text(
            bar.get_width() + 1.0,
            bar.get_y() + bar.get_height() / 2,
            f"{count} groups",
            va="center",
            fontsize=9,
            fontweight="bold",
        )
    ax.set_yticks(y)
    ax.set_yticklabels([label for label, _ in stages], fontsize=8)
    ax.set_xlim(0, 84)
    ax.set_xlabel("Usable (setting, scenario) groups")
    ax.set_title("Dataset audit funnel: 288 runs -> 19 TCP + 15 UDP-burst groups")
    ax.text(
        0.99,
        0.04,
        f"Rule A rewrites metrics (forward flows only) for every kept group;\n"
        f"rule D additionally drops {bbr_points} degenerate BBR data points (S1, S2).",
        transform=ax.transAxes,
        ha="right",
        fontsize=7.5,
        color="#333333",
    )
    fig.tight_layout()
    plots.append(
        {"stem": "fig05_audit_funnel", "files": save_figure(fig, "fig05_audit_funnel")}
    )


def add_box(ax, xy, width, height, text, facecolor, fontsize=8.5) -> None:
    ax.add_patch(
        FancyBboxPatch(
            xy,
            width,
            height,
            boxstyle="round,pad=0.012,rounding_size=0.018",
            linewidth=1.0,
            edgecolor="#333333",
            facecolor=facecolor,
        )
    )
    ax.text(
        xy[0] + width / 2,
        xy[1] + height / 2,
        text,
        ha="center",
        va="center",
        fontsize=fontsize,
    )


def add_arrow(ax, start, end, text=None, color="#333333") -> None:
    ax.annotate(
        "",
        xy=end,
        xytext=start,
        arrowprops=dict(
            arrowstyle="-|>", color=color, linewidth=1.1, shrinkA=3, shrinkB=3
        ),
    )
    if text:
        ax.text(
            (start[0] + end[0]) / 2,
            (start[1] + end[1]) / 2 + 0.022,
            text,
            ha="center",
            fontsize=7,
            color=color,
        )


def plot_architecture(plots: list) -> None:
    fig, ax = plt.subplots(figsize=(9.2, 4.6))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    add_box(
        ax,
        (0.03, 0.60),
        0.20,
        0.22,
        "ns-3 TCP协议栈\n五类回调采集\nACK/丢包/RTT/ECN",
        "#DCEAF7",
    )
    add_box(
        ax,
        (0.29, 0.60),
        0.22,
        0.22,
        "OpenGym状态容器\n11维有效观测\n+ 4项元数据",
        "#E8F3E8",
    )
    add_box(
        ax,
        (0.57, 0.60),
        0.20,
        0.22,
        "跨进程同步交互\nZeroMQ + Protobuf\n请求-应答",
        "#FFF7DE",
    )
    add_box(
        ax, (0.81, 0.60), 0.16, 0.22, "智能体决策\n动作对\n[ssThresh, cWnd]", "#FCE4D6"
    )
    add_box(
        ax,
        (0.05, 0.12),
        0.24,
        0.24,
        "拥塞三分类判定\n超时 0.50 / ECN 0.75\n普通丢包 0.70",
        "#F4CCCC",
    )
    add_box(
        ax,
        (0.35, 0.12),
        0.26,
        0.24,
        "两级BDP估计\n时间窗交付速率\n+ 40样本最大值滤波",
        "#EADCF8",
    )
    add_box(
        ax,
        (0.67, 0.12),
        0.28,
        0.24,
        "基线相对奖励自适应\n快/慢EMA对比\n有界步长逼近 α×BDP",
        "#D9EAD3",
    )
    add_arrow(ax, (0.23, 0.71), (0.29, 0.71), "观测")
    add_arrow(ax, (0.51, 0.71), (0.57, 0.71))
    add_arrow(ax, (0.77, 0.71), (0.81, 0.71))
    add_arrow(ax, (0.17, 0.60), (0.17, 0.36), "拥塞信号")
    add_arrow(ax, (0.44, 0.60), (0.48, 0.36), "速率样本")
    add_arrow(ax, (0.29, 0.24), (0.35, 0.24), "非拥塞路径")
    add_arrow(ax, (0.61, 0.24), (0.67, 0.24), "BDP")
    add_arrow(ax, (0.86, 0.36), (0.88, 0.60), "候选窗口", "#0072B2")
    ax.annotate(
        "",
        xy=(0.13, 0.82),
        xytext=(0.86, 0.82),
        arrowprops=dict(
            arrowstyle="-|>",
            color="#0072B2",
            linewidth=1.2,
            shrinkA=2,
            shrinkB=2,
            connectionstyle="arc3,rad=0.16",
        ),
    )
    ax.text(
        0.50,
        0.90,
        "动作 [ssThresh, cWnd] 经应答写回协议栈",
        ha="center",
        fontsize=7.5,
        color="#0072B2",
    )
    ax.text(
        0.5,
        0.97,
        "算法控制回路总体架构（v3.0.0）",
        ha="center",
        fontsize=12,
        fontweight="bold",
    )
    fig.tight_layout()
    plots.append(
        {
            "stem": "fig06_architecture_zh",
            "files": save_figure(fig, "fig06_architecture_zh"),
        }
    )


def plot_workflow(plots: list) -> None:
    fig, ax = plt.subplots(figsize=(9.4, 7.0))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    add_box(ax, (0.40, 0.93), 0.20, 0.045, "连接建立", "#EEEEEE")
    add_box(
        ax,
        (0.28, 0.795),
        0.44,
        0.095,
        "S1 状态获取：11维有效观测子空间\n窗口状态 / 传输指标 / 时延测量 / 协议栈内部状态",
        "#DCEAF7",
    )
    add_box(
        ax,
        (0.28, 0.66),
        0.44,
        0.09,
        "S2 拥塞判定\n窗口缩减回调内的三分类语义判定",
        "#FFF7DE",
    )
    add_box(
        ax,
        (0.11, 0.30),
        0.40,
        0.22,
        "S5b 差异化缩减与安全保护\n保留因子：超时 0.50 / ECN 0.75 / 丢包 0.70\n慢启动阈值锚定 min(cwnd, BDP)\n连续缩减保护 · 降窗后冻结\n窗口箝位 · 陈旧决策作废",
        "#F4CCCC",
    )
    add_box(
        ax,
        (0.58, 0.46),
        0.40,
        0.13,
        "S3 带宽延迟积两级估计\n时间窗交付速率（跨度 ≥ 2×最小RTT）\n40样本最大值滤波，BDP = 最大带宽 × 最小RTT",
        "#EADCF8",
    )
    add_box(
        ax,
        (0.58, 0.295),
        0.40,
        0.115,
        "S4 参数自适应\nRTT膨胀 + 基线相对奖励 + 连续增长\n乘性增加因子 α ∈ [0.85, 1.30]",
        "#D9EAD3",
    )
    add_box(
        ax,
        (0.58, 0.135),
        0.40,
        0.11,
        "S5a 目标窗口逼近\n目标窗口 = α × BDP\n上行有界步长 / 下行超出量的一半",
        "#E8F3E8",
    )
    add_box(
        ax,
        (0.28, 0.02),
        0.44,
        0.065,
        "S6 决策应用：更新拥塞窗口与慢启动阈值",
        "#FCE4D6",
    )
    add_arrow(ax, (0.50, 0.93), (0.50, 0.89))
    add_arrow(ax, (0.50, 0.795), (0.50, 0.75))
    add_arrow(ax, (0.40, 0.66), (0.31, 0.52), "拥塞（三类）")
    add_arrow(ax, (0.60, 0.66), (0.74, 0.59), "非拥塞")
    add_arrow(ax, (0.78, 0.46), (0.78, 0.41))
    add_arrow(ax, (0.78, 0.295), (0.78, 0.245))
    add_arrow(ax, (0.68, 0.135), (0.60, 0.085))
    add_arrow(ax, (0.31, 0.30), (0.38, 0.085))
    feedback_color = "#0072B2"
    ax.plot([0.28, 0.05], [0.0525, 0.0525], color=feedback_color, linewidth=1.2)
    ax.plot([0.05, 0.05], [0.0525, 0.8425], color=feedback_color, linewidth=1.2)
    add_arrow(ax, (0.05, 0.8425), (0.28, 0.8425), color=feedback_color)
    ax.text(
        0.038,
        0.62,
        "奖励反馈：快速EMA与慢速基线EMA更新",
        ha="center",
        va="center",
        rotation=90,
        fontsize=7.5,
        color=feedback_color,
    )
    fig.suptitle("拥塞控制方法整体流程", fontsize=12, fontweight="bold", y=0.995)
    plots.append(
        {"stem": "fig07_workflow_zh", "files": save_figure(fig, "fig07_workflow_zh")}
    )


def clean_stale_outputs() -> list[str]:
    removed = []
    for path in sorted(PLOTS_DIR.glob("fig*")):
        if path.suffix in {".png", ".pdf", ".svg"}:
            path.unlink()
            removed.append(path.name)
    return removed


def spot_check(view: dict) -> list[str]:
    checks = []
    expectations = [
        ("tcp_only", "cross_dc_wan", "TcpSwift", "Goodput_Mbps", 709.7),
        ("tcp_only", "cross_dc_wan", "TcpNewReno", "Goodput_Mbps", 998.4),
        ("tcp_only", "dc_100m", "TcpSwift", "Delay_ms", 35.42),
        ("tcp_only", "satellite_geo", "TcpSwift", "Loss_pct", 0.0),
    ]
    for setting, scenario, protocol, key, expected in expectations:
        actual = float(view[setting][scenario][protocol][key])
        ok = math.isclose(actual, expected, abs_tol=0.06)
        checks.append(
            f"{'OK ' if ok else 'FAIL'} {setting}/{scenario}/{protocol}/{key}: {actual} (thesis: {expected})"
        )
        assert ok, checks[-1]
    return checks


def main() -> None:
    configure_style()
    rows = derive_rows()
    assert len(rows) == 288, f"expected 288 artifacts, found {len(rows)}"
    csv_status = write_and_verify_csv(rows)
    result = audit(rows)
    checks = spot_check(result["view"])
    removed = clean_stale_outputs()
    plots: list[dict] = []
    plot_goodput(result["view"], plots)
    plot_delay(result["view"], plots)
    plot_tradeoff(result["view"], plots)
    plot_udp_burst(result["view"], plots)
    plot_audit_funnel(result["exclusions"], plots)
    plot_architecture(plots)
    plot_workflow(plots)
    manifest = {
        "source": "logs/comparison/*.flowmonitor + logs/comparison-udp/*.flowmonitor (288 artifacts)",
        "kpi_csv": KPI_CSV.relative_to(REPO_ROOT).as_posix(),
        "kpi_csv_status": csv_status,
        "audit_rules": {
            "A": "metrics recomputed over forward flows only (proto 6, 10.1.x -> 10.2.x)",
            "B": "groups excluded on revision mixing or whole-group old revision (sink port 5000)",
            "C": "duplicate configs excluded: dc_oversub_10to1 (= congested_heavy), satellite_leo (= lte_good)",
            "D": f"BBR data points with util < {DEGENERATE_BBR_UTIL:.0%} excluded",
        },
        "kept_groups": {
            "tcp_only": [f"{sid}={scenario}" for sid, scenario in S_ORDER],
            "udp_burst": UDP_PAIRED_SIDS,
        },
        "exclusions": result["exclusions"],
        "spot_checks_vs_thesis_tables": checks,
        "stale_outputs_removed": removed,
        "figures": plots,
    }
    (PLOTS_DIR / "figure_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                k: manifest[k]
                for k in ["kpi_csv_status", "spot_checks_vs_thesis_tables"]
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(
        f"exclusions: {len(result['exclusions'])} records; figures: {[p['stem'] for p in plots]}"
    )


if __name__ == "__main__":
    main()
