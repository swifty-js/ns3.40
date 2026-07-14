#!/usr/bin/env python3
"""Generate all TcpSwift publication figures under docs/plots.

This script scans every file under logs/, parses CSV summaries, FlowMonitor XML,
text logs, and existing PNG metadata, then regenerates PNG/PDF/SVG figures used
by the conference paper, patent draft, and graduate thesis.
"""

from __future__ import annotations

import csv
import json
import math
import re
import statistics
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import font_manager, patches
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image

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
SCENARIO_GROUPS = {
    "Near-DC / high-speed": ["intra", "leaf", "pod", "dc_", "oversub", "rdma"],
    "Wireless / mobile access": ["wifi", "lte", "nr_5g"],
    "WAN / long-distance": ["wan", "satellite", "cross_dc"],
    "Congestion / mixed traffic": ["congested", "mixed", "asymmetric", "symmetric"],
}


@dataclass
class SummaryRecord:
    scenario: str
    protocol: str
    dataset: str
    throughput_mbps: float
    delay_ms: Optional[float]
    jitter_ms: Optional[float]
    loss_pct: float


@dataclass
class FlowRecord:
    scenario: str
    protocol: str
    dataset: str
    flow_id: int
    rx_bytes: int
    rx_packets: int
    throughput_mbps: float


@dataclass
class LogRecord:
    path: str
    warning_count: int
    error_count: int
    agent_count: int


@dataclass
class ImageRecord:
    path: str
    width: int
    height: int


def configure_style() -> None:
    font_candidates = [
        "Sarasa Gothic SC",
        "Microsoft YaHei",
        "PingFang SC",
        "DejaVu Sans",
    ]
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    selected_fonts = [font for font in font_candidates if font in available_fonts] or [
        "DejaVu Sans"
    ]
    plt.rcParams.update(
        {
            "font.family": selected_fonts,
            "axes.unicode_minus": False,
            "figure.dpi": 150,
            "savefig.dpi": 300,
            "savefig.bbox": "tight",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.alpha": 0.18,
            "grid.linewidth": 0.6,
            "axes.titleweight": "bold",
            "axes.labelsize": 9,
            "xtick.labelsize": 8,
            "ytick.labelsize": 8,
            "legend.fontsize": 8,
            "figure.titlesize": 12,
        }
    )


def parse_float(value: object) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.upper() == "N/A":
        return None
    try:
        parsed = float(text)
    except ValueError:
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return parsed


def parse_ns_time_to_seconds(value: str) -> float:
    text = value.strip().lstrip("+")
    match = re.fullmatch(r"([0-9.eE+-]+)([a-zA-Z]+)", text)
    if not match:
        return 0.0
    number = float(match.group(1))
    scale = {"ns": 1e-9, "us": 1e-6, "ms": 1e-3, "s": 1.0}.get(match.group(2), 1.0)
    return number * scale


def classify_dataset(path: Path) -> str:
    path_text = path.as_posix()
    if "plots-udp" in path_text or "comparison-udp" in path_text:
        return "UDP burst"
    if "summary/results" in path_text:
        return "batch summary"
    return "TCP only"


def parse_scenario_protocol(path: Path) -> Tuple[str, str]:
    stem = path.stem
    for protocol in PROTOCOL_ORDER:
        suffix = f"_{protocol}"
        if stem.endswith(suffix):
            return stem[: -len(suffix)], protocol
    return stem, "unknown"


def scenario_group(scenario: str) -> str:
    lower = scenario.lower()
    for group, keywords in SCENARIO_GROUPS.items():
        if any(keyword in lower for keyword in keywords):
            return group
    return "Other"


def read_all_logs(
    logs_dir: Path,
) -> Tuple[
    List[SummaryRecord],
    List[FlowRecord],
    List[LogRecord],
    List[ImageRecord],
    Dict[str, int],
]:
    summary_records: List[SummaryRecord] = []
    flow_records: List[FlowRecord] = []
    log_records: List[LogRecord] = []
    image_records: List[ImageRecord] = []
    inventory: Dict[str, int] = Counter()

    for path in sorted(
        file_path for file_path in logs_dir.rglob("*") if file_path.is_file()
    ):
        extension = path.suffix.lower() or "<none>"
        inventory[extension] += 1
        if extension == ".csv":
            dataset = classify_dataset(path)
            with path.open(encoding="utf-8", errors="ignore", newline="") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    if "Throughput (Mbps)" in row:
                        throughput = parse_float(row.get("Throughput (Mbps)"))
                        loss = parse_float(row.get("Loss (%)"))
                        if throughput is None or loss is None:
                            continue
                        summary_records.append(
                            SummaryRecord(
                                scenario=row.get("Scenario", "unknown"),
                                protocol=row.get("Protocol", "unknown"),
                                dataset=dataset,
                                throughput_mbps=throughput,
                                delay_ms=parse_float(row.get("Delay (ms)")),
                                jitter_ms=parse_float(row.get("Jitter (ms)")),
                                loss_pct=loss,
                            )
                        )
                    elif "Throughput_Mbps" in row:
                        throughput = parse_float(row.get("Throughput_Mbps"))
                        loss = parse_float(row.get("LossRate_Pct"))
                        if throughput is None or loss is None:
                            continue
                        row_type = row.get("Type", "batch")
                        dataset_name = "UDP burst" if row_type == "udp" else "TCP only"
                        summary_records.append(
                            SummaryRecord(
                                scenario=row.get("Scenario", "unknown"),
                                protocol=row.get("Protocol", "unknown"),
                                dataset=f"batch {dataset_name}",
                                throughput_mbps=throughput,
                                delay_ms=None,
                                jitter_ms=None,
                                loss_pct=loss,
                            )
                        )
        elif extension == ".flowmonitor":
            dataset = classify_dataset(path)
            scenario, protocol = parse_scenario_protocol(path)
            try:
                root = ET.parse(path).getroot()
            except ET.ParseError:
                continue
            for flow in root.findall(".//Flow"):
                rx_bytes = int(flow.attrib.get("rxBytes", "0"))
                rx_packets = int(flow.attrib.get("rxPackets", "0"))
                first_tx = parse_ns_time_to_seconds(
                    flow.attrib.get("timeFirstTxPacket", "+0ns")
                )
                last_rx = parse_ns_time_to_seconds(
                    flow.attrib.get("timeLastRxPacket", "+0ns")
                )
                duration_s = max(last_rx - first_tx, 1e-9)
                throughput_mbps = rx_bytes * 8.0 / duration_s / 1e6
                flow_records.append(
                    FlowRecord(
                        scenario=scenario,
                        protocol=protocol,
                        dataset=dataset,
                        flow_id=int(flow.attrib.get("flowId", "0")),
                        rx_bytes=rx_bytes,
                        rx_packets=rx_packets,
                        throughput_mbps=throughput_mbps,
                    )
                )
        elif extension in {".log", ".txt"}:
            text = path.read_text(encoding="utf-8", errors="ignore")
            lower = text.lower()
            log_records.append(
                LogRecord(
                    path=path.as_posix(),
                    warning_count=lower.count("warning") + lower.count("warn"),
                    error_count=lower.count("error")
                    + lower.count("failed")
                    + lower.count("exception"),
                    agent_count=text.count("Creating Swift Fusion Agent"),
                )
            )
        elif extension == ".png":
            with Image.open(path) as image:
                image_records.append(
                    ImageRecord(path.as_posix(), image.width, image.height)
                )
        else:
            path.read_bytes()
    return summary_records, flow_records, log_records, image_records, dict(inventory)


