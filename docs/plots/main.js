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
 * Render teaching figures from explicitly marked FlowMonitor data.
 *
 * The pipeline reads logs, recomputes KPIs from forward TCP data flows, and
 * selects the documented S1-S19 and UDP comparison subsets.
 *
 * JavaScript replacement for the former Python plotter. Shared scenarios and
 * FlowMonitor parsing come from `lib/`, and the method diagrams describe the
 * native C++ TcpSwift control path.
 *
 * Each figure is written as `.png` (Word/Markdown), `.pdf` (LaTeX) and `.svg`
 * (vector editing).
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { buildCsv, parseCsv } from "../../lib/csv.js";
import { forwardKpi, listFlowMonitorFiles } from "../../lib/flowmonitor.js";
import { FigureRenderer } from "../../lib/plotly.js";
import {
  DOCS_PLOT_COLORS,
  PROTOCOL_LABEL,
  PROTOCOL_ORDER,
  SCENARIOS,
  SCENARIO_BY_SID,
  S_ORDER,
  UDP_PAIRED_SIDS,
} from "../../lib/scenarios.js";
import { floatToString, round } from "../../lib/stats.js";
import { GRID_COLOR, axisStyle, baseLayout, inches } from "../../lib/theme.js";

/** @import { Data, Layout } from "plotly.js-dist-min" */
/** @import { FigureRenderer as Renderer, FigureSpec } from "../../lib/plotly.js" */

/** Repository root, resolved from this file's location. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Directory holding the archived simulation artifacts. */
const LOGS_DIR = path.join(REPO_ROOT, "logs");

/** Directory the figures are written to. */
const PLOTS_DIR = path.join(REPO_ROOT, "docs", "plots");

/** Regenerated KPI table; the thesis quotes numbers from this file. */
const KPI_CSV = path.join(LOGS_DIR, "summary", "kpi_forward.csv");

/** Number of artifacts the archived dataset must contain. */
const EXPECTED_ARTIFACTS = 288;

/** Name of the figure inventory written alongside the images. */
const MANIFEST_NAME = "figure_manifest.json";

/** Figure stems owned by this pipeline. */
const FIGURE_STEMS = new Set([
  "fig01_goodput_clean",
  "fig02_delay_clean",
  "fig03_tradeoff_clean",
  "fig04_udp_burst_clean",
  "fig06_architecture_zh",
  "fig07_workflow_zh",
]);

/**
 * KPI columns whose Python value is an `int`.
 *
 * Every other numeric column is a `float`. CPython renders integral floats with
 * a `.0` suffix but integers without one, and that difference is visible in the
 * archived CSV, so the distinction has to be reproduced explicitly.
 *
 * @type {ReadonlySet<string>}
 */
const INTEGER_COLUMNS = new Set(["Flows"]);

/** A single KPI row, keyed by the CSV column names. */
/** @typedef {Record<string, string | number>} KpiRow */

/**
 * A plotly annotation.
 *
 * @typedef {NonNullable<Layout["annotations"]>[number]} Annotation
 */

/** A plotly layout shape. */
/** @typedef {NonNullable<Layout["shapes"]>[number]} Shape */

/**
 * Parsed link rate, in Mbps.
 *
 * @param {string} text - Link rate such as `25Gbps`, `500Mbps`, or `100bps`.
 * @returns {number}
 */
export function rateMbps(text) {
  const match = /^([\d.]+)([GMK]?)bps/.exec(text);
  if (!match) throw new Error(`unparsable rate: ${text}`);
  const scale = { G: 1000, M: 1, K: 1e-3, "": 1e-6 }[match[2]];
  return Number.parseFloat(match[1]) * (scale ?? 1);
}

/**
 * Parsed delay, in milliseconds.
 *
 * @param {string} text - Delay such as `2us`, `500ns`, or `5ms`.
 * @returns {number}
 */
export function delayMs(text) {
  const match = /^([\d.]+)(ns|us|ms|s)/.exec(text);
  if (!match) throw new Error(`unparsable delay: ${text}`);
  const scale = { ns: 1e-6, us: 1e-3, ms: 1, s: 1e3 }[match[2]];
  return Number.parseFloat(match[1]) * (scale ?? 1);
}

/**
 * Definition of one scenario row.
 *
 * @typedef {object} ScenarioLink
 * @property {string} access
 * @property {string} bottleneck
 * @property {string} accessDelay
 * @property {string} bottleneckDelay
 */

/** Scenario link lookup, derived from the shared scenario catalogue. */
/** @type {Map<string, ScenarioLink>} */
const SCENARIO_LINKS = new Map(
  SCENARIOS.map(([name, access, bottleneck, accessDelay, bottleneckDelay]) => [
    name,
    { access, bottleneck, accessDelay, bottleneckDelay },
  ]),
);

/**
 * Recompute the KPI table from every marked FlowMonitor artifact.
 *
 * @returns {Promise<KpiRow[]>}
 * @throws {Error} When no artifacts are found.
 */
