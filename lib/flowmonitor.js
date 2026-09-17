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
 * FlowMonitor artifact handling shared by the simulation driver and the figure
 * pipeline: run-name parsing, XML parsing, the per-flow/per-scenario metric
 * models, and seed aggregation.
 *
 * The Python original used `xml.etree.ElementTree`; `fast-xml-parser` is used
 * here and every attribute is kept as a string so the accessors mirror
 * `Element.get(...)` followed by an explicit cast.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { mean, sum } from "./stats.js";

/**
 * Run artifacts are named `<scenario>_<Protocol>_s<seed>`. Older artifacts
 * without the seed suffix still parse (seed is `null` then).
 */
export const RUN_NAME_RE = /^(.+)_(Tcp[A-Za-z0-9]+)(?:_s(\d+))?$/;

/**
 * @typedef {object} RunName
 * @property {string} scenario
 * @property {string} protocol
 * @property {number | null} seed - `null` for artifacts without a seed suffix.
 */

/**
 * Split a run artifact basename into its scenario, protocol, and seed.
 *
 * @param {string} basename - File name without the `.flowmonitor` extension.
 * @returns {RunName | null} `null` when the name does not follow the convention.
 */
export function parseRunName(basename) {
  const match = RUN_NAME_RE.exec(basename);
  if (!match) return null;
  return {
    scenario: match[1],
    protocol: match[2],
    seed: match[3] ? Number.parseInt(match[3], 10) : null,
  };
}

/**
 * Metrics of a single FlowMonitor flow, mirroring the Python `FlowData`
 * dataclass and its derived properties.
 */
export class FlowData {
  /** @type {number} */
  flowId;
  /** @type {string} */
  srcAddr;
  /** @type {string} */
  dstAddr;
  /** @type {number} */
  protocol;
  /** @type {number} */
  txBytes;
  /** @type {number} */
  rxBytes;
  /** @type {number} */
  txPackets;
  /** @type {number} */
  rxPackets;
  /** @type {number} */
  lostPackets;
  /** @type {number} */
  delaySumNs;
  /** @type {number} */
  jitterSumNs;
  /** @type {number} */
  timeFirstTxNs;
  /** @type {number} */
  timeLastRxNs;
  /** @type {number} */
  durationNs;

  /**
   * @param {object} init
   * @param {number} init.flowId
   * @param {string} init.srcAddr
   * @param {string} init.dstAddr
   * @param {number} init.protocol
   * @param {number} init.txBytes
   * @param {number} init.rxBytes
   * @param {number} init.txPackets
   * @param {number} init.rxPackets
   * @param {number} init.lostPackets
   * @param {number} init.delaySumNs
   * @param {number} init.jitterSumNs
   * @param {number} init.timeFirstTxNs
   * @param {number} init.timeLastRxNs
   * @param {number} init.durationNs
   */
  constructor(init) {
    this.flowId = init.flowId;
    this.srcAddr = init.srcAddr;
    this.dstAddr = init.dstAddr;
    this.protocol = init.protocol;
    this.txBytes = init.txBytes;
    this.rxBytes = init.rxBytes;
    this.txPackets = init.txPackets;
    this.rxPackets = init.rxPackets;
    this.lostPackets = init.lostPackets;
    this.delaySumNs = init.delaySumNs;
    this.jitterSumNs = init.jitterSumNs;
    this.timeFirstTxNs = init.timeFirstTxNs;
    this.timeLastRxNs = init.timeLastRxNs;
    this.durationNs = init.durationNs;
  }

  /** @returns {number} Throughput in Mbps over the flow's observed span. */
  get throughputMbps() {
    if (this.durationNs > 0) {
      return ((this.rxBytes * 8) / (this.durationNs / 1e9)) / 1e6;
    }
    return 0;
  }

  /** @returns {number} Mean one-way delay in milliseconds. */
  get avgDelayMs() {
    if (this.rxPackets > 0) {
      return this.delaySumNs / this.rxPackets / 1e6;
    }
    return 0;
  }

  /** @returns {number} Mean inter-packet jitter in milliseconds. */
  get avgJitterMs() {
    if (this.rxPackets > 1) {
      return this.jitterSumNs / (this.rxPackets - 1) / 1e6;
    }
    return 0;
  }