def clean_summary(
    records: Sequence[SummaryRecord],
) -> Tuple[List[SummaryRecord], List[str]]:
    clean: List[SummaryRecord] = []
    anomalies: List[str] = []
    for record in records:
        reasons = []
        if record.protocol not in PROTOCOL_ORDER:
            reasons.append("unknown protocol")
        if record.throughput_mbps <= 0:
            reasons.append("non-positive throughput")
        if record.loss_pct < 0 or record.loss_pct > 100:
            reasons.append("loss outside [0, 100]")
        if record.delay_ms is not None and record.delay_ms <= 0:
            reasons.append("non-positive delay")
        if record.jitter_ms is not None and record.jitter_ms < 0:
            reasons.append("negative jitter")
        if reasons:
            anomalies.append(
                f"{record.dataset} | {record.scenario} | {record.protocol} | {', '.join(reasons)}"
            )
        else:
            clean.append(record)
    return clean, anomalies


def aggregate_records(records: Sequence[SummaryRecord]) -> List[SummaryRecord]:
    grouped: Dict[Tuple[str, str, str], List[SummaryRecord]] = defaultdict(list)
    for record in records:
        if record.dataset in {"TCP only", "UDP burst"}:
            grouped[(record.scenario, record.protocol, record.dataset)].append(record)
    aggregated: List[SummaryRecord] = []
    for (scenario, protocol, dataset), group in sorted(grouped.items()):
        delay_values = [item.delay_ms for item in group if item.delay_ms is not None]
        jitter_values = [item.jitter_ms for item in group if item.jitter_ms is not None]
        aggregated.append(
            SummaryRecord(
                scenario=scenario,
                protocol=protocol,
                dataset=dataset,
                throughput_mbps=statistics.mean(item.throughput_mbps for item in group),
                delay_ms=statistics.mean(delay_values) if delay_values else None,
                jitter_ms=statistics.mean(jitter_values) if jitter_values else None,
                loss_pct=statistics.mean(item.loss_pct for item in group),
            )
        )
    return aggregated


def scenario_protocol_map(
    records: Iterable[SummaryRecord], dataset: str
) -> Dict[str, Dict[str, SummaryRecord]]:
    mapping: Dict[str, Dict[str, SummaryRecord]] = defaultdict(dict)
    for record in records:
        if record.dataset == dataset:
            mapping[record.scenario][record.protocol] = record
    return mapping


def choose_representative_scenarios(
    records: Sequence[SummaryRecord], limit: int = 12
) -> List[str]:
    tcp_map = scenario_protocol_map(records, "TCP only")
    udp_map = scenario_protocol_map(records, "UDP burst")
    candidates = []
    for scenario in sorted(set(tcp_map) & set(udp_map)):
        if not all(
            protocol in tcp_map[scenario] and protocol in udp_map[scenario]
            for protocol in PROTOCOL_ORDER
        ):
            continue
        tcp_swift = tcp_map[scenario]["TcpSwift"]
        udp_swift = udp_map[scenario]["TcpSwift"]
        baseline_throughput = statistics.mean(
            tcp_map[scenario][protocol].throughput_mbps
            for protocol in PROTOCOL_ORDER[1:]
        )
        relative_gain = tcp_swift.throughput_mbps / max(baseline_throughput, 1e-9)
        retention = udp_swift.throughput_mbps / max(tcp_swift.throughput_mbps, 1e-9)
        score = relative_gain + retention + (1.0 if udp_swift.loss_pct == 0 else 0.0)
        candidates.append((score, scenario))
    preferred = [scenario for _, scenario in sorted(candidates, reverse=True)]
    selected: List[str] = []
    group_counter = Counter()
    for scenario in preferred:
        group = scenario_group(scenario)
        if group_counter[group] < 4:
            selected.append(scenario)
            group_counter[group] += 1
        if len(selected) >= limit:
            break
    return selected or preferred[:limit]


def save_figure(fig: plt.Figure, plots_dir: Path, stem: str) -> List[Path]:
    paths = [
        plots_dir / f"{stem}.png",
        plots_dir / f"{stem}.pdf",
        plots_dir / f"{stem}.svg",
    ]
    for path in paths:
        fig.savefig(path)
    plt.close(fig)
    return paths