export async function deriveRows() {
  /** @type {ReadonlyArray<readonly [string, string]>} */
  const settings = [
    ["tcp_only", path.join(LOGS_DIR, "comparison")],
    ["udp_burst", path.join(LOGS_DIR, "comparison-udp")],
  ];

  /** @type {KpiRow[]} */
  const rows = [];
  for (const [setting, directory] of settings) {
    for (const filepath of listFlowMonitorFiles(directory)) {
      const base = path.basename(filepath, ".flowmonitor");
      const match = /^(.+)_(Tcp[A-Za-z0-9]+?)(?:_s(\d+))?$/.exec(base);
      if (!match) {
        throw new Error(`unrecognised artifact name: ${base}`);
      }
      const scenario = match[1];
      const protocol = match[2];
      const link = SCENARIO_LINKS.get(scenario);
      if (!link) continue;

      const kpi = forwardKpi(filepath);
      const bottleneckMbps = rateMbps(link.bottleneck);
      rows.push({
        Setting: setting,
        Scenario: scenario,
        Protocol: protocol,
        BottleneckMbps: bottleneckMbps,
        BaseOwdMs: round(
          2 * delayMs(link.accessDelay) + delayMs(link.bottleneckDelay),
          4,
        ),
        Flows: kpi.nflow,
        SinkPort: kpi.ports,
        Goodput_Mbps: round(kpi.goodput, 2),
        Util: round(kpi.goodput / bottleneckMbps, 4),
        Delay_ms: round(kpi.delay, 4),
        Jitter_ms: round(kpi.jitter, 4),
        Loss_pct: round(kpi.loss, 4),
        Jain: round(kpi.jain, 4),
        Source: path.relative(LOGS_DIR, filepath).split(path.sep).join("/"),
      });
    }
  }

  if (rows.length === 0) {
    throw new Error(
      `No FlowMonitor files found under ${LOGS_DIR}; ` +
        "run the simulations first",
    );
  }
  return rows;
}

/**
 * Write the KPI table and report how it differs from the previous revision.
 *
 * @param {KpiRow[]} rows
 * @returns {Promise<string>} Human-readable status line for the manifest.
 */
export async function writeAndVerifyCsv(rows) {
  const first = rows[0];
  if (!first) throw new Error("cannot write an empty KPI table");
  const fieldnames = Object.keys(first);

  /** @type {Record<string, string>[] | null} */
  let previous = null;
  try {
    previous = parseCsv(await readFile(KPI_CSV, "utf8"));
  } catch {
    previous = null;
  }

  // Render every cell the way CPython's `csv` module would, so the file can be
  // compared against the archived revision byte for byte.
  /** @type {Record<string, string>[]} */
  const current = rows.map((row) => {
    /** @type {Record<string, string>} */
    const converted = {};
    for (const key of fieldnames) {
      const value = row[key];
      converted[key] =
        typeof value === "string" || INTEGER_COLUMNS.has(key)
          ? String(value)
          : floatToString(value);
    }
    return converted;
  });

  await mkdir(path.dirname(KPI_CSV), { recursive: true });
  await writeFile(
    KPI_CSV,
    buildCsv(fieldnames, current, { lineterminator: "\n" }),
    "utf8",
  );

  if (previous === null) return "kpi_forward.csv created";

  if (previous.length !== current.length) {
    return `kpi_forward.csv ROW COUNT CHANGED: ${previous.length} -> ${current.length}`;
  }

  let changed = 0;
  for (const [index, before] of previous.entries()) {
    const after = current[index];
    const differs = fieldnames.some((key) => before[key] !== after[key]);
    if (differs) changed += 1;
  }
  return changed === 0
    ? "kpi_forward.csv regenerated: identical to previous version"
    : `kpi_forward.csv regenerated: ${changed} rows CHANGED vs previous version`;
}

/**
 * Selected `(setting, scenario)` groups addressed by S-number.
 *
 * @typedef {Record<string, Record<string, Record<string, KpiRow>>>} PlotView
 */

/**
 * Restrict the KPI rows to the documented S1-S19 and UDP subsets.
 *
 * @param {KpiRow[]} rows
 * @returns {PlotView}
 * @throws {Error} When a selected group is missing one of the four protocols.
 */
export function buildPlotView(rows) {
  /** @type {Map<string, Map<string, Record<string, KpiRow>>>} */
  const groups = new Map();
  for (const row of rows) {
    const setting = String(row.Setting);
    const scenario = String(row.Scenario);
    const protocol = String(row.Protocol);
    let perScenario = groups.get(setting);
    if (!perScenario) {
      perScenario = new Map();
      groups.set(setting, perScenario);
    }
    let perProtocol = perScenario.get(scenario);
    if (!perProtocol) {
      perProtocol = {};
      perScenario.set(scenario, perProtocol);
    }
    perProtocol[protocol] = row;
  }

  const selected = {
    tcp_only: S_ORDER.map(([, scenario]) => scenario),
    udp_burst: S_ORDER.filter(([sid]) => UDP_PAIRED_SIDS.includes(sid)).map(
      ([, scenario]) => scenario,
    ),
  };

  /** @type {PlotView} */
  const view = { tcp_only: {}, udp_burst: {} };
  for (const [setting, scenarios] of Object.entries(selected)) {
    for (const scenario of scenarios) {
      const protocols = groups.get(setting)?.get(scenario) ?? {};
      const found = Object.keys(protocols).sort();
      if (
        found.length !== PROTOCOL_ORDER.length ||
        !PROTOCOL_ORDER.every((protocol) => protocol in protocols)
      ) {
        throw new Error(
          `Incomplete group ${setting}/${scenario}: ` +
            `found [${found.join(", ")}], expected [${PROTOCOL_ORDER.join(", ")}]`,
        );
      }
      view[setting][scenario] = protocols;
    }
  }
  return view;
}