  /** @returns {number} Lost-packet ratio as a percentage. */
  get lossRate() {
    if (this.txPackets > 0) {
      return (this.lostPackets / this.txPackets) * 100;
    }
    return 0;
  }
}

/** Metrics of one simulation run, aggregating its forward data flows. */
export class ScenarioResult {
  /** @type {string} */
  scenario;
  /** @type {string} */
  protocol;
  /** @type {number | null} */
  seed;
  /** @type {string} */
  sourcePath;
  /** @type {FlowData[]} */
  flows;

  /**
   * @param {object} init
   * @param {string} init.scenario
   * @param {string} init.protocol
   * @param {number | null} [init.seed] - RngRun the artifact came from.
   * @param {string} [init.sourcePath] - Path of the `.flowmonitor` file.
   * @param {FlowData[]} [init.flows]
   */
  constructor(init) {
    this.scenario = init.scenario;
    this.protocol = init.protocol;
    this.seed = init.seed ?? null;
    this.sourcePath = init.sourcePath ?? "";
    this.flows = init.flows ?? [];
  }

  /**
   * Forward data flows only (`10.1.x.x -> 10.2.x.x`, the subnets assigned in
   * `sim.cc`). Reverse ACK flows are also protocol 6; including them inflates
   * throughput and deflates average delay.
   *
   * @returns {FlowData[]}
   */
  get forwardFlows() {
    return this.flows.filter(
      (flow) =>
        flow.protocol === 6 &&
        flow.srcAddr.startsWith("10.1.") &&
        flow.dstAddr.startsWith("10.2."),
    );
  }

  /** @returns {number} Aggregate forward goodput over the shared observation span. */
  get totalThroughputMbps() {
    const forward = this.forwardFlows;
    if (forward.length === 0) return 0;
    const firstTx = Math.min(...forward.map((flow) => flow.timeFirstTxNs));
    const lastRx = Math.max(...forward.map((flow) => flow.timeLastRxNs));
    const durationNs = lastRx - firstTx;
    if (durationNs <= 0) return 0;
    return (sum(forward.map((flow) => flow.rxBytes)) * 8) / (durationNs / 1e9) / 1e6;
  }

  /** @returns {number} Mean forward one-way delay in milliseconds. */
  get avgDelayMs() {
    const receiving = this.forwardFlows.filter((flow) => flow.rxPackets > 0);
    return receiving.length > 0
      ? mean(receiving.map((flow) => flow.avgDelayMs))
      : 0;
  }

  /** @returns {number} Mean forward inter-packet jitter in milliseconds. */
  get avgJitterMs() {
    const receiving = this.forwardFlows.filter((flow) => flow.rxPackets > 1);
    return receiving.length > 0
      ? mean(receiving.map((flow) => flow.avgJitterMs))
      : 0;
  }

  /** @returns {number} Forward packet-loss ratio as a percentage. */
  get totalLossRate() {
    const forward = this.forwardFlows;
    const txPackets = sum(forward.map((flow) => flow.txPackets));
    const lostPackets = sum(forward.map((flow) => flow.lostPackets));
    return txPackets > 0 ? (lostPackets / txPackets) * 100 : 0;
  }

  /** @returns {number} Jain fairness index over the forward flow throughputs. */
  get jainFairness() {
    const throughputs = this.forwardFlows.map((flow) => flow.throughputMbps);
    const denominator =
      throughputs.length * sum(throughputs.map((value) => value * value));
    if (throughputs.length === 0 || denominator === 0) return 0;
    return sum(throughputs) ** 2 / denominator;
  }
}

/**
 * Metrics of one `(scenario, protocol)` pair averaged across seed repetitions.
 *
 * Field names mirror the `ScenarioResult` accessors consumed by the plotting
 * and table functions, so both types are interchangeable there.
 */
export class AggregatedResult {
  /** @type {string} */
  scenario;
  /** @type {string} */
  protocol;
  /** @type {number} */
  totalThroughputMbps;
  /** @type {number} */
  avgDelayMs;
  /** @type {number} */
  avgJitterMs;
  /** @type {number} */
  totalLossRate;
  /** @type {number} */
  seedCount;