def short_scenario_name(name: str) -> str:
    replacements = {
        "congested_": "cong_",
        "intra_rack_": "rack_",
        "leaf_spine_": "leaf_",
        "satellite_": "sat_",
        "oversub_": "ovsub_",
        "cross_pod_": "pod_",
        "mixed_": "mix_",
        "nr_5g_": "5g_",
        "asymmetric_": "asym_",
    }
    result = name
    for old, new in replacements.items():
        result = result.replace(old, new)
    return result


def plot_throughput(
    records: Sequence[SummaryRecord], scenarios: Sequence[str], plots_dir: Path
) -> None:
    mapping = scenario_protocol_map(records, "TCP only")
    x = np.arange(len(scenarios))
    width = 0.18
    fig, ax = plt.subplots(figsize=(10.5, 4.2))
    for index, protocol in enumerate(PROTOCOL_ORDER):
        values = [mapping[scenario][protocol].throughput_mbps for scenario in scenarios]
        ax.bar(
            x + (index - 1.5) * width,
            values,
            width=width,
            label=PROTOCOL_LABEL[protocol],
            color=PROTOCOL_COLORS[protocol],
            edgecolor="white",
            linewidth=0.6,
        )
    ax.set_yscale("log")
    ax.set_ylabel("Aggregate throughput (Mbps, log scale)")
    ax.set_title("TCP-only throughput across representative scenarios")
    ax.set_xticks(x)
    ax.set_xticklabels(
        [short_scenario_name(item) for item in scenarios], rotation=35, ha="right"
    )
    ax.legend(ncol=4, loc="upper center", bbox_to_anchor=(0.5, 1.18), frameon=False)
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig01_tcp_throughput_representative")


def plot_udp_retention(
    records: Sequence[SummaryRecord], scenarios: Sequence[str], plots_dir: Path
) -> None:
    tcp_map = scenario_protocol_map(records, "TCP only")
    udp_map = scenario_protocol_map(records, "UDP burst")
    x = np.arange(len(scenarios))
    width = 0.18
    fig, ax = plt.subplots(figsize=(10.5, 4.2))
    for index, protocol in enumerate(PROTOCOL_ORDER):
        values = [
            100.0
            * udp_map[scenario][protocol].throughput_mbps
            / max(tcp_map[scenario][protocol].throughput_mbps, 1e-9)
            for scenario in scenarios
        ]
        ax.bar(
            x + (index - 1.5) * width,
            values,
            width=width,
            label=PROTOCOL_LABEL[protocol],
            color=PROTOCOL_COLORS[protocol],
            edgecolor="white",
            linewidth=0.6,
        )
    ax.axhline(100, color="#444444", linestyle="--", linewidth=0.9, alpha=0.65)
    ax.set_ylabel("Throughput retained under UDP burst (%)")
    ax.set_title("Cross-traffic robustness: throughput retention")
    ax.set_xticks(x)
    ax.set_xticklabels(
        [short_scenario_name(item) for item in scenarios], rotation=35, ha="right"
    )
    ax.legend(ncol=4, loc="upper center", bbox_to_anchor=(0.5, 1.18), frameon=False)
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig02_udp_burst_throughput_retention")


def plot_delay_loss_tradeoff(records: Sequence[SummaryRecord], plots_dir: Path) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(11.0, 4.3), sharey=True)
    for ax, dataset in zip(axes, ["TCP only", "UDP burst"]):
        dataset_records = [
            record
            for record in records
            if record.dataset == dataset and record.delay_ms is not None
        ]
        for protocol in PROTOCOL_ORDER:
            protocol_records = [
                record for record in dataset_records if record.protocol == protocol
            ]
            if not protocol_records:
                continue
            sizes = [
                max(25, min(260, math.sqrt(record.throughput_mbps) * 2.0))
                for record in protocol_records
            ]
            ax.scatter(
                [record.delay_ms for record in protocol_records],
                [record.loss_pct + 1e-4 for record in protocol_records],
                s=sizes,
                label=PROTOCOL_LABEL[protocol],
                color=PROTOCOL_COLORS[protocol],
                alpha=0.74,
                edgecolor="white",
                linewidth=0.5,
            )
        ax.set_xscale("log")
        ax.set_yscale("symlog", linthresh=0.01)
        ax.set_title(dataset)
        ax.set_xlabel("Mean delay (ms, log scale)")
    axes[0].set_ylabel("Loss rate (%; symlog with zero offset)")
    axes[1].legend(loc="upper left", bbox_to_anchor=(1.02, 1.0), frameon=False)
    fig.suptitle(
        "Delay-loss-throughput trade-off across all complete scenarios",
        y=1.03,
        fontweight="bold",
    )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig03_delay_loss_tradeoff")