// =============================================================================
// Figure helpers
// =============================================================================

/**
 * Colour of one protocol in the thesis figures.
 *
 * @param {string} protocol
 * @returns {string}
 */
function protocolColor(protocol) {
  return DOCS_PLOT_COLORS[protocol] ?? "#333333";
}

/**
 * Short label of one protocol in the thesis figures.
 *
 * @param {string} protocol
 * @returns {string}
 */
function protocolLabel(protocol) {
  return PROTOCOL_LABEL[/** @type {keyof typeof PROTOCOL_LABEL} */ (protocol)] ?? protocol;
}

/**
 * `str.title()` equivalent, used for scenario annotations.
 *
 * @param {string} text
 * @returns {string}
 */
function titleCase(text) {
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Grouped bar traces, one per protocol, over a numeric scenario axis.
 *
 * Bars are offset by `(index - 1.5) * width` so the grouping matches the
 * matplotlib original exactly.
 *
 * @param {Record<string, Record<string, KpiRow>>} view - Rows for one setting.
 * @param {number[]} positions - Scenario positions on the x axis.
 * @param {string[]} sids - S-numbers, aligned with `positions`.
 * @param {string} valueKey - KPI column to plot.
 * @param {number} [width] - Bar width in category units.
 * @returns {{ traces: Partial<Data>[], categories: string[] }}
 */
function groupedBarTraces(view, positions, sids, valueKey, width = 0.19) {
  const categories = sids.map((sid) => SCENARIO_BY_SID.get(sid) ?? sid);
  /** @type {Partial<Data>[]} */
  const traces = [];

  PROTOCOL_ORDER.forEach((protocol, index) => {
    /** @type {number[]} */
    const xs = [];
    /** @type {number[]} */
    const ys = [];
    categories.forEach((scenario, position) => {
      const row = view[scenario]?.[protocol];
      if (!row) return;
      xs.push(positions[position] + (index - 1.5) * width);
      ys.push(Number(row[valueKey]));
    });
    traces.push({
      type: "bar",
      x: xs,
      y: ys,
      width,
      name: protocolLabel(protocol),
      marker: { color: protocolColor(protocol), line: { color: "white", width: 0.5 } },
      legendgroup: protocol,
    });
  });

  return { traces, categories };
}

/**
 * x axis configured with S-number ticks on a numeric scale.
 *
 * @param {string[]} sids
 * @param {number[]} positions
 * @param {number} [tickSize]
 * @returns {Partial<Layout["xaxis"]>}
 */
function sidAxis(sids, positions, tickSize = 8) {
  return {
    ...axisStyle({ grid: false, tickSize }),
    tickmode: "array",
    tickvals: positions,
    ticktext: sids,
    range: [-0.7, sids.length - 0.3],
  };
}

/**
 * Legend placed above the plot area, like the matplotlib `bbox_to_anchor` call.
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
 * Render one figure and write the PNG, PDF, and SVG outputs.
 *
 * @param {Renderer} renderer
 * @param {FigureSpec} spec
 * @returns {Promise<{ stem: string, files: string[] }>} Written file names.
 */
export async function saveFigure(renderer, spec) {
  const rendered = await renderer.render(
    spec,
    { png: true, pdf: true, svg: true },
    300 / 72,
  );

  /** @type {string[]} */
  const files = [];
  for (const extension of ["png", "pdf", "svg"]) {
    const filename = `${spec.name}.${extension}`;
    const target = path.join(PLOTS_DIR, filename);
    const payload =
      extension === "png"
        ? rendered.png
        : extension === "pdf"
          ? rendered.pdf
          : rendered.svg;
    if (payload === undefined) continue;
    await writeFile(target, payload);
    files.push(filename);
  }
  return { stem: spec.name, files };
}

// =============================================================================
// Figures
// =============================================================================

/**
 * fig01: aggregate forward goodput for the 19 representative scenarios.
 *
 * @param {PlotView} view
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotGoodput(view, renderer) {
  const sids = S_ORDER.map(([sid]) => sid);
  const positions = sids.map((_, index) => index);
  const width = inches(9.6);
  const height = inches(3.6);
  const { traces } = groupedBarTraces(
    view.tcp_only,
    positions,
    sids,
    "Goodput_Mbps",
  );

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 8,
      margin: { top: 70, right: 25, bottom: 45, left: 80 },
    }),
    title: {
      text: "Forward goodput across 19 selected scenarios (TCP-only)",
      font: { size: 10 },
      x: 0.5,
      xanchor: "center",
    },
    bargap: 0.25,
    bargroupgap: 0.02,
    xaxis: sidAxis(sids, positions),
    yaxis: axisStyle({ title: "Aggregate forward goodput (Mbps)", log: true }),
    legend: topLegend(),
  };

  return saveFigure(renderer, {
    name: "fig01_goodput_clean",
    width,
    height,
    data: traces,
    layout,
  });
}

/**
 * fig02: mean one-way delay against the base propagation delay.
 *
 * @param {PlotView} view
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotDelay(view, renderer) {
  const sids = S_ORDER.map(([sid]) => sid);
  const positions = sids.map((_, index) => index);
  const width = inches(9.6);
  const height = inches(3.6);
  const { traces, categories } = groupedBarTraces(
    view.tcp_only,
    positions,
    sids,
    "Delay_ms",
  );

  // Dashes marking the base propagation OWD, one short line per scenario.
  /** @type {Partial<Shape>[]} */
  const shapes = [];
  categories.forEach((scenario, position) => {
    const protocols = view.tcp_only[scenario];
    const first = protocols ? Object.values(protocols)[0] : undefined;
    if (!first) return;
    const baseOwd = Number(first.BaseOwdMs);
    shapes.push({
      type: "line",
      x0: position - 0.42,
      x1: position + 0.42,
      y0: Math.max(baseOwd, 1e-3),
      y1: Math.max(baseOwd, 1e-3),
      line: { color: "#222222", width: 1, dash: "dash" },
      layer: "above",
    });
  });

  // Legend proxy: the dashes themselves are layout shapes, which cannot carry a
  // legend entry, so an empty line trace supplies the swatch.
  /** @type {Partial<Data>} */
  const lineHandle = {
    type: "scatter",
    mode: "lines",
    x: [],
    y: [],
    name: "Base OWD",
    line: { color: "#222222", width: 1, dash: "dash" },
    showlegend: true,
  };

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 8,
      margin: { top: 70, right: 25, bottom: 45, left: 80 },
    }),
    title: {
      text: "Forward one-way delay; dashes mark the base propagation OWD",
      font: { size: 10 },
      x: 0.5,
      xanchor: "center",
    },
    bargap: 0.25,
    bargroupgap: 0.02,
    xaxis: sidAxis(sids, positions),
    yaxis: axisStyle({ title: "Mean one-way delay (ms)", log: true }),
    legend: topLegend(),
    shapes,
  };

  return saveFigure(renderer, {
    name: "fig02_delay_clean",
    width,
    height,
    data: [...traces, lineHandle],
    layout,
  });
}

