#!/usr/bin/env node
// @ts-check
/**
 * Copyright 2026 hangtiancheng
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Patent figure pipeline.
 *
 * Produces the figures the invention-patent draft embeds:
 *
 * - two method flowcharts covering state acquisition with congestion
 *   classification, and the bandwidth-delay-product / window-decision chain;
 * - three result charts computed from the native ns-3.40 artifacts under
 *   `logs/real`, covering aggregate goodput, mean one-way delay, and
 *   cross-traffic robustness under the UDP burst.
 *
 * Two conventions differ from the thesis figures on purpose. Labels are neutral
 * (`本发明方法` versus `对比方法一/二/三`) because the patent text never names the
 * prototype, and every plotted number is regenerated from the validated
 * `logs/real` run set, with the per-run table written to
 * `logs/real/summary/patent_kpi_forward.csv` so each claim stays traceable.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { appendAnomalies, rateToMbps, timeToMs } from "../../main.js";
import { buildCsv } from "../../lib/csv.js";
import { isFile, parseFlowMonitor, ScenarioResult } from "../../lib/flowmonitor.js";
import { FigureRenderer } from "../../lib/plotly.js";
import {
  DEFAULT_N_LEAF,
  PROTOCOL_COLORS_MAP,
  SCENARIOS,
} from "../../lib/scenarios.js";
import { metricSummary } from "../../lib/stats.js";
import { axisStyle, baseLayout, inches } from "../../lib/theme.js";
import {
  ShapeState,
  diagramCanvas,
  diagramLayout,
  saveFigure,
} from "./main.js";

/** @import { Annotation, Data, Layout, Shape } from "plotly.js-dist-min" */
/** @import { FigureRenderer as Renderer, FigureSpec } from "../../lib/plotly.js" */

/** Repository root, resolved from this file's location. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Directory the figures are written to. */
const PLOTS_DIR = path.join(REPO_ROOT, "docs", "plots");

/** Root of the native simulation artifacts. */
const REAL_LOG_ROOT = path.join(REPO_ROOT, "logs", "real");

/** RngRun repetitions averaged by the result charts. */
export const PATENT_SEEDS = [42, 43, 44];

/**
 * Scenarios promoted to the patent figures, in figure order, with the label used
 * on axis ticks and in the draft tables.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const PATENT_SCENARIOS = [
  ["wan_longhaul", "广域长距离"],
  ["wan_metro", "城域广域"],
  ["satellite_geo", "静止轨道卫星"],
  ["wifi_n", "无线局域网"],
  ["lte_poor", "蜂窝弱覆盖"],
  ["congested_heavy", "重度拥塞汇聚"],
  ["dc_100m", "低带宽数据中心"],
];

/**
 * Protocol labels and colours. The prototype is drawn as `本发明方法`; the three
 * baselines appear as neutral entries so no figure leaks the project name.
 *
 * @type {ReadonlyArray<readonly [string, string, string]>}
 */
export const PATENT_PROTOCOLS = [
  ["TcpSwift", "本发明方法", PROTOCOL_COLORS_MAP.TcpSwift],
  ["TcpNewReno", "对比方法一", PROTOCOL_COLORS_MAP.TcpNewReno],
  ["TcpCubic", "对比方法二", PROTOCOL_COLORS_MAP.TcpCubic],
  ["TcpBbr", "对比方法三", PROTOCOL_COLORS_MAP.TcpBbr],
];

/** Settings compared by the robustness chart. */
const SETTINGS = [
  ["tcp_only", "comparison"],
  ["udp_burst", "comparison-udp"],
];

/** Scenario catalogue lookup: name -> [name, accessBw, bottleneckBw, accessDelay, bottleneckDelay]. */
const SCENARIO_BY_NAME = new Map(SCENARIOS.map((row) => [row[0], row]));

/**
 * One validated `(setting, scenario, protocol, seed)` artifact.
 *
 * @typedef {object} PatentRun
 * @property {string} setting
 * @property {string} scenario
 * @property {string} protocol
 * @property {number} seed
 * @property {ScenarioResult} result
 */

/**
 * Seed-averaged metrics of one `(setting, scenario, protocol)` group.
 *
 * @typedef {object} PatentAggregate
 * @property {string} setting
 * @property {string} scenario
 * @property {string} protocol
 * @property {number} runs
 * @property {number} goodput
 * @property {number} goodputCi
 * @property {number} delay
 * @property {number} delayCi
 * @property {number} jitter
 * @property {number} loss
 * @property {number} lossCi
 * @property {number} jain
 * @property {number} util
 * @property {number} baseOwdMs
 */