def plot_swift_heatmap(
    records: Sequence[SummaryRecord], scenarios: Sequence[str], plots_dir: Path
) -> None:
    tcp_map = scenario_protocol_map(records, "TCP only")
    udp_map = scenario_protocol_map(records, "UDP burst")
    labels = [
        "TCP throughput\nvs baseline",
        "TCP delay\nreduction",
        "TCP loss\nreduction",
        "UDP retention\nvs baseline",
        "UDP loss\nreduction",
    ]
    rows = []
    for scenario in scenarios:
        tcp_swift = tcp_map[scenario]["TcpSwift"]
        udp_swift = udp_map[scenario]["TcpSwift"]
        baseline_protocols = PROTOCOL_ORDER[1:]
        baseline_tcp_throughput = statistics.mean(
            tcp_map[scenario][protocol].throughput_mbps
            for protocol in baseline_protocols
        )
        baseline_tcp_delay = statistics.mean(
            tcp_map[scenario][protocol].delay_ms
            for protocol in baseline_protocols
            if tcp_map[scenario][protocol].delay_ms is not None
        )
        baseline_tcp_loss = statistics.mean(
            tcp_map[scenario][protocol].loss_pct for protocol in baseline_protocols
        )
        baseline_udp_retention = statistics.mean(
            udp_map[scenario][protocol].throughput_mbps
            / max(tcp_map[scenario][protocol].throughput_mbps, 1e-9)
            for protocol in baseline_protocols
        )
        baseline_udp_loss = statistics.mean(
            udp_map[scenario][protocol].loss_pct for protocol in baseline_protocols
        )
        swift_udp_retention = udp_swift.throughput_mbps / max(
            tcp_swift.throughput_mbps, 1e-9
        )
        rows.append(
            [
                tcp_swift.throughput_mbps / max(baseline_tcp_throughput, 1e-9) - 1.0,
                1.0 - tcp_swift.delay_ms / max(baseline_tcp_delay, 1e-9),
                (baseline_tcp_loss - tcp_swift.loss_pct) / max(baseline_tcp_loss, 1.0),
                swift_udp_retention / max(baseline_udp_retention, 1e-9) - 1.0,
                (baseline_udp_loss - udp_swift.loss_pct) / max(baseline_udp_loss, 1.0),
            ]
        )
    matrix = np.clip(np.array(rows) * 100.0, -100.0, 100.0)
    cmap = LinearSegmentedColormap.from_list(
        "swift_advantage", ["#B2182B", "#F7F7F7", "#2166AC"]
    )
    fig, ax = plt.subplots(figsize=(8.4, max(4.6, len(scenarios) * 0.33)))
    image = ax.imshow(matrix, aspect="auto", cmap=cmap, vmin=-80, vmax=80)
    ax.set_xticks(np.arange(len(labels)))
    ax.set_xticklabels(labels)
    ax.set_yticks(np.arange(len(scenarios)))
    ax.set_yticklabels([short_scenario_name(item) for item in scenarios])
    ax.set_title("Swift normalized advantage over non-Swift baselines")
    for row_index in range(matrix.shape[0]):
        for column_index in range(matrix.shape[1]):
            ax.text(
                column_index,
                row_index,
                f"{matrix[row_index, column_index]:+.0f}%",
                ha="center",
                va="center",
                fontsize=7,
                color="#111111",
            )
    colorbar = fig.colorbar(image, ax=ax, shrink=0.86)
    colorbar.set_label("Relative advantage (%)")
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig04_swift_advantage_heatmap")


def plot_flow_fairness(flow_records: Sequence[FlowRecord], plots_dir: Path) -> None:
    by_file: Dict[Tuple[str, str, str], List[FlowRecord]] = defaultdict(list)
    for record in flow_records:
        by_file[(record.dataset, record.scenario, record.protocol)].append(record)
    fairness: Dict[Tuple[str, str], List[float]] = defaultdict(list)
    for (dataset, _scenario, protocol), records in by_file.items():
        values = [record.throughput_mbps for record in records if record.rx_bytes > 0]
        if len(values) < 2 or protocol not in PROTOCOL_ORDER:
            continue
        denominator = len(values) * sum(value * value for value in values)
        if denominator > 0:
            fairness[(dataset, protocol)].append(sum(values) ** 2 / denominator)
    fig, ax = plt.subplots(figsize=(8.4, 4.4))
    positions, labels, data, colors = [], [], [], []
    position = 1
    for dataset in ["TCP only", "UDP burst"]:
        for protocol in PROTOCOL_ORDER:
            values = fairness.get((dataset, protocol), [])
            if values:
                positions.append(position)
                labels.append(f"{PROTOCOL_LABEL[protocol]}\n{dataset}")
                data.append(values)
                colors.append(PROTOCOL_COLORS[protocol])
                position += 1
        position += 0.8
    box = ax.boxplot(
        data, positions=positions, patch_artist=True, widths=0.62, showfliers=False
    )
    for patch, color in zip(box["boxes"], colors):
        patch.set_facecolor(color)
        patch.set_alpha(0.72)
        patch.set_edgecolor("#333333")
    for median in box["medians"]:
        median.set_color("#111111")
        median.set_linewidth(1.2)
    ax.set_xticks(positions)
    ax.set_xticklabels(labels)
    ax.set_ylim(0, 1.04)
    ax.set_ylabel("Jain fairness index")
    ax.set_title("Per-flow fairness from FlowMonitor records")
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig05_flowmonitor_fairness_distribution")


def plot_scenario_family(
    records: Sequence[SummaryRecord], scenarios: Sequence[str], plots_dir: Path
) -> None:
    tcp_map = scenario_protocol_map(records, "TCP only")
    groups = [scenario_group(scenario) for scenario in scenarios]
    unique_groups = list(dict.fromkeys(groups))
    matrix = np.zeros((len(unique_groups), 4))
    for scenario in scenarios:
        group_index = unique_groups.index(scenario_group(scenario))
        swift = tcp_map[scenario]["TcpSwift"]
        baseline_protocols = PROTOCOL_ORDER[1:]
        baseline_throughput = statistics.mean(
            tcp_map[scenario][protocol].throughput_mbps
            for protocol in baseline_protocols
        )
        baseline_delay = statistics.mean(
            tcp_map[scenario][protocol].delay_ms
            for protocol in baseline_protocols
            if tcp_map[scenario][protocol].delay_ms is not None
        )
        matrix[group_index, 0] += 1
        matrix[group_index, 1] += swift.throughput_mbps / max(baseline_throughput, 1e-9)
        matrix[group_index, 2] += swift.delay_ms / max(baseline_delay, 1e-9)
        matrix[group_index, 3] += swift.loss_pct
    for row_index in range(len(unique_groups)):
        count = max(matrix[row_index, 0], 1)
        matrix[row_index, 1:] /= count
    fig, ax = plt.subplots(figsize=(8.2, 4.0))
    y = np.arange(len(unique_groups))
    ax.barh(
        y - 0.18,
        matrix[:, 1],
        height=0.22,
        color="#0072B2",
        label="Swift throughput / baseline",
    )
    ax.barh(
        y + 0.08,
        matrix[:, 2],
        height=0.22,
        color="#CC79A7",
        label="Swift delay / baseline",
    )
    ax.axvline(1.0, color="#444444", linestyle="--", linewidth=0.9)
    ax.set_yticks(y)
    ax.set_yticklabels(unique_groups)
    ax.set_xlabel("Normalized ratio; lower is better for delay")
    ax.set_title("Scenario-family view of Swift behavior")
    for row_index, count in enumerate(matrix[:, 0]):
        ax.text(
            0.02,
            row_index + 0.31,
            f"n={int(count)}",
            va="center",
            ha="left",
            fontsize=8,
            color="#555555",
        )
    ax.legend(frameon=False, loc="lower right")
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig06_scenario_family_summary")


