import {
  useSignal,
  useComputed,
  useEffect,
  useSignalEffect,
  useRouter,
  batch,
  raw,
} from "@lark.js/mvc";
import gsap from "gsap";
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

function pillClass(active: boolean): string {
  return active
    ? "bg-accent/10 text-accent-soft border border-accent/30"
    : "bg-surface-2 text-gray-500 border border-transparent hover:text-gray-700";
}

export default function Dashboard() {
  const router = useRouter();
  const scenarios = useSignal<ScenarioIndex[]>([]);
  const filter = useSignal("All");
  const dataset = useSignal("All");
  const loading = useSignal(true);
  const bestAlgo = useSignal("TcpSwift");
  const algos = useSignal<string[]>([]);

  const categories = useComputed(() =>
    [...new Set(scenarios.value.map((s) => scenarioCategory(s.scenario)))].sort(),
  );
  const datasets = useComputed(() =>
    [...new Set(scenarios.value.map((s) => s.dataset))].sort(),
  );
  const algoCount = useComputed(() => algos.value.length);
  const datasetCount = useComputed(() => datasets.value.length);

  const algoPills = useComputed<AlgoPill[]>(() => {
    const best = bestAlgo.value;
    return algos.value.map((algo) => ({
      algo,
      label: ALGO_LABELS[algo] || algo,
      color: ALGO_COLORS[algo] || "#888",
      bg: best === algo ? `${ALGO_COLORS[algo]}22` : "transparent",
      borderColor: best === algo ? `${ALGO_COLORS[algo]}55` : "transparent",
      active: best === algo,
    }));
  });

  const cards = useComputed<CardVM[]>(() => {
    const f = filter.value;
    const ds = dataset.value;
    const best = bestAlgo.value;
    let list = scenarios.value;
    if (f !== "All") {
      list = list.filter((s) => scenarioCategory(s.scenario) === f);
    }
    if (ds !== "All") {
      list = list.filter((s) => s.dataset === ds);
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
  });

  const filteredCount = useComputed(() => cards.value.length);

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
  });

  useSignalEffect(() => {
    cards.value;
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
  });

  useEffect(() => {
    (async () => {
      const data = await loadIndex();
      batch(() => {
        scenarios.value = data.scenarios;
        algos.value = data.algorithms;
        loading.value = false;
      });
    })();
  });

  return (
    <div class="min-h-screen">
      <header class="dash-header sticky top-0 z-50 border-b border-gray-200 bg-white/80 backdrop-blur-2xl">
        <div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div class="flex items-center gap-3">
            <div class="from-accent flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br to-cyan-400 text-white">
              {raw(icons.activity)}
            </div>
            <div>
              <h1 class="text-base font-semibold tracking-tight text-gray-900">
                FlowMonitor
              </h1>
              <p class="font-mono text-[11px] text-gray-400">
                ns-3.40 TCP Congestion Control Comparison
              </p>
            </div>
          </div>
          <div class="flex items-center gap-6">
            <div class="stat-ring text-center">
              <div class="font-mono text-lg font-semibold text-gray-900">
                {filteredCount.value}
              </div>
              <div class="text-[10px] tracking-wider text-gray-400 uppercase">
                Scenarios
              </div>
            </div>
            <div class="stat-ring text-center">
              <div class="text-algo-swift font-mono text-lg font-semibold">
                {algoCount.value}
              </div>
              <div class="text-[10px] tracking-wider text-gray-400 uppercase">
                Algorithms
              </div>
            </div>
            <div class="stat-ring text-center">
              <div class="text-algo-bbr font-mono text-lg font-semibold">
                {datasetCount.value}
              </div>
              <div class="text-[10px] tracking-wider text-gray-400 uppercase">
                Datasets
              </div>
            </div>
          </div>
        </div>
      </header>

      <main class="mx-auto max-w-7xl px-6 py-8">
        {loading.value && (
          <div class="flex items-center justify-center py-32">
            <div class="flex flex-col items-center gap-4">
              <div class="border-accent/30 border-t-accent h-10 w-10 animate-spin rounded-full border-2"></div>
              <p class="text-sm text-gray-400">Loading flow data...</p>
            </div>
          </div>
        )}
        {!loading.value && (
          <div>
            <div class="mb-8 space-y-4">
              <div class="flex flex-wrap items-center gap-2">
                <span class="mr-1 text-xs tracking-wider text-gray-400 uppercase">
                  Category
                </span>
                <button
                  class={[
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide cursor-pointer",
                    pillClass(filter.value === "All"),
                  ]}
                  onClick={() => {
                    filter.value = "All";
                  }}
                >
                  All
                </button>
                {categories.value.map((cat) => (
                  <button
                    key={cat}
                    class={[
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide cursor-pointer",
                      pillClass(filter.value === cat),
                    ]}
                    onClick={() => {
                      filter.value = cat;
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div class="flex flex-wrap items-center justify-between gap-4">
                <div class="flex items-center gap-2">
                  <span class="mr-1 text-xs tracking-wider text-gray-400 uppercase">
                    Dataset
                  </span>
                  <button
                    class={[
                      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide cursor-pointer",
                      pillClass(dataset.value === "All"),
                    ]}
                    onClick={() => {
                      dataset.value = "All";
                    }}
                  >
                    All
                  </button>
                  {datasets.value.map((ds) => (
                    <button
                      key={ds}
                      class={[
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide cursor-pointer",
                        pillClass(dataset.value === ds),
                      ]}
                      onClick={() => {
                        dataset.value = ds;
                      }}
                    >
                      {ds}
                    </button>
                  ))}
                </div>

                <div class="flex items-center gap-2">
                  <span class="mr-1 text-xs tracking-wider text-gray-400 uppercase">
                    Metric by
                  </span>
                  {algoPills.value.map((pill) => (
                    <button
                      key={pill.algo}
                      class={[
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide cursor-pointer border",
                        !pill.active
                          ? "border-transparent opacity-50 hover:opacity-100"
                          : "",
                      ]}
                      style={{
                        background: pill.bg,
                        color: pill.color,
                        ...(pill.active ? { borderColor: pill.borderColor } : {}),
                      }}
                      onClick={() => {
                        bestAlgo.value = pill.algo;
                      }}
                    >
                      <span
                        class="h-2 w-2 rounded-full"
                        style={{ background: pill.color }}
                      ></span>
                      {pill.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.value.map((c) => (
                <div
                  key={`${c.dataset}__${c.scenario}`}
                  class="scenario-card hover:border-accent/40 group cursor-pointer rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
                  onClick={() =>
                    router.navigate(
                      `/scenario?scenario=${encodeURIComponent(c.scenario)}&dataset=${encodeURIComponent(c.dataset)}`,
                    )
                  }
                >
                  <div class="mb-4 flex items-start justify-between">
                    <div class="flex items-start gap-2.5">
                      <div class="bg-surface-2 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400">
                        {raw(c.categoryIcon)}
                      </div>
                      <div>
                        <h3 class="font-mono text-sm font-semibold text-gray-800 transition-colors group-hover:text-gray-900">
                          {c.displayName}
                        </h3>
                        <span class="text-[10px] tracking-wider text-gray-400 uppercase">
                          {c.category} / {c.dataset}
                        </span>
                      </div>
                    </div>
                    <div class="bg-surface-2 group-hover:text-accent flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors">
                      {raw(icons.arrowUpRight)}
                    </div>
                  </div>

                  {c.hasSummary && (
                    <div class="space-y-3">
                      <div>
                        <div class="mb-1 flex justify-between text-[11px]">
                          <span class="text-gray-400">Throughput</span>
                          <span class="font-mono text-gray-700">
                            {c.throughputText}
                          </span>
                        </div>
                        <div class="bg-surface-3 h-1.5 overflow-hidden rounded-full">
                          <div
                            class="h-full rounded-full transition-all duration-700"
                            style={{
                              width: `${c.throughputWidth}%`,
                              background: c.algoColor,
                            }}
                          ></div>
                        </div>
                      </div>
                      <div>
                        <div class="mb-1 flex justify-between text-[11px]">
                          <span class="text-gray-400">Avg Delay</span>
                          <span class="font-mono text-gray-700">
                            {c.delayText}
                          </span>
                        </div>
                        <div class="bg-surface-3 h-1.5 overflow-hidden rounded-full">
                          <div
                            class="h-full rounded-full bg-amber-500/70 transition-all duration-700"
                            style={{ width: `${c.delayWidth}%` }}
                          ></div>
                        </div>
                      </div>
                      <div>
                        <div class="mb-1 flex justify-between text-[11px]">
                          <span class="text-gray-400">Packet Loss</span>
                          <span class="font-mono text-gray-700">
                            {c.lossText}
                          </span>
                        </div>
                        <div class="bg-surface-3 h-1.5 overflow-hidden rounded-full">
                          <div
                            class="h-full rounded-full bg-red-500/60 transition-all duration-700"
                            style={{ width: `${c.lossWidth}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div class="mt-4 flex items-center gap-1.5 border-t border-gray-100 pt-3">
                    {c.algoDots.map((dot) => (
                      <span
                        key={dot.label}
                        class="h-2 w-2 rounded-full"
                        style={{ background: dot.color }}
                        title={dot.label}
                      ></span>
                    ))}
                    <span class="ml-1 text-[10px] text-gray-400">
                      {c.algoCountText}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {filteredCount.value === 0 && (
              <div class="py-20 text-center">
                <p class="text-sm text-gray-400">
                  No scenarios match the current filters.
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
