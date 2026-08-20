import { defineView, useState, useEffect, Router } from "@lark.js/mvc";
import gsap from "gsap";
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import template from "./scenario.html";
import {
  loadScenario,
  ALGO_COLORS,
  ALGO_LABELS,
  formatThroughput,
  formatDelay,
  formatBytes,
  formatLoss,
  scenarioCategory,
} from "../lib/data";
import { icons } from "../lib/icons";
import type { ScenarioDetail } from "../lib/data";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
);

interface AlgoCardVM {
  algo: string;
  label: string;
  color: string;
  throughput: string;
  delay: string;
  jitter: string;
  loss: string;
  totalRx: string;
}

interface FlowRowVM {
  flowId: number;
  src: string;
  srcPort: number;
  throughput: string;
  delay: string;
  jitter: string;
  loss: string;
  hasLoss: boolean;
}

interface FlowTableVM {
  algo: string;
  label: string;
  color: string;
  flowCountText: string;
  flows: FlowRowVM[];
}

interface MetricBtnVM {
  key: string;
  label: string;
  active: boolean;
}

const METRICS = [
  { key: "throughput", label: "Throughput" },
  { key: "delay", label: "Delay" },
  { key: "jitter", label: "Jitter" },
  { key: "loss", label: "Loss" },
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export default defineView((ctx) => {
  const loc = Router.parse();
  const scenario = loc.get("scenario", "");
  const dataset = loc.get("dataset", "comparison-udp");

  const [getData, setData] = useState<ScenarioDetail | null>("data", null);
  const [getLoading, setLoading] = useState("loading", true);
  const [getMetric, setMetric] = useState("metric", "throughput");

  let barChart: Chart | null = null;
  let radarChart: Chart | null = null;
  let delayChart: Chart | null = null;

  ctx.updater.set({
    scenarioName: scenario.replace(/_/g, " "),
    category: scenarioCategory(scenario),
    dataset,
    loading: true,
    dataReady: false,
    algoCards: [] as AlgoCardVM[],
    flowTables: [] as FlowTableVM[],
    metricBtns: [] as MetricBtnVM[],
    metricLabel: "Throughput",
    iconArrowLeft: icons.arrowLeft,
  });

  function getMetricValue(algo: string, metric: string): number {
    const d = getData();
    if (!d || !d.algorithms[algo]) return 0;
    const s = d.algorithms[algo].summary;
    if (metric === "throughput") return s.throughputMbps;
    if (metric === "delay") return s.avgDelayUs;
    if (metric === "jitter") return s.avgJitterUs;
    if (metric === "loss") return s.lossRate * 100;
    return 0;
  }

  function formatMetricValue(algo: string, metric: string): string {
    const v = getMetricValue(algo, metric);
    if (metric === "throughput") return formatThroughput(v);
    if (metric === "delay") return formatDelay(v);
    if (metric === "jitter") return formatDelay(v);
    if (metric === "loss") return formatLoss(v / 100);
    return String(v);
  }

  function buildAlgoCards(): AlgoCardVM[] {
    const d = getData();
    if (!d) return [];
    return Object.keys(d.algorithms).map((algo) => {
      const s = d.algorithms[algo].summary;
      return {
        algo,
        label: ALGO_LABELS[algo] || algo,
        color: ALGO_COLORS[algo] || "#888",
        throughput: formatThroughput(s.throughputMbps),
        delay: formatDelay(s.avgDelayUs),
        jitter: formatDelay(s.avgJitterUs),
        loss: formatLoss(s.lossRate),
        totalRx: formatBytes(s.totalRxGB * 1e9),
      };
    });
  }

  function buildFlowTables(): FlowTableVM[] {
    const d = getData();
    if (!d) return [];
    return Object.keys(d.algorithms).map((algo) => {
      const tcpFlows = d.algorithms[algo].flows.filter(
        (f) => f.type === "tcp-data",
      );
      return {
        algo,
        label: ALGO_LABELS[algo] || algo,
        color: ALGO_COLORS[algo] || "#888",
        flowCountText: `${tcpFlows.length} flows`,
        flows: tcpFlows.map((f) => ({
          flowId: f.flowId,
          src: f.src || "",
          srcPort: f.srcPort || 0,
          throughput: formatThroughput(f.throughputMbps),
          delay: formatDelay(f.avgDelayUs),
          jitter: formatDelay(f.avgJitterUs),
          loss: formatLoss(f.lossRate),
          hasLoss: f.lossRate > 0,
        })),
      };
    });
  }

  function buildMetricBtns(): MetricBtnVM[] {
    const metric = getMetric();
    return METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      active: m.key === metric,
    }));
  }

  function metricUnit(metric: string): string {
    if (metric === "throughput") return "Mbps";
    if (metric === "delay") return "us";
    if (metric === "jitter") return "us";
    if (metric === "loss") return "%";
    return "";
  }

  function renderBarChart() {
    const d = getData();
    if (!d) return;
    const canvas = document.getElementById("barChart") as HTMLCanvasElement;
    if (!canvas) return;

    const metric = getMetric();
    const algos = Object.keys(d.algorithms);
    const labels = algos.map((a) => ALGO_LABELS[a] || a);
    const values = algos.map((a) => getMetricValue(a, metric));
    const colors = algos.map((a) => ALGO_COLORS[a] || "#888");

    if (barChart) barChart.destroy();
    barChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: METRICS.find((m) => m.key === metric)?.label || metric,
            data: values,
            backgroundColor: colors.map((c) => hexToRgba(c, 0.7)),
            borderColor: colors,
            borderWidth: 1.5,
            borderRadius: 6,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1e293b",
            titleFont: { family: "Geist Mono, monospace", size: 11 },
            bodyFont: { family: "Geist Mono, monospace", size: 11 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (item) => formatMetricValue(algos[item.dataIndex], metric),
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: "Geist Mono, monospace", size: 11 },
              color: "#64748b",
            },
          },
          y: {
            grid: { color: "#f1f5f9" },
            ticks: {
              font: { family: "Geist Mono, monospace", size: 10 },
              color: "#94a3b8",
            },
            title: {
              display: true,
              text: metricUnit(metric),
              font: { size: 10 },
              color: "#94a3b8",
            },
          },
        },
      },
    });
  }

  function renderRadarChart() {
    const d = getData();
    if (!d) return;
    const canvas = document.getElementById("radarChart") as HTMLCanvasElement;
    if (!canvas) return;

    const algos = Object.keys(d.algorithms);
    const metrics = ["throughput", "delay", "jitter", "loss"];
    const metricLabels = ["Throughput", "Delay", "Jitter", "Loss"];

    const maxVals = metrics.map((m) =>
      Math.max(...algos.map((a) => getMetricValue(a, m)), 0.001),
    );

    if (radarChart) radarChart.destroy();
    radarChart = new Chart(canvas, {
      type: "radar",
      data: {
        labels: metricLabels,
        datasets: algos.map((algo) => {
          const color = ALGO_COLORS[algo] || "#888";
          return {
            label: ALGO_LABELS[algo] || algo,
            data: metrics.map((m, i) => getMetricValue(algo, m) / maxVals[i]),
            borderColor: color,
            backgroundColor: hexToRgba(color, 0.08),
            pointBackgroundColor: color,
            pointRadius: 3,
            borderWidth: 2,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: { family: "Geist Mono, monospace", size: 10 },
              color: "#64748b",
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: "#1e293b",
            titleFont: { family: "Geist Mono, monospace", size: 11 },
            bodyFont: { family: "Geist Mono, monospace", size: 11 },
            padding: 10,
            cornerRadius: 8,
          },
        },
        scales: {
          r: {
            grid: { color: "#e2e8f0" },
            angleLines: { color: "#e2e8f0" },
            pointLabels: {
              font: { family: "Geist Mono, monospace", size: 10 },
              color: "#64748b",
            },
            ticks: { display: false },
            suggestedMin: 0,
            suggestedMax: 1,
          },
        },
      },
    });
  }

  function renderDelayChart() {
    const d = getData();
    if (!d) return;
    const canvas = document.getElementById("delayChart") as HTMLCanvasElement;
    if (!canvas) return;

    const algos = Object.keys(d.algorithms);

    const allBins = new Set<number>();
    for (const algo of algos) {
      const tcpFlows = d.algorithms[algo].flows.filter(
        (f) => f.type === "tcp-data",
      );
      for (const flow of tcpFlows) {
        for (const bin of flow.delayHist) {
          allBins.add(bin.start);
        }
      }
    }
    const sortedBins = [...allBins].sort((a, b) => a - b);
    if (sortedBins.length === 0) return;

    const labels = sortedBins.map((b) => {
      if (b >= 1) return `${b.toFixed(2)}s`;
      if (b >= 0.001) return `${(b * 1000).toFixed(1)}ms`;
      if (b > 0) return `${(b * 1e6).toFixed(0)}us`;
      return "0";
    });

    if (delayChart) delayChart.destroy();
    delayChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: algos.map((algo) => {
          const color = ALGO_COLORS[algo] || "#888";
          const tcpFlows = d.algorithms[algo].flows.filter(
            (f) => f.type === "tcp-data",
          );
          const binCounts = sortedBins.map((binStart) => {
            let total = 0;
            for (const flow of tcpFlows) {
              const bin = flow.delayHist.find((h) => h.start === binStart);
              if (bin) total += bin.count;
            }
            return total;
          });
          return {
            label: ALGO_LABELS[algo] || algo,
            data: binCounts,
            backgroundColor: hexToRgba(color, 0.6),
            borderColor: color,
            borderWidth: 1,
            borderRadius: 3,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              font: { family: "Geist Mono, monospace", size: 10 },
              color: "#64748b",
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: "#1e293b",
            titleFont: { family: "Geist Mono, monospace", size: 11 },
            bodyFont: { family: "Geist Mono, monospace", size: 11 },
            padding: 10,
            cornerRadius: 8,
            mode: "index",
            intersect: false,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: "Geist Mono, monospace", size: 9 },
              color: "#94a3b8",
              maxRotation: 45,
              maxTicksLimit: 20,
            },
            title: {
              display: true,
              text: "Delay bucket",
              font: { size: 10 },
              color: "#94a3b8",
            },
          },
          y: {
            grid: { color: "#f1f5f9" },
            ticks: {
              font: { family: "Geist Mono, monospace", size: 10 },
              color: "#94a3b8",
            },
            title: {
              display: true,
              text: "Packet count",
              font: { size: 10 },
              color: "#94a3b8",
            },
          },
        },
      },
    });
  }

  function refresh() {
    const metric = getMetric();
    const label = METRICS.find((m) => m.key === metric)?.label || "Throughput";
    ctx.updater.set({
      dataReady: !!getData(),
      loading: getLoading(),
      algoCards: buildAlgoCards(),
      flowTables: buildFlowTables(),
      metricBtns: buildMetricBtns(),
      metricLabel: label,
    });
  }

  function renderCharts() {
    setTimeout(() => {
      renderBarChart();
      renderRadarChart();
      renderDelayChart();
    }, 0);
  }

  (async () => {
    const data = await loadScenario(dataset, scenario);
    if (ctx.signature.value <= 0) return;
    setData(data);
    setLoading(false);
    refresh();
    ctx.updater.digest();
    renderCharts();
  })();

  useEffect(() => {
    setTimeout(() => {
      gsap.fromTo(
        ".sc-header",
        { opacity: 0, y: -16 },
        { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" },
      );
      gsap.fromTo(
        ".algo-summary-card",
        { opacity: 0, y: 20, scale: 0.96 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.4,
          stagger: 0.08,
          ease: "power2.out",
          delay: 0.15,
        },
      );
      gsap.fromTo(
        ".chart-section",
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, delay: 0.25 },
      );
    }, 0);
    return () => {
      if (barChart) barChart.destroy();
      if (radarChart) radarChart.destroy();
      if (delayChart) delayChart.destroy();
    };
  });

  return {
    template,
    events: {
      "goBack<click>": () => Router.to("/dashboard"),
      "switchMetric<click>": (e: any) => {
        setMetric(e.params.m as string);
        refresh();
        ctx.updater.digest();
        renderBarChart();
      },
    },
  };
});