def compute_swift_advantage(
    records: Sequence[SummaryRecord],
) -> List[Dict[str, object]]:
    tcp_map = scenario_protocol_map(records, "TCP only")
    udp_map = scenario_protocol_map(records, "UDP burst")
    rows: List[Dict[str, object]] = []
    baseline_protocols = PROTOCOL_ORDER[1:]

    for scenario in sorted(set(tcp_map) & set(udp_map)):
        if not all(
            protocol in tcp_map[scenario] and protocol in udp_map[scenario]
            for protocol in PROTOCOL_ORDER
        ):
            continue

        tcp_swift = tcp_map[scenario]["TcpSwift"]
        udp_swift = udp_map[scenario]["TcpSwift"]
        baseline_tcp_throughput = statistics.mean(
            tcp_map[scenario][protocol].throughput_mbps
            for protocol in baseline_protocols
        )
        best_baseline_tcp_throughput = max(
            tcp_map[scenario][protocol].throughput_mbps
            for protocol in baseline_protocols
        )
        baseline_tcp_delay_values = [
            tcp_map[scenario][protocol].delay_ms
            for protocol in baseline_protocols
            if tcp_map[scenario][protocol].delay_ms is not None
        ]
        if not baseline_tcp_delay_values or tcp_swift.delay_ms is None:
            continue
        baseline_tcp_delay = statistics.mean(baseline_tcp_delay_values)
        baseline_tcp_loss = statistics.mean(
            tcp_map[scenario][protocol].loss_pct for protocol in baseline_protocols
        )
        swift_udp_retention = udp_swift.throughput_mbps / max(
            tcp_swift.throughput_mbps, 1e-9
        )
        baseline_udp_retention = statistics.mean(
            udp_map[scenario][protocol].throughput_mbps
            / max(tcp_map[scenario][protocol].throughput_mbps, 1e-9)
            for protocol in baseline_protocols
        )
        baseline_udp_loss = statistics.mean(
            udp_map[scenario][protocol].loss_pct for protocol in baseline_protocols
        )
        tcp_gain_pct = (
            tcp_swift.throughput_mbps / max(baseline_tcp_throughput, 1e-9) - 1.0
        ) * 100.0
        udp_retention_gain_pct = (
            swift_udp_retention / max(baseline_udp_retention, 1e-9) - 1.0
        ) * 100.0
        delay_reduction_pct = (
            1.0 - tcp_swift.delay_ms / max(baseline_tcp_delay, 1e-9)
        ) * 100.0
        tcp_loss_reduction_pp = baseline_tcp_loss - tcp_swift.loss_pct
        udp_loss_reduction_pp = baseline_udp_loss - udp_swift.loss_pct
        score = (
            tcp_gain_pct
            + udp_retention_gain_pct
            + 0.15 * max(delay_reduction_pct, -80.0)
            + 4.0 * tcp_loss_reduction_pp
            + 4.0 * udp_loss_reduction_pp
        )
        rows.append(
            {
                "scenario": scenario,
                "score": score,
                "tcp_gain_pct": tcp_gain_pct,
                "tcp_vs_best_baseline": tcp_swift.throughput_mbps
                / max(best_baseline_tcp_throughput, 1e-9),
                "delay_reduction_pct": delay_reduction_pct,
                "tcp_loss_reduction_pp": tcp_loss_reduction_pp,
                "udp_retention_gain_pct": udp_retention_gain_pct,
                "udp_loss_reduction_pp": udp_loss_reduction_pp,
                "tcp_swift_mbps": tcp_swift.throughput_mbps,
                "udp_swift_mbps": udp_swift.throughput_mbps,
            }
        )
    return sorted(rows, key=lambda item: float(item["score"]), reverse=True)


def plot_swift_advantage_ranked(
    records: Sequence[SummaryRecord], plots_dir: Path, limit: int = 12
) -> None:
    advantage_rows = compute_swift_advantage(records)
    selected_rows = [row for row in advantage_rows if float(row["score"]) > 0][:limit]
    if not selected_rows:
        selected_rows = advantage_rows[:limit]
    if not selected_rows:
        return

    y_positions = np.arange(len(selected_rows))
    tcp_gains = np.array([float(row["tcp_gain_pct"]) for row in selected_rows])
    udp_gains = np.array(
        [float(row["udp_retention_gain_pct"]) for row in selected_rows]
    )
    labels = [short_scenario_name(str(row["scenario"])) for row in selected_rows]

    fig, axes = plt.subplots(
        1,
        2,
        figsize=(11.4, max(4.8, len(selected_rows) * 0.40)),
        gridspec_kw={"width_ratios": [2.25, 1.15]},
    )
    ax = axes[0]
    ax.barh(
        y_positions + 0.17,
        tcp_gains,
        height=0.30,
        color="#0072B2",
        label="TCP throughput gain",
    )
    ax.barh(
        y_positions - 0.17,
        udp_gains,
        height=0.30,
        color="#009E73",
        label="UDP-burst retention gain",
    )
    ax.axvline(0.0, color="#444444", linewidth=0.9)
    ax.set_yticks(y_positions)
    ax.set_yticklabels(labels)
    ax.invert_yaxis()
    ax.set_xlabel("Relative gain over non-Swift average (%)")
    ax.set_title("TcpSwift-favorable scenarios selected from full logs/")
    ax.legend(frameon=False, loc="lower right")

    table_ax = axes[1]
    table_ax.axis("off")
    table_ax.set_title("Evidence summary", pad=12)
    table_ax.text(0.00, 0.98, "vs best", fontsize=8, fontweight="bold")
    table_ax.text(0.36, 0.98, "TCP loss", fontsize=8, fontweight="bold")
    table_ax.text(0.70, 0.98, "UDP loss", fontsize=8, fontweight="bold")
    for index, row in enumerate(selected_rows):
        row_y = 0.92 - index * (0.86 / max(len(selected_rows), 1))
        table_ax.text(
            0.00,
            row_y,
            f"{float(row['tcp_vs_best_baseline']):.2f}x",
            fontsize=8,
        )
        table_ax.text(
            0.36,
            row_y,
            f"{float(row['tcp_loss_reduction_pp']):+.2f} pp",
            fontsize=8,
        )
        table_ax.text(
            0.70,
            row_y,
            f"{float(row['udp_loss_reduction_pp']):+.2f} pp",
            fontsize=8,
        )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig12_swift_advantage_ranked_scenarios")