/**
 * fig03: bottleneck utilization against mean one-way delay.
 *
 * @param {PlotView} view
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotTradeoff(view, renderer) {
  const width = inches(6.4);
  const height = inches(4.2);

  /** @type {Partial<Data>[]} */
  const data = [];
  for (const protocol of PROTOCOL_ORDER) {
    /** @type {number[]} */
    const xs = [];
    /** @type {number[]} */
    const ys = [];
    for (const scenario of Object.keys(view.tcp_only).sort()) {
      const row = view.tcp_only[scenario]?.[protocol];
      if (!row) continue;
      xs.push(Math.max(Number(row.Delay_ms), 1e-2));
      ys.push(Number(row.Util) * 100);
    }
    data.push({
      type: "scatter",
      mode: "markers",
      x: xs,
      y: ys,
      name: protocolLabel(protocol),
      marker: {
        color: protocolColor(protocol),
        size: 9,
        opacity: 0.8,
        line: { color: "white", width: 0.6 },
      },
    });
  }

  // Point labels are drawn as a text trace rather than annotations: plotly
  // misplaces data-coordinate annotations on logarithmic axes, while text
  // markers are positioned correctly.
  /** @type {number[]} */
  const labelX = [];
  /** @type {number[]} */
  const labelY = [];
  /** @type {string[]} */
  const labelText = [];
  for (const sid of ["S8", "S9", "S19"]) {
    const scenario = SCENARIO_BY_SID.get(sid);
    const row = scenario ? view.tcp_only[scenario]?.TcpSwift : undefined;
    if (!row) continue;
    labelX.push(Math.max(Number(row.Delay_ms), 1e-2));
    labelY.push(Number(row.Util) * 100);
    labelText.push(sid);
  }
  if (labelText.length > 0) {
    data.push({
      type: "scatter",
      mode: "text",
      x: labelX,
      y: labelY,
      text: labelText,
      textposition: "top right",
      textfont: { size: 8, color: protocolColor("TcpSwift") },
      showlegend: false,
      hoverinfo: "skip",
    });
  }

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 8,
      margin: { top: 55, right: 25, bottom: 55, left: 70 },
    }),
    title: {
      text: "Utilization-delay trade-off (TCP-only, 19 scenarios)",
      font: { size: 10 },
      x: 0.5,
      xanchor: "center",
    },
    xaxis: axisStyle({ title: "Mean one-way delay (ms, log scale)", log: true }),
    yaxis: { ...axisStyle({ title: "Bottleneck utilization (%)" }), range: [0, 108] },
    legend: { x: 1, y: 0, xanchor: "right", yanchor: "bottom", font: { size: 8 } },
  };

  return saveFigure(renderer, {
    name: "fig03_tradeoff_clean",
    width,
    height,
    data,
    layout,
  });
}