/**
 * Link budget of one scenario, shared by validation and the delay chart.
 *
 * @typedef {object} ScenarioBudget
 * @property {number} bottleneckMbps
 * @property {number} baseOwdMs
 */

/**
 * Anomaly record: source, scenario, protocol, reason, affected metrics.
 *
 * @typedef {readonly [string, string, string, string, string]} Anomaly
 */

/**
 * Validate one parsed artifact against the configured link budget.
 *
 * The rules mirror `buildRealKpi` in `main.js`, so a run accepted here is
 * accepted by the repository-wide summary as well.
 *
 * @param {ScenarioResult} result
 * @param {ScenarioBudget} budget
 * @returns {string[]} Human-readable reasons; empty when the run is usable.
 */
export function validateRun(result, budget) {
  /** @type {string[]} */
  const reasons = [];
  const throughput = result.totalThroughputMbps;
  const delay = result.avgDelayMs;
  const loss = result.totalLossRate;
  const fairness = result.jainFairness;

  if (result.forwardFlows.length !== DEFAULT_N_LEAF) {
    reasons.push(
      `expected ${DEFAULT_N_LEAF} forward TCP flows, found ${result.forwardFlows.length}`,
    );
  }
  if (!Number.isFinite(throughput) || throughput <= 0) {
    reasons.push("throughput is non-positive or non-finite");
  } else if (throughput > budget.bottleneckMbps * 1.001) {
    reasons.push("throughput exceeds configured bottleneck");
  }
  if (!Number.isFinite(delay) || delay <= 0) {
    reasons.push("delay is non-positive or non-finite");
  } else if (delay < budget.baseOwdMs * 0.999) {
    reasons.push("delay is below configured propagation bound");
  }
  if (!Number.isFinite(loss) || loss < 0 || loss > 100) {
    reasons.push("loss rate is outside [0, 100]");
  }
  if (!Number.isFinite(fairness) || fairness < 0 || fairness > 1) {
    reasons.push("Jain fairness is outside [0, 1]");
  }
  return reasons;
}

/**
 * Read, validate and average the native runs behind the patent figures.
 *
 * @returns {Promise<{ runs: PatentRun[], aggregates: PatentAggregate[], anomalies: Anomaly[] }>}
 */