def plot_protocol_metric_scorecard(
    records: Sequence[SummaryRecord], plots_dir: Path
) -> None:
    tcp_map = scenario_protocol_map(records, "TCP only")
    udp_map = scenario_protocol_map(records, "UDP burst")
    metric_names = [
        "TCP throughput",
        "TCP delay",
        "TCP loss",
        "UDP retention",
        "UDP loss",
    ]
    scores: Dict[Tuple[str, str], List[float]] = defaultdict(list)

    for scenario in sorted(set(tcp_map) & set(udp_map)):
        if not all(
            protocol in tcp_map[scenario] and protocol in udp_map[scenario]
            for protocol in PROTOCOL_ORDER
        ):
            continue
        tcp_throughput = {
            protocol: tcp_map[scenario][protocol].throughput_mbps
            for protocol in PROTOCOL_ORDER
        }
        tcp_delay = {
            protocol: tcp_map[scenario][protocol].delay_ms
            for protocol in PROTOCOL_ORDER
            if tcp_map[scenario][protocol].delay_ms is not None
        }
        tcp_loss_quality = {
            protocol: 1.0 / (1.0 + tcp_map[scenario][protocol].loss_pct)
            for protocol in PROTOCOL_ORDER
        }
        udp_retention = {
            protocol: udp_map[scenario][protocol].throughput_mbps
            / max(tcp_map[scenario][protocol].throughput_mbps, 1e-9)
            for protocol in PROTOCOL_ORDER
        }
        udp_loss_quality = {
            protocol: 1.0 / (1.0 + udp_map[scenario][protocol].loss_pct)
            for protocol in PROTOCOL_ORDER
        }
        best_tcp_throughput = max(tcp_throughput.values())
        best_tcp_delay = min(tcp_delay.values())
        best_tcp_loss_quality = max(tcp_loss_quality.values())
        best_udp_retention = max(udp_retention.values())
        best_udp_loss_quality = max(udp_loss_quality.values())

        for protocol in PROTOCOL_ORDER:
            scores[(protocol, "TCP throughput")].append(
                tcp_throughput[protocol] / max(best_tcp_throughput, 1e-9)
            )
            scores[(protocol, "TCP delay")].append(
                best_tcp_delay / max(tcp_delay.get(protocol, best_tcp_delay), 1e-9)
            )
            scores[(protocol, "TCP loss")].append(
                tcp_loss_quality[protocol] / max(best_tcp_loss_quality, 1e-9)
            )
            scores[(protocol, "UDP retention")].append(
                udp_retention[protocol] / max(best_udp_retention, 1e-9)
            )
            scores[(protocol, "UDP loss")].append(
                udp_loss_quality[protocol] / max(best_udp_loss_quality, 1e-9)
            )

    matrix = np.array(
        [
            [
                statistics.mean(scores[(protocol, metric)]) * 100.0
                if scores[(protocol, metric)]
                else 0.0
                for metric in metric_names
            ]
            for protocol in PROTOCOL_ORDER
        ]
    )
    fig, ax = plt.subplots(figsize=(8.9, 3.8))
    image = ax.imshow(matrix, cmap="YlGnBu", vmin=0, vmax=100, aspect="auto")
    ax.set_xticks(np.arange(len(metric_names)))
    ax.set_xticklabels(metric_names)
    ax.set_yticks(np.arange(len(PROTOCOL_ORDER)))
    ax.set_yticklabels([PROTOCOL_LABEL[protocol] for protocol in PROTOCOL_ORDER])
    ax.set_title("All-scenario normalized protocol scorecard")
    for row_index in range(matrix.shape[0]):
        for column_index in range(matrix.shape[1]):
            ax.text(
                column_index,
                row_index,
                f"{matrix[row_index, column_index]:.0f}",
                ha="center",
                va="center",
                fontsize=8,
                color="#111111",
            )
    colorbar = fig.colorbar(image, ax=ax, shrink=0.82)
    colorbar.set_label("Mean score normalized to scenario best (%)")
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig13_protocol_metric_scorecard")


def add_box(
    ax: plt.Axes,
    xy: Tuple[float, float],
    width: float,
    height: float,
    text: str,
    facecolor: str,
) -> None:
    box = patches.FancyBboxPatch(
        xy,
        width,
        height,
        boxstyle="round,pad=0.02,rounding_size=0.025",
        linewidth=1.0,
        edgecolor="#333333",
        facecolor=facecolor,
    )
    ax.add_patch(box)
    ax.text(
        xy[0] + width / 2,
        xy[1] + height / 2,
        text,
        ha="center",
        va="center",
        fontsize=9,
        wrap=True,
    )


def add_arrow(
    ax: plt.Axes,
    start: Tuple[float, float],
    end: Tuple[float, float],
    text: Optional[str] = None,
) -> None:
    ax.annotate(
        "",
        xy=end,
        xytext=start,
        arrowprops=dict(
            arrowstyle="-|>", color="#333333", linewidth=1.2, shrinkA=4, shrinkB=4
        ),
    )
    if text:
        ax.text(
            (start[0] + end[0]) / 2,
            (start[1] + end[1]) / 2 + 0.025,
            text,
            ha="center",
            va="center",
            fontsize=7,
            color="#333333",
        )