/**
 * fig04: goodput change and added loss under UDP burst across paired scenarios.
 *
 * @param {PlotView} view
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotUdpBurst(view, renderer) {
  const sids = UDP_PAIRED_SIDS;
  const positions = sids.map((_, index) => index);
  const width = inches(9.6);
  const height = inches(5.6);
  const barWidth = 0.19;

  /** @type {Partial<Data>[]} */
  const data = [];
  PROTOCOL_ORDER.forEach((protocol, index) => {
    /** @type {number[]} */
    const dropX = [];
    /** @type {number[]} */
    const drops = [];
    /** @type {number[]} */
    const lossX = [];
    /** @type {number[]} */
    const losses = [];

    sids.forEach((sid, position) => {
      const scenario = SCENARIO_BY_SID.get(sid);
      if (!scenario) return;
      const tcpRow = view.tcp_only[scenario]?.[protocol];
      const udpRow = view.udp_burst[scenario]?.[protocol];
      if (!tcpRow || !udpRow) return;
      const tcpGoodput = Number(tcpRow.Goodput_Mbps);
      const offset = positions[position] + (index - 1.5) * barWidth;
      dropX.push(offset);
      drops.push((100 * (Number(udpRow.Goodput_Mbps) - tcpGoodput)) / tcpGoodput);
      lossX.push(offset);
      losses.push(
        Math.max(Number(udpRow.Loss_pct) - Number(tcpRow.Loss_pct), 0),
      );
    });

    data.push({
      type: "bar",
      x: dropX,
      y: drops,
      width: barWidth,
      name: protocolLabel(protocol),
      marker: { color: protocolColor(protocol), line: { color: "white", width: 0.5 } },
      xaxis: "x",
      yaxis: "y",
      legendgroup: protocol,
    });
    data.push({
      type: "bar",
      x: lossX,
      y: losses,
      width: barWidth,
      name: protocolLabel(protocol),
      marker: { color: protocolColor(protocol), line: { color: "white", width: 0.5 } },
      xaxis: "x2",
      yaxis: "y2",
      legendgroup: protocol,
      showlegend: false,
    });
  });

  /** @type {Partial<Annotation>[]} */
  const annotations = [
    {
      text: "Cross-traffic robustness on the 15 paired scenarios",
      x: 0.5,
      y: 1,
      xref: "x domain",
      yref: "y domain",
      xanchor: "center",
      yanchor: "bottom",
      showarrow: false,
      font: { size: 10 },
    },
    {
      text: "Goodput change under burst (%)",
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
      text: "Added loss under burst (pp)",
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
      margin: { top: 100, right: 25, bottom: 45, left: 85 },
    }),
    bargap: 0.25,
    bargroupgap: 0.02,
    grid: { rows: 2, columns: 1, pattern: "independent", ygap: 0.34 },
    xaxis: { ...sidAxis(sids, positions), anchor: "y" },
    // All observed deltas stay well below the symlog threshold, so the panel is
    // linear across the plotted range; matplotlib's symlog axis reproduces this
    // exactly for the data at hand.
    yaxis: { ...axisStyle({}), anchor: "x", zeroline: true, zerolinecolor: "#444444" },
    xaxis2: { ...sidAxis(sids, positions), anchor: "y2" },
    yaxis2: { ...axisStyle({}), anchor: "x2", rangemode: "tozero" },
    legend: topLegend(),
    annotations,
  };

  return saveFigure(renderer, {
    name: "fig04_udp_burst_clean",
    width,
    height,
    data,
    layout,
  });
}

// =============================================================================
// Diagram figures
// =============================================================================

/**
 * Cubic-Bézier control-point offset for a quarter circle.
 *
 * `4/3 * tan(pi/8)`, the standard constant that makes a cubic Bézier match a
 * circular arc to within 0.02%.
 */
const BEZIER_CIRCLE_K = 0.5522847498307936;

/**
 * SVG path for a rounded rectangle, in the diagram's pixel coordinate space.
 *
 * Corners are cubic Béziers rather than elliptical arcs because plotly's path
 * shapes render only the move/line/curve commands; an `A` command is silently
 * flattened, which would leave the boxes square.
 *
 * @param {number} x - Left edge.
 * @param {number} y - Bottom edge.
 * @param {number} w - Width.
 * @param {number} h - Height.
 * @param {number} r - Corner radius.
 * @returns {string}
 */
