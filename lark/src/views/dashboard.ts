import { defineView, useState, useEffect, Router } from "@lark.js/mvc";
import gsap from "gsap";
import template from "./dashboard.html";
import {
  loadIndex,
  ALGO_COLORS,
  ALGO_LABELS,
  formatThroughput,
  formatDelay,
  formatLoss,
  scenarioCategory,
} from "../lib/data";
import { icons, categoryIcons } from "../lib/icons";
import type { ScenarioIndex } from "../lib/data";

interface AlgoPill {
  algo: string;
  label: string;
  color: string;
  bg: string;
  borderColor: string;
  active: boolean;
}

interface AlgoDot {
  color: string;
  label: string;
}

interface CardVM {
  scenario: string;
  dataset: string;
  displayName: string;
  category: string;
  categoryIcon: string;
  hasSummary: boolean;
  throughputText: string;
  throughputWidth: number;
  delayText: string;
  delayWidth: number;
  lossText: string;
  lossWidth: number;
  algoColor: string;
  algoDots: AlgoDot[];
  algoCountText: string;
}

export default defineView((ctx) => {
  const [getScenarios, setScenarios] = useState<ScenarioIndex[]>(
    "scenarios",
    [],
  );
  const [getFilter, setFilter] = useState("filter", "All");
  const [getDataset, setDataset] = useState("dataset", "All");
  const [getLoading, setLoading] = useState("loading", true);
  const [getBestAlgo, setBestAlgo] = useState("bestAlgo", "TcpSwift");
  const [getAlgos, setAlgos] = useState<string[]>("algosList", []);

  ctx.updater.set({
    loading: true,
    filter: "All",
    dataset: "All",
    categories: [] as string[],
    datasets: [] as string[],
    algoPills: [] as AlgoPill[],
    cards: [] as CardVM[],
    filteredCount: 0,
    algoCount: 0,
    datasetCount: 0,
    iconActivity: icons.activity,
    iconArrowUpRight: icons.arrowUpRight,
  });

  function buildPills(): AlgoPill[] {
    const best = getBestAlgo();
    return getAlgos().map((algo) => ({
      algo,
      label: ALGO_LABELS[algo] || algo,
      color: ALGO_COLORS[algo] || "#888",
      bg: best === algo ? `${ALGO_COLORS[algo]}22` : "transparent",
      borderColor: best === algo ? `${ALGO_COLORS[algo]}55` : "transparent",
      active: best === algo,
    }));
  }

  function buildCards(): CardVM[] {
    const filter = getFilter();
    const dataset = getDataset();
    const best = getBestAlgo();
    let list = getScenarios();
    if (filter !== "All") {
      list = list.filter((s) => scenarioCategory(s.scenario) === filter);
    }
    if (dataset !== "All") {
      list = list.filter((s) => s.dataset === dataset);
    }
    return list.map((s) => {
      const sum = s.summaries[best];
      const hasSummary = !!sum;
      const cat = scenarioCategory(s.scenario);
      return {
        scenario: s.scenario,
        dataset: s.dataset,
        displayName: s.scenario.replace(/_/g, " "),
        category: cat,
        categoryIcon: categoryIcons[cat] || categoryIcons["Mixed"],
        hasSummary,
        throughputText: hasSummary ? formatThroughput(sum.throughputMbps) : "",
        throughputWidth: hasSummary
          ? Math.min(100, (sum.throughputMbps / 100000) * 100)
          : 0,
        delayText: hasSummary ? formatDelay(sum.avgDelayUs) : "",
        delayWidth: hasSummary
          ? Math.min(100, (sum.avgDelayUs / 1000) * 100)
          : 0,
        lossText: hasSummary ? formatLoss(sum.lossRate) : "",
        lossWidth: hasSummary ? Math.min(100, sum.lossRate * 10000) : 0,
        algoColor: ALGO_COLORS[best] || "#888",
        algoDots: s.algorithms.map((a) => ({
          color: ALGO_COLORS[a] || "#888",
          label: ALGO_LABELS[a] || a,
        })),
        algoCountText: `${s.algorithms.length} algorithms`,
      };
    });
  }

  function refresh() {
    const cards = buildCards();
    ctx.updater.set({
      cards,
      filteredCount: cards.length,
      filter: getFilter(),
      dataset: getDataset(),
      algoPills: buildPills(),
    });
  }

  (async () => {
    const data = await loadIndex();
    if (ctx.signature.value <= 0) return;
    const cats = [
      ...new Set(data.scenarios.map((s) => scenarioCategory(s.scenario))),
    ].sort();
    const ds = [...new Set(data.scenarios.map((s) => s.dataset))].sort();
    setScenarios(data.scenarios);
    setAlgos(data.algorithms);
    setLoading(false);
    ctx.updater.set({
      loading: false,
      categories: cats,
      datasets: ds,
      algoCount: data.algorithms.length,
      datasetCount: ds.length,
    });
    refresh();
    ctx.updater.digest();
  })();

  useEffect(() => {
    setTimeout(() => {
      gsap.fromTo(
        ".dash-header",
        { opacity: 0, y: -20 },
        { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" },
      );
      gsap.fromTo(
        ".stat-ring",
        { scale: 0.8, opacity: 0 },
        {
          scale: 1,
          opacity: 1,
          duration: 0.5,
          stagger: 0.1,
          ease: "back.out(1.7)",
          delay: 0.2,
        },
      );
    }, 0);
    return () => {};
  });

  function animateCards() {
    setTimeout(() => {
      gsap.fromTo(
        ".scenario-card",
        { opacity: 0, y: 24, scale: 0.97 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.45,
          stagger: 0.04,
          ease: "power2.out",
        },
      );
    }, 0);
  }

  useEffect(() => {
    animateCards();
    return () => {};
  });

  return {
    template,
    events: {
      "selectCategory<click>": (e: any) => {
        setFilter(e.params.cat as string);
        refresh();
        ctx.updater.digest();
        animateCards();
      },
      "selectDataset<click>": (e: any) => {
        setDataset(e.params.ds as string);
        refresh();
        ctx.updater.digest();
        animateCards();
      },
      "openScenario<click>": (e: any) => {
        Router.to("/scenario", {
          scenario: e.params.scenario as string,
          dataset: e.params.dataset as string,
        });
      },
      "selectBestAlgo<click>": (e: any) => {
        setBestAlgo(e.params.algo as string);
        refresh();
        ctx.updater.digest();
        animateCards();
      },
    },
  };
});