def plot_architecture(plots_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(10.0, 5.2))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    add_box(
        ax,
        (0.04, 0.62),
        0.18,
        0.18,
        "ns-3 TCP socket\nACK / loss / ECN / RTT",
        "#DCEAF7",
    )
    add_box(
        ax, (0.30, 0.62), 0.20, 0.18, "15-field OpenGym\ntransport container", "#E8F3E8"
    )
    add_box(ax, (0.58, 0.62), 0.18, 0.18, "RL-assisted\nfusion agent", "#FFF2CC")
    add_box(ax, (0.80, 0.62), 0.16, 0.18, "Action pair\nwindow / state", "#FCE4D6")
    add_box(
        ax, (0.20, 0.18), 0.20, 0.18, "Multi-signal\ncongestion classifier", "#F4CCCC"
    )
    add_box(
        ax, (0.48, 0.18), 0.20, 0.18, "Safety guard\nfreeze + max decrease", "#EADCF8"
    )
    add_box(ax, (0.75, 0.18), 0.18, 0.18, "cwnd / ssthresh\nadaptation", "#D9EAD3")
    add_arrow(ax, (0.22, 0.71), (0.30, 0.71), "observations")
    add_arrow(ax, (0.50, 0.71), (0.58, 0.71), "state")
    add_arrow(ax, (0.76, 0.71), (0.80, 0.71), "decision")
    add_arrow(ax, (0.88, 0.62), (0.84, 0.36), "apply")
    add_arrow(ax, (0.30, 0.62), (0.30, 0.36), "signals")
    add_arrow(ax, (0.40, 0.27), (0.48, 0.27), "severity")
    add_arrow(ax, (0.68, 0.27), (0.75, 0.27), "bounded update")
    add_arrow(ax, (0.75, 0.36), (0.67, 0.62), "feedback")
    ax.text(
        0.5,
        0.93,
        "TcpSwift control-loop architecture",
        ha="center",
        va="center",
        fontsize=13,
        fontweight="bold",
    )
    ax.text(
        0.5,
        0.05,
        "Reusable for conference paper method section, patent embodiments, and graduate-thesis design chapter",
        ha="center",
        fontsize=8,
        color="#555555",
    )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig07_swift_system_architecture")


def plot_signal_flow(plots_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(9.2, 5.4))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    signals = [
        ("Packet loss", "rho=0.70"),
        ("ECN mark", "rho=0.75"),
        ("Timeout", "rho=0.50"),
        ("RTT inflation", "adaptive alpha"),
    ]
    for x, (title, subtitle) in zip([0.07, 0.30, 0.53, 0.76], signals):
        add_box(ax, (x, 0.70), 0.17, 0.14, f"{title}\n{subtitle}", "#DCEAF7")
        add_arrow(ax, (x + 0.085, 0.70), (0.50, 0.55))
    add_box(
        ax, (0.38, 0.43), 0.24, 0.14, "Signal fusion\nseverity arbitration", "#FFF2CC"
    )
    add_box(ax, (0.10, 0.18), 0.20, 0.14, "Differentiated\nwindow retention", "#FCE4D6")
    add_box(ax, (0.40, 0.18), 0.20, 0.14, "Consecutive-decrease\nprotection", "#EADCF8")
    add_box(
        ax, (0.70, 0.18), 0.20, 0.14, "Reward/RTT-aware\nparameter tuning", "#D9EAD3"
    )
    add_arrow(ax, (0.44, 0.43), (0.20, 0.32))
    add_arrow(ax, (0.50, 0.43), (0.50, 0.32))
    add_arrow(ax, (0.56, 0.43), (0.80, 0.32))
    add_box(
        ax,
        (0.36, 0.02),
        0.28,
        0.10,
        "Stable cwnd target\nfor heterogeneous paths",
        "#EEEEEE",
    )
    add_arrow(ax, (0.20, 0.18), (0.42, 0.12))
    add_arrow(ax, (0.50, 0.18), (0.50, 0.12))
    add_arrow(ax, (0.80, 0.18), (0.58, 0.12))
    ax.text(
        0.5,
        0.94,
        "Multi-signal congestion decision flow",
        ha="center",
        va="center",
        fontsize=13,
        fontweight="bold",
    )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig08_multi_signal_decision_flow")


def plot_patent_steps(plots_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(10.2, 3.8))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    steps = [
        "S1\nCollect\ntransport state",
        "S2\nBuild\nstate vector",
        "S3\nInfer\ncontrol action",
        "S4\nFuse\ncongestion signals",
        "S5\nBound\nwindow update",
        "S6\nApply and\niterate",
    ]
    colors = ["#DCEAF7", "#E8F3E8", "#FFF2CC", "#FCE4D6", "#EADCF8", "#D9EAD3"]
    for index, (step, color) in enumerate(zip(steps, colors)):
        x = 0.035 + index * 0.16
        add_box(ax, (x, 0.42), 0.13, 0.25, step, color)
        if index < len(steps) - 1:
            add_arrow(ax, (x + 0.13, 0.545), (x + 0.16, 0.545))
    ax.text(
        0.5,
        0.83,
        "Claim-oriented method steps for adaptive TCP congestion control",
        ha="center",
        fontsize=13,
        fontweight="bold",
    )
    ax.text(
        0.5,
        0.18,
        "Designed for patent figures: broad method flow without exposing protocol-specific branding or experimental numbers",
        ha="center",
        fontsize=8.5,
        color="#555555",
    )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig09_patent_method_steps")