export function roundedRectPath(x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  const c = radius * BEZIER_CIRCLE_K;
  return [
    `M ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `C ${x + w - radius + c} ${y} ${x + w} ${y + radius - c} ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h - radius}`,
    `C ${x + w} ${y + h - radius + c} ${x + w - radius + c} ${y + h} ${x + w - radius} ${y + h}`,
    `L ${x + radius} ${y + h}`,
    `C ${x + radius - c} ${y + h} ${x} ${y + h - radius + c} ${x} ${y + h - radius}`,
    `L ${x} ${y + radius}`,
    `C ${x} ${y + radius - c} ${x + radius - c} ${y} ${x + radius} ${y}`,
    "Z",
  ].join(" ");
}

/**
 * Diagram canvas geometry: a point-based coordinate space where one data unit
 * equals one output point, so boxes can be placed in figure fractions.
 *
 * @param {object} options
 * @param {number} options.width - Figure width in points.
 * @param {number} options.height - Figure height in points.
 * @param {{ top: number, right: number, bottom: number, left: number }} options.margin
 * @returns {{ plotWidth: number, plotHeight: number, x: (fraction: number) => number, y: (fraction: number) => number }}
 */
export function diagramCanvas(options) {
  const { width, height, margin } = options;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  return {
    plotWidth,
    plotHeight,
    x: (fraction) => fraction * plotWidth,
    y: (fraction) => fraction * plotHeight,
  };
}

/**
 * Build the layout shared by both diagrams from the accumulated components.
 *
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {{ top: number, right: number, bottom: number, left: number }} options.margin
 * @param {ReturnType<typeof diagramCanvas>} options.canvas
 * @param {ShapeState} options.components
 * @param {{ text: string, size?: number }} [options.title]
 * @returns {Partial<Layout>}
 */
export function diagramLayout(options) {
  const { width, height, margin, canvas, components, title } = options;

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({ width, height, baseFontSize: 8, margin }),
    xaxis: {
      range: [0, canvas.plotWidth],
      visible: false,
      fixedrange: true,
      showgrid: false,
      zeroline: false,
    },
    yaxis: {
      range: [0, canvas.plotHeight],
      visible: false,
      fixedrange: true,
      showgrid: false,
      zeroline: false,
    },
    shapes: components.shapes,
    annotations: components.annotations,
    ...(title
      ? {
          title: {
            text: title.text,
            font: { size: title.size ?? 12 },
            x: 0.5,
            xanchor: "center",
          },
        }
      : {}),
  };

  return layout;
}

/**
 * Accumulator for the shapes, annotations, and line traces of a diagram.
 */
export class ShapeState {
  /** @type {Partial<Shape>[]} */
  shapes = [];
  /** @type {Partial<Annotation>[]} */
  annotations = [];
  /** @type {Partial<Data>[]} */
  traces = [];

  /**
   * Draw a rounded, filled box with centred (possibly multi-line) text.
   *
   * @param {{ x: number, y: number, width: number, height: number }} box - Pixel
   *   coordinates; `y` is the bottom edge.
   * @param {string} text - Label; `\n` starts a new line.
   * @param {string} facecolor
   * @param {number} [fontSize]
   * @param {number} [radius]
   * @returns {void}
   */
  box(box, text, facecolor, fontSize = 8.5, radius = 8) {
    this.shapes.push({
      type: "path",
      path: roundedRectPath(box.x, box.y, box.width, box.height, radius),
      line: { color: "#333333", width: 1 },
      fillcolor: facecolor,
      layer: "below",
    });
    this.annotations.push({
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      text: text.replace(/\n/g, "<br>"),
      showarrow: false,
      xanchor: "center",
      yanchor: "middle",
      font: { size: fontSize },
    });
  }

  /**
   * Draw a straight arrow, optionally labelled at its midpoint.
   *
   * @param {{ x: number, y: number }} start - Tail, in pixels.
   * @param {{ x: number, y: number }} end - Head, in pixels.
   * @param {string} [text]
   * @param {string} [color]
   * @param {number} [labelOffset] - Vertical label offset in pixels.
   * @returns {void}
   */
  arrow(start, end, text, color = "#333333", labelOffset = 7) {
    this.annotations.push({
      x: end.x,
      y: end.y,
      ax: start.x,
      ay: start.y,
      xref: "x",
      yref: "y",
      axref: "x",
      ayref: "y",
      text: "",
      showarrow: true,
      arrowhead: 2,
      arrowwidth: 1.1,
      arrowcolor: color,
    });
    if (text) {
      this.annotations.push({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2 + labelOffset,
        text,
        showarrow: false,
        xanchor: "center",
        yanchor: "middle",
        font: { size: 7, color },
      });
    }
  }

  /**
   * Draw an open polyline.
   *
   * @param {ReadonlyArray<readonly [number, number]>} points - Pixel coordinates.
   * @param {string} color
   * @returns {void}
   */
  polyline(points, color) {
    this.traces.push({
      type: "scatter",
      mode: "lines",
      x: points.map(([x]) => x),
      y: points.map(([, y]) => y),
      line: { color, width: 1.2 },
      hoverinfo: "skip",
      showlegend: false,
    });
  }

  /**
   * Place a free-standing text label.
   *
   * @param {{ x: number, y: number }} position - Pixel coordinates.
   * @param {string} text
   * @param {object} [options]
   * @param {number} [options.fontSize]
   * @param {string} [options.color]
   * @param {number} [options.rotate] - Clockwise rotation in degrees.
   * @returns {void}
   */
  label(position, text, options = {}) {
    this.annotations.push({
      x: position.x,
      y: position.y,
      text,
      showarrow: false,
      xanchor: "center",
      yanchor: "middle",
      textangle: options.rotate ?? 0,
      font: { size: options.fontSize ?? 7.5, color: options.color ?? "#333333" },
    });
  }
}

/**
 * fig06: overall control-loop architecture.
 *
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotArchitecture(renderer) {
  const width = inches(9.2);
  const height = inches(4.6);
  const margin = { top: 40, right: 10, bottom: 10, left: 10 };
  const shapes = new ShapeState();

  // Fractional geometry mirrors the matplotlib original; the canvas helper
  // scales it to points.
  const canvas = diagramCanvas({ width, height, margin });
  const box = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {string} */ text,
    /** @type {string} */ color,
  ) =>
    shapes.box(
      {
        x: canvas.x(x),
        y: canvas.y(y),
        width: canvas.x(w),
        height: canvas.y(h),
      },
      text,
      color,
    );
  const arrow = (
    /** @type {[number, number]} */ start,
    /** @type {[number, number]} */ end,
    /** @type {string | undefined} */ text,
    /** @type {string | undefined} */ color,
  ) =>
    shapes.arrow(
      { x: canvas.x(start[0]), y: canvas.y(start[1]) },
      { x: canvas.x(end[0]), y: canvas.y(end[1]) },
      text,
      color,
    );

  box(0.03, 0.60, 0.20, 0.22, "ns-3 TCP协议栈\n五类原生回调\nACK/丢包/RTT/ECN", "#DCEAF7");
  box(0.29, 0.60, 0.22, 0.22, "TcpSwift连接状态\n速率样本 / minRTT\nBDP / α / 安全计数", "#E8F3E8");
  box(0.57, 0.60, 0.20, 0.22, "原生C++决策逻辑\n同一离散事件进程\n无IPC / Python依赖", "#FFF7DE");
  box(0.81, 0.60, 0.16, 0.22, "窗口状态写回\nssThresh\n与cWnd", "#FCE4D6");
  box(
    0.05,
    0.12,
    0.24,
    0.24,
    "拥塞三分类判定\n超时 0.50 / ECN 0.75\n普通丢包 0.70",
    "#F4CCCC",
  );
  box(
    0.35,
    0.12,
    0.26,
    0.24,
    "两级BDP估计\n时间窗交付速率\n+ 40样本最大值滤波",
    "#EADCF8",
  );
  box(
    0.67,
    0.12,
    0.28,
    0.24,
    "基线相对反馈自适应\n快/慢EMA对比\n有界步长逼近 α×BDP",
    "#D9EAD3",
  );

  arrow([0.23, 0.71], [0.29, 0.71], "读取状态", undefined);
  arrow([0.51, 0.71], [0.57, 0.71], "本地计算", undefined);
  arrow([0.77, 0.71], [0.81, 0.71], "更新", undefined);
  arrow([0.17, 0.60], [0.17, 0.36], "拥塞信号", undefined);
  arrow([0.44, 0.60], [0.48, 0.36], "速率样本", undefined);
  arrow([0.29, 0.24], [0.35, 0.24], "非拥塞路径", undefined);
  arrow([0.61, 0.24], [0.67, 0.24], "BDP", undefined);
  arrow([0.86, 0.36], [0.88, 0.60], "候选窗口", "#0072B2");

  shapes.shapes.push({
    type: "path",
    path:
      `M ${canvas.x(0.86)} ${canvas.y(0.82)} ` +
      `Q ${canvas.x(0.5)} ${canvas.y(0.90)} ${canvas.x(0.13)} ${canvas.y(0.82)}`,
    line: { color: "#0072B2", width: 1.2, dash: "dot" },
    fillcolor: "rgba(0,0,0,0)",
    layer: "above",
  });
  shapes.label(
    { x: canvas.x(0.5), y: canvas.y(0.945) },
    "窗口状态由原生回调直接写回协议栈",
    { fontSize: 7.5, color: "#0072B2" },
  );

  const layout = diagramLayout({
    width,
    height,
    margin,
    canvas,
    components: shapes,
    title: { text: "原生C++拥塞控制回路总体架构" },
  });

  return saveFigure(renderer, {
    name: "fig06_architecture_zh",
    width,
    height,
    data: shapes.traces,
    layout,
  });
}

/**
 * fig07: end-to-end congestion-control method flowchart.
 *
 * @param {Renderer} renderer
 * @returns {Promise<{ stem: string, files: string[] }>}
 */
export async function plotWorkflow(renderer) {
  const width = inches(9.4);
  const height = inches(7.0);
  const margin = { top: 40, right: 10, bottom: 10, left: 10 };
  const shapes = new ShapeState();
  const canvas = diagramCanvas({ width, height, margin });

  const box = (
    /** @type {number} */ x,
    /** @type {number} */ y,
    /** @type {number} */ w,
    /** @type {number} */ h,
    /** @type {string} */ text,
    /** @type {string} */ color,
  ) =>
    shapes.box(
      {
        x: canvas.x(x),
        y: canvas.y(y),
        width: canvas.x(w),
        height: canvas.y(h),
      },
      text,
      color,
    );
  const arrow = (
    /** @type {[number, number]} */ start,
    /** @type {[number, number]} */ end,
    /** @type {string | undefined} */ text,
    /** @type {string | undefined} */ color,
  ) =>
    shapes.arrow(
      { x: canvas.x(start[0]), y: canvas.y(start[1]) },
      { x: canvas.x(end[0]), y: canvas.y(end[1]) },
      text,
      color,
    );
  const point = (/** @type {[number, number]} */ p) => ({
    x: canvas.x(p[0]),
    y: canvas.y(p[1]),
  });

  box(0.40, 0.93, 0.20, 0.045, "连接建立", "#EEEEEE");
  box(
    0.28,
    0.795,
    0.44,
    0.095,
    "S1 原生回调读取连接状态\n窗口状态 / 传输指标 / 时延测量 / 协议栈事件",
    "#DCEAF7",
  );
  box(0.28, 0.66, 0.44, 0.09, "S2 拥塞判定\n窗口缩减回调内的三分类语义判定", "#FFF7DE");
  box(
    0.11,
    0.30,
    0.40,
    0.22,
    "S5b 差异化缩减与安全保护\n保留因子：超时 0.50 / ECN 0.75 / 丢包 0.70\n" +
      "慢启动阈值锚定 min(cwnd, BDP)\n连续缩减保护 · 降窗后冻结\n窗口箝位 · 陈旧决策作废",
    "#F4CCCC",
  );
  box(
    0.58,
    0.46,
    0.40,
    0.13,
    "S3 带宽延迟积两级估计\n时间窗交付速率（跨度 ≥ 2×最小RTT）\n" +
      "40样本最大值滤波，BDP = 最大带宽 × 最小RTT",
    "#EADCF8",
  );
  box(
    0.58,
    0.295,
    0.40,
    0.115,
    "S4 参数自适应\nRTT膨胀 + 基线相对反馈 + 连续增长\n乘性增加因子 α ∈ [0.85, 1.30]",
    "#D9EAD3",
  );
  box(
    0.58,
    0.135,
    0.40,
    0.11,
    "S5a 目标窗口逼近\n目标窗口 = α × BDP\n上行有界步长 / 下行超出量的一半",
    "#E8F3E8",
  );
  box(0.28, 0.02, 0.44, 0.065, "S6 原生写回：更新拥塞窗口与慢启动阈值", "#FCE4D6");

  arrow([0.50, 0.93], [0.50, 0.89], undefined, undefined);
  arrow([0.50, 0.795], [0.50, 0.75], undefined, undefined);
  arrow([0.40, 0.66], [0.31, 0.52], "拥塞（三类）", undefined);
  arrow([0.60, 0.66], [0.74, 0.59], "非拥塞", undefined);
  arrow([0.78, 0.46], [0.78, 0.41], undefined, undefined);
  arrow([0.78, 0.295], [0.78, 0.245], undefined, undefined);
  arrow([0.68, 0.135], [0.60, 0.085], undefined, undefined);
  arrow([0.31, 0.30], [0.38, 0.085], undefined, undefined);

  const feedbackColor = "#0072B2";
  shapes.polyline(
    [
      [canvas.x(0.28), canvas.y(0.0525)],
      [canvas.x(0.05), canvas.y(0.0525)],
      [canvas.x(0.05), canvas.y(0.8425)],
    ],
    feedbackColor,
  );
  arrow([0.05, 0.8425], [0.28, 0.8425], undefined, feedbackColor);
  shapes.label(
    { x: canvas.x(0.038), y: canvas.y(0.62) },
    "反馈信号：快速EMA与慢速基线EMA更新",
    { fontSize: 7.5, color: feedbackColor, rotate: -90 },
  );

  const layout = diagramLayout({
    width,
    height,
    margin,
    canvas,
    components: shapes,
    title: { text: "拥塞控制方法整体流程", size: 12 },
  });

  return saveFigure(renderer, {
    name: "fig07_workflow_zh",
    width,
    height,
    data: shapes.traces,
    layout,
  });
}

/**
 * Delete only outputs owned by this pipeline so unrelated figures remain intact.
 *
 * @returns {Promise<string[]>} Names of the removed files.
 */
export async function cleanStaleOutputs() {
  /** @type {string[]} */
  const removed = [];
  /** @type {Set<string>} */
  let entries;
  try {
    entries = new Set(await readdir(PLOTS_DIR));
  } catch {
    return removed;
  }
  for (const stem of FIGURE_STEMS) {
    for (const extension of ["png", "pdf", "svg"]) {
      const entry = `${stem}.${extension}`;
      if (!entries.has(entry)) continue;
      await rm(path.join(PLOTS_DIR, entry), { force: true });
      removed.push(entry);
    }
  }
  return removed.sort();
}

/**
 * @returns {Promise<void>}
 */
export async function main() {
  await mkdir(PLOTS_DIR, { recursive: true });

  const rows = await deriveRows();
  if (rows.length !== EXPECTED_ARTIFACTS) {
    throw new Error(
      `Expected ${EXPECTED_ARTIFACTS} artifacts, found ${rows.length}`,
    );
  }

  const csvStatus = await writeAndVerifyCsv(rows);
  const view = buildPlotView(rows);
  const removed = await cleanStaleOutputs();

  /** @type {{ stem: string, files: string[] }[]} */
  const plots = [];
  const renderer = await FigureRenderer.open();
  try {
    plots.push(await plotGoodput(view, renderer));
    plots.push(await plotDelay(view, renderer));
    plots.push(await plotTradeoff(view, renderer));
    plots.push(await plotUdpBurst(view, renderer));
    plots.push(await plotArchitecture(renderer));
    plots.push(await plotWorkflow(renderer));
  } finally {
    await renderer.close();
  }

  const manifest = {
    source: "logs/{comparison,comparison-udp}/*.flowmonitor (288 archived artifacts)",
    kpi_csv: path.relative(REPO_ROOT, KPI_CSV).split(path.sep).join("/"),
    kpi_csv_status: csvStatus,
    metric_definition:
      "forward TCP data flows only (proto 6, 10.1.x -> 10.2.x); aggregate goodput uses the shared first-TX to last-RX span",
    selected_groups: {
      tcp_only: S_ORDER.map(([sid, scenario]) => `${sid}=${scenario}`),
      udp_burst: UDP_PAIRED_SIDS,
    },
    stale_outputs_removed: removed,
    figures: plots,
  };
  await writeFile(
    path.join(PLOTS_DIR, MANIFEST_NAME),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        kpi_csv_status: csvStatus,
        selected_tcp_groups: Object.keys(view.tcp_only).length,
        selected_udp_groups: Object.keys(view.udp_burst).length,
        figures: plots.map((plot) => plot.stem),
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