  /**
   * @param {object} init
   * @param {string} init.scenario
   * @param {string} init.protocol
   * @param {number} init.totalThroughputMbps
   * @param {number} init.avgDelayMs
   * @param {number} init.avgJitterMs
   * @param {number} init.totalLossRate
   * @param {number} init.seedCount
   */
  constructor(init) {
    this.scenario = init.scenario;
    this.protocol = init.protocol;
    this.totalThroughputMbps = init.totalThroughputMbps;
    this.avgDelayMs = init.avgDelayMs;
    this.avgJitterMs = init.avgJitterMs;
    this.totalLossRate = init.totalLossRate;
    this.seedCount = init.seedCount;
  }
}

/**
 * Attributes of a parsed FlowMonitor element. `fast-xml-parser` keeps every
 * attribute as a string, so values are converted at the point of use.
 *
 * @typedef {Record<string, string | object | undefined>} XmlAttributes
 */

/**
 * Parser configuration mirroring `ElementTree` semantics: attributes keep their
 * string form, and repeated `Flow` elements always arrive as arrays.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "Flow",
});

/**
 * Parse an ns-3 time attribute such as `+190687664469ns` into nanoseconds.
 *
 * Mirrors the Python helpers: a missing or unparsable value yields `0`.
 *
 * @param {string | undefined} text
 * @returns {number}
 */