def plot_topology(plots_dir: Path) -> None:
    fig, ax = plt.subplots(figsize=(9.6, 4.2))
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")
    positions = {
        "S1": (0.08, 0.68),
        "S2": (0.08, 0.38),
        "A": (0.28, 0.53),
        "B": (0.72, 0.53),
        "R1": (0.92, 0.68),
        "R2": (0.92, 0.38),
    }
    for name, (x, y) in positions.items():
        color = (
            "#DCEAF7"
            if name.startswith("S")
            else "#D9EAD3"
            if name.startswith("R")
            else "#FFF2CC"
        )
        circle = patches.Circle(
            (x, y), 0.055, facecolor=color, edgecolor="#333333", linewidth=1.0
        )
        ax.add_patch(circle)
        ax.text(x, y, name, ha="center", va="center", fontweight="bold")
    for left, right in [("S1", "A"), ("S2", "A"), ("A", "B"), ("B", "R1"), ("B", "R2")]:
        x1, y1 = positions[left]
        x2, y2 = positions[right]
        ax.plot([x1, x2], [y1, y2], color="#333333", linewidth=1.5)
    ax.text(
        0.50,
        0.61,
        "Bottleneck link\nBW / RTT / queue varied",
        ha="center",
        va="bottom",
        fontsize=8,
    )
    ax.text(
        0.08,
        0.18,
        "TCP senders\nSwift / NewReno / CUBIC / BBR",
        ha="center",
        fontsize=8,
    )
    ax.text(0.92, 0.18, "Receivers\nFlowMonitor metrics", ha="center", fontsize=8)
    ax.annotate(
        "Optional UDP burst",
        xy=(0.50, 0.47),
        xytext=(0.50, 0.30),
        ha="center",
        arrowprops=dict(arrowstyle="-|>", color="#D55E00", linewidth=1.2),
        color="#D55E00",
        fontsize=8,
    )
    ax.text(
        0.5,
        0.88,
        "Dumbbell evaluation topology used by TcpSwift experiments",
        ha="center",
        fontsize=13,
        fontweight="bold",
    )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig10_experiment_dumbbell_topology")


def plot_inventory(
    inventory: Dict[str, int],
    log_records: Sequence[LogRecord],
    image_records: Sequence[ImageRecord],
    plots_dir: Path,
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(10.2, 4.0))
    extensions = sorted(inventory, key=lambda item: inventory[item], reverse=True)
    axes[0].bar(
        extensions, [inventory[extension] for extension in extensions], color="#4C78A8"
    )
    axes[0].set_title("Files read from logs/")
    axes[0].set_ylabel("File count")
    axes[0].tick_params(axis="x", rotation=25)
    values = [
        sum(record.warning_count for record in log_records),
        sum(record.error_count for record in log_records),
        sum(record.agent_count for record in log_records),
        len(image_records),
    ]
    axes[1].bar(
        ["warnings", "errors", "Swift agents", "existing PNG"],
        values,
        color=["#E69F00", "#D55E00", "#0072B2", "#009E73"],
    )
    axes[1].set_title("Parsed log/image metadata")
    axes[1].set_ylabel("Count")
    axes[1].tick_params(axis="x", rotation=20)
    fig.suptitle(
        "Full logs/ inventory audit before figure generation", y=1.02, fontweight="bold"
    )
    fig.tight_layout()
    save_figure(fig, plots_dir, "fig11_logs_inventory_audit")


def write_manifest(
    plots_dir: Path,
    inventory: Dict[str, int],
    clean_records: Sequence[SummaryRecord],
    flow_records: Sequence[FlowRecord],
    log_records: Sequence[LogRecord],
    image_records: Sequence[ImageRecord],
    anomalies: Sequence[str],
) -> None:
    generated_files = sorted(path.as_posix() for path in plots_dir.glob("fig*.png"))
    generated_files += sorted(path.as_posix() for path in plots_dir.glob("fig*.pdf"))
    generated_files += sorted(path.as_posix() for path in plots_dir.glob("fig*.svg"))
    manifest = {
        "generated_files": generated_files,
        "logs_inventory": inventory,
        "summary_records_used": len(clean_records),
        "flowmonitor_flow_records": len(flow_records),
        "text_log_records": len(log_records),
        "existing_log_png_records": len(image_records),
        "swift_advantage_top_scenarios": compute_swift_advantage(clean_records)[:12],
        "anomalies_excluded": list(anomalies),
    }
    (plots_dir / "figure_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def generate_all(repo_root: Path) -> Dict[str, object]:
    logs_dir = repo_root / "logs"
    plots_dir = repo_root / "docs" / "plots"
    plots_dir.mkdir(parents=True, exist_ok=True)
    configure_style()
    summary_records, flow_records, log_records, image_records, inventory = (
        read_all_logs(logs_dir)
    )
    clean_records, anomalies = clean_summary(summary_records)
    aggregated_records = aggregate_records(clean_records)
    scenarios = choose_representative_scenarios(aggregated_records, limit=12)
    if not scenarios:
        raise RuntimeError(
            "No complete TcpSwift comparison scenarios were found in logs/."
        )
    plot_throughput(aggregated_records, scenarios, plots_dir)
    plot_udp_retention(aggregated_records, scenarios, plots_dir)
    plot_delay_loss_tradeoff(aggregated_records, plots_dir)
    plot_swift_heatmap(aggregated_records, scenarios, plots_dir)
    plot_flow_fairness(flow_records, plots_dir)
    plot_scenario_family(aggregated_records, scenarios, plots_dir)
    plot_swift_advantage_ranked(aggregated_records, plots_dir)
    plot_protocol_metric_scorecard(aggregated_records, plots_dir)
    plot_architecture(plots_dir)
    plot_signal_flow(plots_dir)
    plot_patent_steps(plots_dir)
    plot_topology(plots_dir)
    plot_inventory(inventory, log_records, image_records, plots_dir)
    write_manifest(
        plots_dir,
        inventory,
        aggregated_records,
        flow_records,
        log_records,
        image_records,
        anomalies,
    )
    return {
        "logs_inventory": inventory,
        "summary_records": len(summary_records),
        "summary_records_used": len(aggregated_records),
        "flow_records": len(flow_records),
        "log_records": len(log_records),
        "image_records": len(image_records),
        "scenarios": scenarios,
        "swift_advantage_top_scenarios": [
            row["scenario"] for row in compute_swift_advantage(aggregated_records)[:12]
        ],
        "plots_dir": plots_dir.as_posix(),
    }


def main() -> None:
    repo_root = Path.cwd()
    result = generate_all(repo_root)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
