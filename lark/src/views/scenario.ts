import { defineView, useState, useEffect, Router } from "@lark.js/mvc";
import gsap from "gsap";
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
import type { ScenarioDetail, FlowDetail } from "../lib/data";

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

interface ChartBarVM {
  algo: string;
  label: string;
  color: string;
  valueText: string;
  height: number;
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

export default defineView((ctx) => {
  const loc = Router.parse();
  const scenario = loc.get("scenario", "");
  const dataset = loc.get("dataset", "comparison-udp");

  const [getData, setData] = useState<ScenarioDetail | null>("data", null);
  const [getLoading, setLoading] = useState("loading", true);
  const [getMetric, setMetric] = useState("metric", "throughput");

  ctx.updater.set({
    scenarioName: scenario.replace(/_/g, " "),
    category: scenarioCategory(scenario),
    dataset,
    loading: true,
    dataReady: false,
    algoCards: [] as AlgoCardVM[],
    chartBars: [] as ChartBarVM[],
    flowTables: [] as FlowTableVM[],
    metricBtns: [] as MetricBtnVM[],
    metricLabel: "Throughput",
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

  function buildChartBars(): ChartBarVM[] {
    const d = getData();
    if (!d) return [];
    const metric = getMetric();
    const algos = Object.keys(d.algorithms);
    const vals = algos.map((a) => getMetricValue(a, metric));
    const max = Math.max(...vals, 0.001);
    return algos.map((algo) => ({
      algo,
      label: ALGO_LABELS[algo] || algo,
      color: ALGO_COLORS[algo] || "#888",
      valueText: formatMetricValue(algo, metric),
      height: Math.max(2, (getMetricValue(algo, metric) / max) * 100),
    }));
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

  function refresh() {
    const metric = getMetric();
    const label = METRICS.find((m) => m.key === metric)?.label || "Throughput";
    ctx.updater.set({
      dataReady: !!getData(),
      loading: getLoading(),
      algoCards: buildAlgoCards(),
      chartBars: buildChartBars(),
      flowTables: buildFlowTables(),
      metricBtns: buildMetricBtns(),
      metricLabel: label,
    });
  }

  (async () => {
    const data = await loadScenario(dataset, scenario);
    if (ctx.signature.value <= 0) return;
    setData(data);
    setLoading(false);
    refresh();
    ctx.updater.digest();
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
    }, 0);
    return () => {};
  });

  function animateCharts() {
    setTimeout(() => {
      gsap.fromTo(
        ".chart-bar-anim",
        { scaleY: 0 },
        {
          scaleY: 1,
          duration: 0.6,
          stagger: 0.06,
          ease: "power2.out",
          transformOrigin: "bottom",
        },
      );
      gsap.fromTo(
        ".chart-section",
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.4, stagger: 0.1, delay: 0.1 },
      );
    }, 0);
  }

  useEffect(() => {
    animateCharts();
    return () => {};
  });

  return {
    template,
    events: {
      "goBack<click>": () => Router.to("/dashboard"),
      "switchMetric<click>": (e: any) => {
        setMetric(e.params.m as string);
        refresh();
        ctx.updater.digest();
        animateCharts();
      },
    },
  };
});