function parseNsTime(text) {
  if (!text) return 0;
  const cleaned = text.replace(/^\+/, "").replace(/\+$/, "").replace(/ns/g, "");
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Read an attribute as an integer, like `int(element.get(name, 0))`.
 *
 * @param {XmlAttributes} attributes
 * @param {string} name
 * @returns {number}
 */
function intAttribute(attributes, name) {
  const raw = attributes[name];
  const value = Number.parseInt(String(raw ?? "0"), 10);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Read an attribute as a string, like `element.get(name) or ""`.
 *
 * @param {XmlAttributes} attributes
 * @param {string} name
 * @returns {string}
 */
function stringAttribute(attributes, name) {
  const raw = attributes[name];
  return typeof raw === "string" ? raw : "";
}

/**
 * Access a nested XML element without asserting its presence.
 *
 * @param {unknown} parent
 * @param {string} key
 * @returns {unknown}
 */
function child(parent, key) {
  if (parent === null || typeof parent !== "object") return undefined;
  return /** @type {Record<string, unknown>} */ (parent)[key];
}

/**
 * Coerce a value known to be an attribute bag.
 *
 * @param {unknown} value
 * @returns {XmlAttributes}
 */
function asAttributes(value) {
  return value !== null && typeof value === "object"
    ? /** @type {XmlAttributes} */ (value)
    : {};
}

/**
 * Coerce a value known to be an element list.
 *
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

/**
 * Parse a FlowMonitor XML document into per-flow metrics.
 *
 * @param {string} filepath
 * @returns {FlowData[]}
 */
export function parseFlowMonitor(filepath) {
  const document = xmlParser.parse(readFileSync(filepath, "utf8"));
  const monitor = asAttributes(child(document, "FlowMonitor"));

  /** @type {Map<number, { srcAddr: string, dstAddr: string, protocol: number }>} */
  const flowInfo = new Map();
  const classifier = child(monitor, "Ipv4FlowClassifier");
  for (const element of asArray(child(classifier, "Flow"))) {
    const attributes = asAttributes(element);
    flowInfo.set(intAttribute(attributes, "flowId"), {
      srcAddr: stringAttribute(attributes, "sourceAddress"),
      dstAddr: stringAttribute(attributes, "destinationAddress"),
      protocol: intAttribute(attributes, "protocol"),
    });
  }

  const stats = child(monitor, "FlowStats");
  /** @type {FlowData[]} */
  const flows = [];
  for (const element of asArray(child(stats, "Flow"))) {
    const attributes = asAttributes(element);
    const flowId = intAttribute(attributes, "flowId");
    const info = flowInfo.get(flowId) ?? {
      srcAddr: "",
      dstAddr: "",
      protocol: 0,
    };
    const firstTx = parseNsTime(
      stringAttribute(attributes, "timeFirstTxPacket") || "0ns",
    );
    const lastRx = parseNsTime(
      stringAttribute(attributes, "timeLastRxPacket") || "0ns",
    );

    flows.push(
      new FlowData({
        flowId,
        srcAddr: info.srcAddr,
        dstAddr: info.dstAddr,
        protocol: info.protocol,
        txBytes: intAttribute(attributes, "txBytes"),
        rxBytes: intAttribute(attributes, "rxBytes"),
        txPackets: intAttribute(attributes, "txPackets"),
        rxPackets: intAttribute(attributes, "rxPackets"),
        lostPackets: intAttribute(attributes, "lostPackets"),
        delaySumNs: parseNsTime(stringAttribute(attributes, "delaySum") || "0ns"),
        jitterSumNs: parseNsTime(
          stringAttribute(attributes, "jitterSum") || "0ns",
        ),
        timeFirstTxNs: firstTx,
        timeLastRxNs: lastRx,
        durationNs: lastRx > firstTx ? lastRx - firstTx : 0,
      }),
    );
  }
  return flows;
}

/**
 * Parse a classification attribute as a string, like `element.get(name)`.
 *
 * @param {XmlAttributes} attributes
 * @param {string} name
 * @returns {string}
 */
function optionalAttribute(attributes, name) {
  const raw = attributes[name];
  return typeof raw === "string" ? raw : "";
}

/**
 * Forward-path KPIs of one FlowMonitor artifact.
 *
 * Only forward TCP data flows (protocol 6, `10.1.x -> 10.2.x`) contribute; the
 * returned `ports` field lists the sink ports seen on every TCP classifier
 * entry, which documents the traffic pattern the artifact was produced with.
 *
 * @param {string} filepath
 * @returns {{
 *   nflow: number,
 *   ports: string,
 *   goodput: number,
 *   delay: number,
 *   jitter: number,
 *   loss: number,
 *   jain: number,
 * }}
 */
export function forwardKpi(filepath) {
  const document = xmlParser.parse(readFileSync(filepath, "utf8"));
  const monitor = asAttributes(child(document, "FlowMonitor"));

  /** @type {Set<number>} */
  const forwardIds = new Set();
  /** @type {Set<string>} */
  const ports = new Set();
  const classifier = child(monitor, "Ipv4FlowClassifier");
  for (const element of asArray(child(classifier, "Flow"))) {
    const attributes = asAttributes(element);
    if (intAttribute(attributes, "protocol") !== 6) continue;
    const destinationPort = optionalAttribute(attributes, "destinationPort");
    if (destinationPort) ports.add(destinationPort);
    if (
      optionalAttribute(attributes, "sourceAddress").startsWith("10.1.") &&
      optionalAttribute(attributes, "destinationAddress").startsWith("10.2.")
    ) {
      forwardIds.add(intAttribute(attributes, "flowId"));
    }
  }

  /** @type {number[]} */
  const goodputs = [];
  /** @type {number[]} */
  const delays = [];
  /** @type {number[]} */
  const jitters = [];
  /** @type {number[]} */
  const firstTxTimes = [];
  /** @type {number[]} */
  const lastRxTimes = [];
  let totalRxBytes = 0;
  let txPackets = 0;
  let lostPackets = 0;

  const stats = child(monitor, "FlowStats");
  for (const element of asArray(child(stats, "Flow"))) {
    const attributes = asAttributes(element);
    if (!forwardIds.has(intAttribute(attributes, "flowId"))) continue;
    const rxPackets = intAttribute(attributes, "rxPackets");
    const rxBytes = intAttribute(attributes, "rxBytes");
    const firstTx = parseNsTime(stringAttribute(attributes, "timeFirstTxPacket"));
    const lastRx = parseNsTime(stringAttribute(attributes, "timeLastRxPacket"));
    const durationS = (lastRx - firstTx) / 1e9;
    goodputs.push(durationS > 0 ? (rxBytes * 8) / durationS / 1e6 : 0);
    firstTxTimes.push(firstTx);
    lastRxTimes.push(lastRx);
    totalRxBytes += rxBytes;
    if (rxPackets > 0) {
      delays.push(parseNsTime(stringAttribute(attributes, "delaySum")) / rxPackets / 1e6);
    }
    if (rxPackets > 1) {
      jitters.push(
        parseNsTime(stringAttribute(attributes, "jitterSum")) /
          (rxPackets - 1) /
          1e6,
      );
    }
    txPackets += intAttribute(attributes, "txPackets");
    lostPackets += intAttribute(attributes, "lostPackets");
  }

  const nflow = goodputs.length;
  const individualTotal = sum(goodputs);
  const squares = sum(goodputs.map((value) => value * value));
  const jain =
    nflow > 0 && squares > 0
      ? (individualTotal * individualTotal) / (nflow * squares)
      : 0;
  const sharedDurationNs =
    nflow > 0 ? Math.max(...lastRxTimes) - Math.min(...firstTxTimes) : 0;
  const aggregateGoodput =
    sharedDurationNs > 0
      ? (totalRxBytes * 8) / (sharedDurationNs / 1e9) / 1e6
      : 0;

  return {
    nflow,
    ports: [...ports].sort().join("/"),
    goodput: aggregateGoodput,
    delay: delays.length > 0 ? mean(delays) : 0,
    jitter: jitters.length > 0 ? mean(jitters) : 0,
    loss: txPackets > 0 ? (100 * lostPackets) / txPackets : 0,
    jain,
  };
}

/**
 * List `.flowmonitor` artifacts under a directory.
 *
 * @param {string} directory
 * @param {{ recursive?: boolean }} [options]
 * @returns {string[]} Absolute or relative paths, sorted lexicographically.
 */
export function listFlowMonitorFiles(directory, options = {}) {
  const recursive = options.recursive === true;
  /** @type {string[]} */
  const found = [];
  /** @param {string} current */
  const walk = (current) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) walk(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".flowmonitor")) found.push(full);
    }
  };
  walk(directory);
  found.sort();
  return found;
}