export async function loadPatentData() {
  /** @type {PatentRun[]} */
  const runs = [];
  /** @type {Anomaly[]} */
  const anomalies = [];

  for (const [setting, directory] of SETTINGS) {
    for (const [scenario] of PATENT_SCENARIOS) {
      const config = SCENARIO_BY_NAME.get(scenario);
      if (!config) continue;
      const budget = {
        bottleneckMbps: rateToMbps(config[2]),
        baseOwdMs: 2 * timeToMs(config[3]) + timeToMs(config[4]),
      };

      for (const [protocol] of PATENT_PROTOCOLS) {
        for (const seed of PATENT_SEEDS) {
          const filepath = path.join(
            REAL_LOG_ROOT,
            directory,
            `${scenario}_${protocol}_s${seed}.flowmonitor`,
          );
          const relativePath = path.relative(process.cwd(), filepath);
          if (!isFile(filepath)) {
            anomalies.push([
              relativePath,
              scenario,
              protocol,
              `missing native run for ${setting}, RngRun=${seed}`,
              "all metrics",
            ]);
            continue;
          }

          /** @type {ScenarioResult} */
          let result;
          try {
            result = new ScenarioResult({
              scenario,
              protocol,
              seed,
              sourcePath: filepath,
              flows: parseFlowMonitor(filepath),
            });
          } catch (error) {
            anomalies.push([
              relativePath,
              scenario,
              protocol,
              `malformed FlowMonitor for ${setting}, RngRun=${seed}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
              "all metrics",
            ]);
            continue;
          }

          const reasons = validateRun(result, budget);
          if (reasons.length > 0) {
            anomalies.push([
              relativePath,
              scenario,
              protocol,
              `${reasons.join("; ")} (${setting}, RngRun=${seed})`,
              "all metrics",
            ]);
            continue;
          }
          runs.push({ setting, scenario, protocol, seed, result });
        }
      }
    }
  }

  /** @type {Map<string, PatentRun[]>} */
  const grouped = new Map();
  for (const run of runs) {
    const key = `${run.setting}\u0000${run.scenario}\u0000${run.protocol}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(run);
    else grouped.set(key, [run]);
  }

  /** @type {PatentAggregate[]} */
  const aggregates = [];
  for (const key of [...grouped.keys()].sort()) {
    const bucket = grouped.get(key) ?? [];
    const [setting, scenario, protocol] = key.split("\u0000");
    const config = SCENARIO_BY_NAME.get(scenario);
    if (!config) continue;

    /** @param {(run: PatentRun) => number} getter */
    const summarise = (getter) => metricSummary(bucket.map(getter));
    const [goodput, , goodputCi] = summarise((run) => run.result.totalThroughputMbps);
    const [delay, , delayCi] = summarise((run) => run.result.avgDelayMs);
    const [jitter] = summarise((run) => run.result.avgJitterMs);
    const [loss, , lossCi] = summarise((run) => run.result.totalLossRate);
    const [jain] = summarise((run) => run.result.jainFairness);

    aggregates.push({
      setting,
      scenario,
      protocol,
      runs: bucket.length,
      goodput,
      goodputCi,
      delay,
      delayCi,
      jitter,
      loss,
      lossCi,
      jain,
      util: goodput / rateToMbps(config[2]),
      baseOwdMs: 2 * timeToMs(config[3]) + timeToMs(config[4]),
    });
  }

  return { runs, aggregates, anomalies };
}

/**
 * Write the per-run and seed-averaged KPI tables backing the figures.
 *
 * @param {PatentRun[]} runs
 * @param {PatentAggregate[]} aggregates
 * @returns {Promise<{ forward: string, aggregate: string }>} Written paths.
 */
export async function writePatentKpi(runs, aggregates) {
  const summaryDir = path.join(REAL_LOG_ROOT, "summary");
  await mkdir(summaryDir, { recursive: true });

  const forwardFields = [
    "Setting",
    "Scenario",
    "Protocol",
    "Seed",
    "Goodput_Mbps",
    "Util",
    "Delay_ms",
    "Jitter_ms",
    "Loss_pct",
    "Jain",
    "Source",
  ];
  const forwardRows = [...runs]
    .sort((a, b) => {
      if (a.setting !== b.setting) return a.setting < b.setting ? -1 : 1;
      if (a.scenario !== b.scenario) return a.scenario < b.scenario ? -1 : 1;
      if (a.protocol !== b.protocol) return a.protocol < b.protocol ? -1 : 1;
      return a.seed - b.seed;
    })
    .map((run) => {
      const config = SCENARIO_BY_NAME.get(run.scenario);
      const bottleneckMbps = config ? rateToMbps(config[2]) : 0;
      return {
        Setting: run.setting,
        Scenario: run.scenario,
        Protocol: run.protocol,
        Seed: run.seed,
        Goodput_Mbps: run.result.totalThroughputMbps.toFixed(6),
        Util:
          bottleneckMbps > 0
            ? (run.result.totalThroughputMbps / bottleneckMbps).toFixed(6)
            : "",
        Delay_ms: run.result.avgDelayMs.toFixed(6),
        Jitter_ms: run.result.avgJitterMs.toFixed(6),
        Loss_pct: run.result.totalLossRate.toFixed(6),
        Jain: run.result.jainFairness.toFixed(6),
        Source: path.relative(REAL_LOG_ROOT, run.result.sourcePath),
      };
    });

  const aggregateFields = [
    "Setting",
    "Scenario",
    "Protocol",
    "Runs",
    "Goodput_Mbps_Mean",
    "Goodput_Mbps_CI95",
    "Delay_ms_Mean",
    "Delay_ms_CI95",
    "Loss_pct_Mean",
    "Loss_pct_CI95",
    "Jitter_ms_Mean",
    "Jain_Mean",
    "Util_Mean",
  ];
  const aggregateRows = aggregates.map((row) => ({
    Setting: row.setting,
    Scenario: row.scenario,
    Protocol: row.protocol,
    Runs: row.runs,
    Goodput_Mbps_Mean: row.goodput.toFixed(6),
    Goodput_Mbps_CI95: row.goodputCi.toFixed(6),
    Delay_ms_Mean: row.delay.toFixed(6),
    Delay_ms_CI95: row.delayCi.toFixed(6),
    Loss_pct_Mean: row.loss.toFixed(6),
    Loss_pct_CI95: row.lossCi.toFixed(6),
    Jitter_ms_Mean: row.jitter.toFixed(6),
    Jain_Mean: row.jain.toFixed(6),
    Util_Mean: row.util.toFixed(6),
  }));

  const forwardPath = path.join(summaryDir, "patent_kpi_forward.csv");
  const aggregatePath = path.join(summaryDir, "patent_kpi_aggregate.csv");
  await writeFile(forwardPath, buildCsv(forwardFields, forwardRows), "utf8");
  await writeFile(aggregatePath, buildCsv(aggregateFields, aggregateRows), "utf8");
  return { forward: forwardPath, aggregate: aggregatePath };
}

// =============================================================================
// Flowchart scaffolding
// =============================================================================

/**
 * SVG path of a decision diamond, given its bounding box in pixels.
 *
 * @param {{ x: number, y: number, width: number, height: number }} box - `y` is
 *   the bottom edge, matching `ShapeState.box`.
 * @returns {string}
 */
export function diamondPath(box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return [
    `M ${cx} ${box.y + box.height}`,
    `L ${box.x + box.width} ${cy}`,
    `L ${cx} ${box.y}`,
    `L ${box.x} ${cy}`,
    "Z",
  ].join(" ");
}

/** Transparent node fill used by the patent flowcharts. */
const TRANSPARENT_FILL = "rgba(0,0,0,0)";

/**
 * Fraction-based placement API over a diagram canvas.
 *
 * One data unit equals one output point, so a caller positions every element in
 * figure fractions and the canvas scales it to the rendered size.
 */
class FlowCanvas {
  /** @type {ShapeState} */
  shapes = new ShapeState();

  /** @type {ReturnType<typeof diagramCanvas>} */
  #canvas;

  /**
   * @param {ReturnType<typeof diagramCanvas>} canvas
   */
  constructor(canvas) {
    this.#canvas = canvas;
  }

  /**
   * Rounded box with centred text.
   *
   * @param {number} x
   * @param {number} y - Bottom edge.
   * @param {number} w
   * @param {number} h
   * @param {string} text
   * @param {string} color
   * @param {number} [fontSize]
   * @returns {void}
   */
  box(x, y, w, h, text, color, fontSize = 8) {
    this.shapes.box(this.#pixels(x, y, w, h), text, color, fontSize);
  }

  /**
   * Decision diamond with centred text.
   *
   * @param {number} x
   * @param {number} y - Bottom edge.
   * @param {number} w
   * @param {number} h
   * @param {string} text
   * @param {string} color
   * @param {number} [fontSize]
   * @returns {void}
   */
  node(x, y, w, h, text, color, fontSize = 8) {
    const box = this.#pixels(x, y, w, h);
    this.shapes.shapes.push(
      /** @type {Partial<Shape>} */ ({
        type: "path",
        path: diamondPath(box),
        line: { color: "#333333", width: 1 },
        fillcolor: color,
        layer: "below",
      }),
    );
    this.shapes.annotations.push(
      /** @type {Partial<Annotation>} */ ({
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
        text: text.replace(/\n/g, "<br>"),
        showarrow: false,
        xanchor: "center",
        yanchor: "middle",
        font: { size: fontSize },
      }),
    );
  }

  /**
   * Arrow between two fractions, optionally labelled at its midpoint.
   *
   * @param {[number, number]} start
   * @param {[number, number]} end
   * @param {string} [text]
   * @param {string} [color]
   * @param {number} [labelOffset] - Vertical label offset in points.
   * @returns {void}
   */
  arrow(start, end, text, color, labelOffset) {
    this.shapes.arrow(
      { x: this.#canvas.x(start[0]), y: this.#canvas.y(start[1]) },
      { x: this.#canvas.x(end[0]), y: this.#canvas.y(end[1]) },
      text,
      color,
      labelOffset,
    );
  }

  /**
   * Free-standing label.
   *
   * @param {[number, number]} position
   * @param {string} text
   * @param {{ fontSize?: number, color?: string, rotate?: number }} [options]
   * @returns {void}
   */
  label(position, text, options) {
    this.shapes.label(
      { x: this.#canvas.x(position[0]), y: this.#canvas.y(position[1]) },
      text,
      options,
    );
  }

  /**
   * Open polyline.
   *
   * @param {ReadonlyArray<readonly [number, number]>} points
   * @param {string} color
   * @returns {void}
   */
  polyline(points, color) {
    this.shapes.polyline(
      points.map(([x, y]) => [this.#canvas.x(x), this.#canvas.y(y)]),
      color,
    );
  }

  /**
   * Convert a fraction rectangle into canvas pixels.
   *
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  #pixels(x, y, w, h) {
    return {
      x: this.#canvas.x(x),
      y: this.#canvas.y(y),
      width: this.#canvas.x(w),
      height: this.#canvas.y(h),
    };
  }
}

/**
 * fig08: state acquisition and congestion semantic classification.
 *
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotStateClassification(renderer) {
  const width = inches(9.4);
  const height = inches(7.2);
  const margin = { top: 36, right: 10, bottom: 10, left: 10 };
  const canvas = diagramCanvas({ width, height, margin });
  const flow = new FlowCanvas(canvas);
  const box = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {string} */ text,
    /** @type {number} */ fontSize = 8,
  ) => flow.box(x, y, w, h, text, TRANSPARENT_FILL, fontSize);
  const decision = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {string} */ text,
  ) => flow.node(x, y, w, h, text, TRANSPARENT_FILL, 8);

  box(0.39, 0.94, 0.22, 0.04, "进入拥塞控制", 8.5);
  box(0.29, 0.84, 0.42, 0.065, "S1 五类回调采集\n缩减 · 增长 · ACK · 状态 · ECN");
  box(0.29, 0.73, 0.42, 0.065, "15 元素状态容器\n11 维观测 + 4 项路由元数据");
  decision(0.35, 0.60, 0.30, 0.09, "S2 缩减回调？");
  decision(0.02, 0.44, 0.30, 0.09, "CA_LOSS？");
  decision(0.68, 0.44, 0.30, 0.09, "ACK 路径存在\nCE / ECE？");
  decision(0.29, 0.29, 0.34, 0.09, "CE / ECE 或\n窗口缩减状态？");

  box(0.01, 0.14, 0.22, 0.065, "超时拥塞\nρ = 0.50");
  box(0.26, 0.14, 0.22, 0.065, "普通丢包\nρ = 0.70");
  box(0.52, 0.14, 0.22, 0.065, "ECN 拥塞\nρ = 0.75");
  box(0.77, 0.14, 0.22, 0.065, "非拥塞");
  box(0.20, 0.02, 0.60, 0.07, "输出语义 · 更新计数\n移交窗口决策");

  flow.arrow([0.50, 0.94], [0.50, 0.905]);
  flow.arrow([0.50, 0.84], [0.50, 0.795]);
  flow.arrow([0.50, 0.73], [0.50, 0.69]);
  flow.arrow([0.35, 0.645], [0.17, 0.53], "是", undefined, 9);
  flow.arrow([0.65, 0.645], [0.83, 0.53], "否", undefined, 9);
  flow.arrow([0.17, 0.44], [0.12, 0.205], "是", undefined, 8);
  flow.arrow([0.32, 0.485], [0.46, 0.38], "否", undefined, 9);
  flow.arrow([0.83, 0.44], [0.63, 0.205], "是", undefined, 9);
  flow.arrow([0.98, 0.485], [0.88, 0.205], "否", undefined, 8);
  flow.arrow([0.29, 0.335], [0.37, 0.205], "否", undefined, 8);
  flow.arrow([0.63, 0.335], [0.63, 0.205], "是", undefined, 8);
  flow.arrow([0.12, 0.14], [0.32, 0.09]);
  flow.arrow([0.37, 0.14], [0.43, 0.09]);
  flow.arrow([0.63, 0.14], [0.57, 0.09]);
  flow.arrow([0.88, 0.14], [0.68, 0.09]);

  flow.label([0.84, 0.76], "观测：窗口 · 传输 · RTT · 协议栈", {
    fontSize: 7,
  });
  flow.label([0.82, 0.66], "恢复与 RTT 膨胀仅参与调参", {
    fontSize: 7,
  });

  const layout = diagramLayout({
    width,
    height,
    margin,
    canvas,
    components: flow.shapes,
    title: { text: "多信号状态获取与拥塞语义分类", size: 12 },
  });

  return saveFigure(renderer, {
    name: "fig08_patent_state_flow",
    width,
    height,
    data: flow.shapes.traces,
    layout,
  });
}

/**
 * fig09: bandwidth-delay-product estimation, parameter adaptation, and the
 * congestion-window decision with its stability constraints.
 *
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotWindowDecision(renderer) {
  const width = inches(9.4);
  const height = inches(7.6);
  const margin = { top: 36, right: 10, bottom: 10, left: 10 };
  const canvas = diagramCanvas({ width, height, margin });
  const flow = new FlowCanvas(canvas);
  const box = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {string} */ text,
    /** @type {number} */ fontSize = 8,
  ) => flow.box(x, y, w, h, text, TRANSPARENT_FILL, fontSize);
  const decision = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {string} */ text,
  ) => flow.node(x, y, w, h, text, TRANSPARENT_FILL, 8);

  box(0.02, 0.88, 0.28, 0.08, "S3a 交付速率样本\n2×minRTT · 5 ms–1 s");
  box(0.36, 0.88, 0.28, 0.08, "S3b BDP 估计\nmax(40 样本) × minRTT");
  box(0.70, 0.88, 0.28, 0.08, "S4 α 自适应 [0.85, 1.30]\nRTT · 快慢 EMA · 连续增长", 7.5);
  decision(0.35, 0.70, 0.30, 0.09, "拥塞状态？");
  box(0.02, 0.46, 0.30, 0.09, "差异化缩减\nρ = 0.50 / 0.75 / 0.70");
  decision(0.68, 0.55, 0.30, 0.09, "冻结计数 > 0？");
  box(0.74, 0.37, 0.24, 0.07, "保持 cwnd");
  decision(0.39, 0.41, 0.28, 0.09, "慢启动？");
  box(0.28, 0.26, 0.27, 0.075, "慢启动目标\nmax(2BDP, 10MSS)");
  box(0.62, 0.26, 0.36, 0.075, "拥塞避免目标\nα×BDP · 有界升 / 半量降", 7.5);
  box(
    0.17,
    0.10,
    0.66,
    0.07,
    "S5 统一安全约束\n缩减≤3 · 冻结4 ACK · 窗口界限 · 阈值锚定",
    7.5,
  );
  box(0.34, 0.02, 0.32, 0.05, "S6 输出\ncwnd · ssthresh");

  flow.arrow([0.30, 0.92], [0.36, 0.92]);
  flow.arrow([0.64, 0.92], [0.70, 0.92]);
  flow.arrow([0.84, 0.88], [0.50, 0.79]);
  flow.arrow([0.35, 0.745], [0.17, 0.55], "是", undefined, 9);
  flow.arrow([0.65, 0.745], [0.83, 0.64], "否", undefined, 9);
  flow.arrow([0.83, 0.55], [0.86, 0.44], "是", undefined, 8);
  flow.arrow([0.68, 0.595], [0.53, 0.50], "否", undefined, 9);
  flow.arrow([0.39, 0.455], [0.415, 0.335], "是", undefined, 8);
  flow.arrow([0.67, 0.455], [0.80, 0.335], "否", undefined, 8);

  flow.polyline(
    [
      [0.17, 0.46],
      [0.17, 0.20],
      [0.50, 0.20],
    ],
    "#333333",
  );
  flow.polyline(
    [
      [0.415, 0.26],
      [0.415, 0.20],
      [0.50, 0.20],
    ],
    "#333333",
  );
  flow.polyline(
    [
      [0.80, 0.26],
      [0.80, 0.20],
      [0.50, 0.20],
    ],
    "#333333",
  );
  flow.polyline(
    [
      [0.86, 0.37],
      [0.99, 0.37],
      [0.99, 0.20],
      [0.50, 0.20],
    ],
    "#333333",
  );
  flow.arrow([0.50, 0.20], [0.50, 0.17]);
  flow.arrow([0.50, 0.10], [0.50, 0.07]);

  flow.label([0.50, 0.84], "估计不可用 → 当前 cwnd", { fontSize: 7 });
  flow.label([0.84, 0.055], "缩减回调暂存 · 增长回调应用\nCA_LOSS 作废 · 应用前 ≥ 2MSS", {
    fontSize: 7,
  });

  const layout = diagramLayout({
    width,
    height,
    margin,
    canvas,
    components: flow.shapes,
    title: { text: "BDP 估计、参数自适应与窗口决策", size: 12 },
  });

  return saveFigure(renderer, {
    name: "fig09_patent_window_flow",
    width,
    height,
    data: flow.shapes.traces,
    layout,
  });
}

// =============================================================================
// Result figures
// =============================================================================

/**
 * Grouped bar traces for the four compared methods, labelled in Chinese.
 *
 * @param {Map<string, PatentAggregate>} view - Keyed by `scenario\u0000protocol`.
 * @param {(row: PatentAggregate) => number} getter
 * @param {(row: PatentAggregate) => number} ciGetter
 * @param {number} [barWidth]
 * @returns {Partial<Data>[]}
 */
function groupedBars(view, getter, ciGetter, barWidth = 0.19) {
  return PATENT_PROTOCOLS.map(([protocol, label, color], index) => {
    /** @type {number[]} */
    const x = [];
    /** @type {number[]} */
    const y = [];
    /** @type {number[]} */
    const ci = [];
    PATENT_SCENARIOS.forEach(([scenario], position) => {
      const row = view.get(`${scenario}\u0000${protocol}`);
      if (!row) return;
      x.push(position + (index - 1.5) * barWidth);
      y.push(getter(row));
      ci.push(ciGetter(row));
    });
    return /** @type {Partial<Data>} */ ({
      type: "bar",
      x,
      y,
      width: barWidth,
      name: label,
      marker: { color, line: { color: "white", width: 0.5 } },
      error_y: {
        type: "data",
        array: ci,
        visible: true,
        thickness: 0.8,
        width: 2,
        color: "#333333",
      },
      legendgroup: protocol,
    });
  });
}

/**
 * X axis carrying the Chinese scenario labels.
 *
 * @returns {Partial<Layout["xaxis"]>}
 */
function scenarioAxis() {
  const positions = PATENT_SCENARIOS.map((_, index) => index);
  return {
    ...axisStyle({ grid: false, tickSize: 8 }),
    tickmode: "array",
    tickvals: positions,
    ticktext: PATENT_SCENARIOS.map(([, label]) => label),
    range: [-0.7, PATENT_SCENARIOS.length - 0.3],
  };
}

/**
 * Legend placed above the plot area.
 *
 * @returns {Partial<Layout["legend"]>}
 */
function topLegend() {
  return {
    orientation: "h",
    x: 0.5,
    xanchor: "center",
    y: 1.02,
    yanchor: "bottom",
    font: { size: 8 },
    tracegroupgap: 4,
  };
}

/**
 * fig10: aggregate forward goodput per scenario.
 *
 * @param {Map<string, PatentAggregate>} view
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotPatentGoodput(view, renderer) {
  const width = inches(9.6);
  const height = inches(4.4);

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 8,
      margin: { top: 76, right: 25, bottom: 55, left: 80 },
    }),
    title: {
      text: "聚合前向吞吐量（三次随机种子重复的均值与 95% 置信区间）",
      font: { size: 10 },
      x: 0.5,
      xanchor: "center",
    },
    bargap: 0.25,
    bargroupgap: 0.02,
    xaxis: scenarioAxis(),
    yaxis: axisStyle({ title: "聚合前向吞吐量 (Mbps)", log: true }),
    legend: topLegend(),
  };

  return saveFigure(renderer, {
    name: "fig10_patent_goodput",
    width,
    height,
    data: groupedBars(
      view,
      (row) => row.goodput,
      (row) => row.goodputCi,
    ),
    layout,
  });
}

/**
 * fig11: mean forward one-way delay per scenario, with the base propagation
 * delay of each link budget marked.
 *
 * @param {Map<string, PatentAggregate>} view
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotPatentDelay(view, renderer) {
  const width = inches(9.6);
  const height = inches(4.4);

  /** @type {Partial<Shape>[]} */
  const shapes = [];
  PATENT_SCENARIOS.forEach(([scenario], position) => {
    const row = view.get(`${scenario}\u0000TcpSwift`);
    if (!row) return;
    shapes.push({
      type: "line",
      x0: position - 0.42,
      x1: position + 0.42,
      y0: Math.max(row.baseOwdMs, 1e-3),
      y1: Math.max(row.baseOwdMs, 1e-3),
      line: { color: "#222222", width: 1, dash: "dash" },
      layer: "above",
    });
  });

  /** @type {Partial<Data>} */
  const lineHandle = {
    type: "scatter",
    mode: "lines",
    x: [],
    y: [],
    name: "基线传播时延",
    line: { color: "#222222", width: 1, dash: "dash" },
    showlegend: true,
  };

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 8,
      margin: { top: 76, right: 25, bottom: 55, left: 80 },
    }),
    title: {
      text: "平均单向前向时延（短划线为基线传播时延）",
      font: { size: 10 },
      x: 0.5,
      xanchor: "center",
    },
    bargap: 0.25,
    bargroupgap: 0.02,
    xaxis: scenarioAxis(),
    yaxis: axisStyle({ title: "平均单向时延 (ms)", log: true }),
    legend: topLegend(),
    shapes,
  };

  return saveFigure(renderer, {
    name: "fig11_patent_delay",
    width,
    height,
    data: [
      ...groupedBars(
        view,
        (row) => row.delay,
        (row) => row.delayCi,
      ),
      lineHandle,
    ],
    layout,
  });
}

/**
 * fig12: cross-traffic robustness — goodput change and added loss when the
 * on/off UDP burst shares the bottleneck.
 *
 * @param {Map<string, PatentAggregate>} tcpView
 * @param {Map<string, PatentAggregate>} udpView
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotPatentRobustness(tcpView, udpView, renderer) {
  const width = inches(9.6);
  const height = inches(5.8);
  const barWidth = 0.19;

  /** @type {Partial<Data>[]} */
  const data = [];
  PATENT_PROTOCOLS.forEach(([protocol, label, color], index) => {
    /** @type {number[]} */
    const changeX = [];
    /** @type {number[]} */
    const changes = [];
    /** @type {number[]} */
    const lossX = [];
    /** @type {number[]} */
    const losses = [];
    PATENT_SCENARIOS.forEach(([scenario], position) => {
      const tcpRow = tcpView.get(`${scenario}\u0000${protocol}`);
      const udpRow = udpView.get(`${scenario}\u0000${protocol}`);
      if (!tcpRow || !udpRow || tcpRow.goodput <= 0) return;
      const offset = position + (index - 1.5) * barWidth;
      changeX.push(offset);
      changes.push((100 * (udpRow.goodput - tcpRow.goodput)) / tcpRow.goodput);
      lossX.push(offset);
      losses.push(Math.max(udpRow.loss - tcpRow.loss, 0));
    });

    data.push(
      /** @type {Partial<Data>} */ ({
        type: "bar",
        x: changeX,
        y: changes,
        width: barWidth,
        name: label,
        marker: { color, line: { color: "white", width: 0.5 } },
        xaxis: "x",
        yaxis: "y",
        legendgroup: protocol,
      }),
    );
    data.push(
      /** @type {Partial<Data>} */ ({
        type: "bar",
        x: lossX,
        y: losses,
        width: barWidth,
        name: label,
        marker: { color, line: { color: "white", width: 0.5 } },
        xaxis: "x2",
        yaxis: "y2",
        legendgroup: protocol,
        showlegend: false,
      }),
    );
  });

  /** @type {Partial<Annotation>[]} */
  const annotations = [
    {
      text: "UDP 突发共存下的聚合吞吐量变化（%）",
      x: -0.07,
      y: 0.5,
      xref: "x domain",
      yref: "y domain",
      xanchor: "center",
      yanchor: "middle",
      textangle: -90,
      showarrow: false,
      font: { size: 8 },
    },
    {
      text: "UDP 突发新增丢包（百分点）",
      x: -0.07,
      y: 0.5,
      xref: "x2 domain",
      yref: "y2 domain",
      xanchor: "center",
      yanchor: "middle",
      textangle: -90,
      showarrow: false,
      font: { size: 8 },
    },
  ];

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 8,
      margin: { top: 90, right: 25, bottom: 55, left: 90 },
    }),
    title: {
      text: "跨流量鲁棒性：突发 UDP 负荷下相对纯 TCP 设置的变化",
      font: { size: 10 },
      x: 0.5,
      xanchor: "center",
    },
    bargap: 0.25,
    bargroupgap: 0.02,
    grid: { rows: 2, columns: 1, pattern: "independent", ygap: 0.34 },
    xaxis: { ...scenarioAxis(), anchor: "y" },
    yaxis: {
      ...axisStyle({}),
      anchor: "x",
      zeroline: true,
      zerolinecolor: "#444444",
    },
    xaxis2: { ...scenarioAxis(), anchor: "y2" },
    yaxis2: { ...axisStyle({}), anchor: "x2", rangemode: "tozero" },
    legend: topLegend(),
    annotations,
  };

  return saveFigure(renderer, {
    name: "fig12_patent_robustness",
    width,
    height,
    data,
    layout,
  });
}