/**
 * Parse every artifact under a log directory into per-run results.
 *
 * @param {string} logsDir
 * @returns {ScenarioResult[]}
 */
export function loadAllResults(logsDir) {
  /** @type {ScenarioResult[]} */
  const results = [];
  for (const filepath of listFlowMonitorFiles(logsDir, { recursive: true })) {
    const basename = path.basename(filepath, ".flowmonitor");
    const parsed = parseRunName(basename);
    if (!parsed) continue;
    results.push(
      new ScenarioResult({
        scenario: parsed.scenario,
        protocol: parsed.protocol,
        seed: parsed.seed,
        sourcePath: filepath,
        flows: parseFlowMonitor(filepath),
      }),
    );
  }
  return results;
}

/**
 * Average each `(scenario, protocol)` pair across its seed repetitions.
 *
 * @param {ScenarioResult[]} results
 * @returns {AggregatedResult[]} Sorted by scenario, then protocol.
 */
export function aggregateResults(results) {
  /** @type {Map<string, ScenarioResult[]>} */
  const grouped = new Map();
  for (const result of results) {
    const key = `${result.scenario}\u0000${result.protocol}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(result);
    else grouped.set(key, [result]);
  }

  /** @type {AggregatedResult[]} */
  const aggregated = [];
  for (const key of [...grouped.keys()].sort()) {
    const runs = grouped.get(key) ?? [];
    const [scenario, protocol] = key.split("\u0000");
    aggregated.push(
      new AggregatedResult({
        scenario,
        protocol,
        totalThroughputMbps: mean(
          runs.map((run) => run.totalThroughputMbps),
        ),
        avgDelayMs: mean(runs.map((run) => run.avgDelayMs)),
        avgJitterMs: mean(runs.map((run) => run.avgJitterMs)),
        totalLossRate: mean(runs.map((run) => run.totalLossRate)),
        seedCount: runs.length,
      }),
    );
  }
  return aggregated;
}

/**
 * `true` when the path exists and is a regular file.
 *
 * @param {string} filepath
 * @returns {boolean}
 */
export function isFile(filepath) {
  try {
    return statSync(filepath).isFile();
  } catch {
    return false;
  }
}

/**
 * `true` when the path exists and is a directory.
 *
 * @param {string} filepath
 * @returns {boolean}
 */
export function isDirectory(filepath) {
  try {
    return statSync(filepath).isDirectory();
  } catch {
    return false;
  }
}