/**
 * Render every patent figure and refresh the KPI tables.
 *
 * @returns {Promise<void>}
 */
export async function main() {
  await mkdir(PLOTS_DIR, { recursive: true });

  const { runs, aggregates, anomalies } = await loadPatentData();
  const expected =
    PATENT_SCENARIOS.length *
    PATENT_PROTOCOLS.length *
    PATENT_SEEDS.length *
    SETTINGS.length;

  if (runs.length !== expected) {
    for (const [, scenario, protocol, reason] of anomalies) {
      console.error(`[ANOMALY] ${scenario} | ${protocol} | ${reason}`);
    }
    throw new Error(
      `accepted ${runs.length} of ${expected} native runs; finish the ` +
        "simulation campaign or record the exclusions before rendering",
    );
  }

  const tables = await writePatentKpi(runs, aggregates);
  await appendAnomalies(anomalies);

  /** @type {Map<string, PatentAggregate>} */
  const tcpView = new Map();
  /** @type {Map<string, PatentAggregate>} */
  const udpView = new Map();
  for (const row of aggregates) {
    const key = `${row.scenario}\u0000${row.protocol}`;
    if (row.setting === "tcp_only") tcpView.set(key, row);
    else udpView.set(key, row);
  }

  /** @type {{ stem: string, files: string[] }[]} */
  const figures = [];
  const renderer = await FigureRenderer.open();
  try {
    figures.push(await plotStateClassification(renderer));
    figures.push(await plotWindowDecision(renderer));
    figures.push(await plotPatentGoodput(tcpView, renderer));
    figures.push(await plotPatentDelay(tcpView, renderer));
    figures.push(await plotPatentRobustness(tcpView, udpView, renderer));
  } finally {
    await renderer.close();
  }

  console.log(
    JSON.stringify(
      {
        runs: runs.length,
        groups: aggregates.length,
        new_anomalies: anomalies.length,
        kpi_forward: path.relative(REPO_ROOT, tables.forward),
        kpi_aggregate: path.relative(REPO_ROOT, tables.aggregate),
        figures: figures.map((figure) => figure.stem),
      },
      null,
      2,
    ),
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().then(
    () => {
      process.exitCode = 0;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
