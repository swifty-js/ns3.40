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
 * NS-3 Swift TCP Simulation Management Tool.
 *
 * Features: simulation (sim) / plotting (draw) / summary report (summary).
 *
 * JavaScript port of the former `main.py`. The command-line interface, the
 * artifact layout under `logs/`, and the generated reports are unchanged.
 */

import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { ArgumentParser, optionInt, optionList, optionString } from "./lib/cli.js";
import { buildCsv } from "./lib/csv.js";
import {
  ScenarioResult,
  aggregateResults,
  isDirectory,
  isFile,
  listFlowMonitorFiles,
  loadAllResults,
  parseFlowMonitor,
  parseRunName,
} from "./lib/flowmonitor.js";
import { pyJsonDumps, isoformatUtc } from "./lib/json.js";
import { osPathJoin } from "./lib/paths.js";
import { FigureRenderer } from "./lib/plotly.js";
import {
  DEFAULT_DURATION,
  DEFAULT_N_LEAF,
  DEFAULT_PROTOCOLS,
  DEFAULT_SIM_SEED,
  FLOW_COLORS,
  PROTOCOL_COLORS_BAR,
  PROTOCOL_COLORS_MAP,
  PROTOCOL_ORDER,
  REAL_LOG_ROOT,
  SCENARIOS,
} from "./lib/scenarios.js";
import { mean, metricSummary } from "./lib/stats.js";
import { GRID_COLOR, axisStyle, baseLayout, inches } from "./lib/theme.js";

/** @import { AggregatedResult } from "./lib/flowmonitor.js" */
/** @import { FigureRenderer as Renderer } from "./lib/plotly.js" */
/** @import { Data, Layout } from "plotly.js-dist-min" */

/** @typedef {Record<string, string | number | boolean | string[] | undefined>} CliOptions */

/** A single plotly annotation, as produced by the figure builders. */
/** @typedef {NonNullable<Layout["annotations"]>[number]} Annotation */

// =============================================================================
// Simulation Runner (sim)
// =============================================================================

/**
 * Run `./ns3 run <command>` with stdout and stderr merged into a log file.
 *
 * @param {string} ns3Command - The `--flag=value` command string.
 * @param {string} logFile - Destination log path.
 * @param {string} label - `<scenario>_<protocol>`, used in error messages.
 * @returns {Promise<number>} Exit code, or `-1` when the process cannot start.
 */
function runNs3ToFile(ns3Command, logFile, label) {
  return new Promise((resolve) => {
    const stream = createWriteStream(logFile);
    // Record the invocation first; main.py writes the same header so a failed
    // run can be reproduced from its log alone.
    stream.write(`Command: ./ns3 run ${ns3Command}\n`);
    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = spawn("./ns3", ["run", ns3Command], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      stream.end();
      console.log(
        `[ERROR] Exception in ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      resolve(-1);
      return;
    }
    child.stdout?.pipe(stream);
    child.stderr?.pipe(stream);
    child.on("error", (error) => {
      stream.end();
      console.log(`[ERROR] Exception in ${label}: ${error.message}`);
      resolve(-1);
    });
    child.on("close", (code) => {
      stream.end(() => resolve(code ?? -1));
    });
  });
}

/**
 * Run a single simulation scenario.
 *
 * @param {object} options
 * @param {string} options.protocol
 * @param {string} options.scenario
 * @param {string} options.accessBandwidth
 * @param {string} options.bottleneckBandwidth
 * @param {string} options.accessDelay
 * @param {string} options.bottleneckDelay
 * @param {string} options.logDir
 * @param {number} [options.duration]
 * @param {number} [options.nLeaf]
 * @param {number} [options.simSeed]
 * @param {number} [options.enableUdpBurst]
 * @returns {Promise<boolean>} `true` on success, including the skip case.
 */
export async function runSim(options) {
  const {
    protocol,
    scenario,
    accessBandwidth,
    bottleneckBandwidth,
    accessDelay,
    bottleneckDelay,
    logDir,
    duration = DEFAULT_DURATION,
    nLeaf = DEFAULT_N_LEAF,
    simSeed = DEFAULT_SIM_SEED,
    enableUdpBurst = 0,
  } = options;

  await mkdir(logDir, { recursive: true });
  const prefix = path.join(logDir, `${scenario}_${protocol}_s${simSeed}`);
  const flowMonitorFile = `${prefix}.flowmonitor`;

  if (isFile(flowMonitorFile)) {
    console.log(
      `[SKIP] ${scenario}_${protocol}_s${simSeed} - flowmonitor already exists`,
    );
    return true;
  }

  console.log(
    `[INFO] Running: Protocol=${protocol}, Scenario=${scenario}, Seed=${simSeed}`,
  );
  console.log(
    `[INFO]   Access: ${accessBandwidth} @ ${accessDelay}, ` +
      `Bottleneck: ${bottleneckBandwidth} @ ${bottleneckDelay}`,
  );

  const ns3Command =
    "swift-tcp" +
    ` --transport_prot=${protocol}` +
    ` --access_bandwidth=${accessBandwidth}` +
    ` --bottleneck_bandwidth=${bottleneckBandwidth}` +
    ` --access_delay=${accessDelay}` +
    ` --bottleneck_delay=${bottleneckDelay}` +
    ` --duration=${duration}` +
    ` --nLeaf=${nLeaf}` +
    ` --simSeed=${simSeed}` +
    ` --enable_udp_burst=${enableUdpBurst}` +
    " --queue_disc_type=ns3::RedQueueDisc" +
    ` --prefix_name=${prefix}`;

  const ns3Log = `${prefix}_ns3.log`;
  const startTime = Date.now();
  const exitCode = await runNs3ToFile(
    ns3Command,
    ns3Log,
    `${scenario}_${protocol}`,
  );
  if (exitCode !== 0) {
    console.log(`[ERROR] Simulation failed: ${scenario}_${protocol}`);
    return false;
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[INFO] Completed: ${scenario} with ${protocol} in ${elapsed}s`);
  return true;
}

/**
 * Execute simulations using the native C++ TcpSwift implementation.
 *
 * @param {CliOptions} args
 * @returns {Promise<void>}
 */
export async function cmdSim(args) {
  const useUdp = args["--udp"] === true;
  const enableUdp = useUdp ? 1 : 0;
  const logDir = path.join(
    REAL_LOG_ROOT,
    useUdp ? "comparison-udp" : "comparison",
  );
  const requestedProtocols = optionList(args, "--protocols");
  const protocols =
    requestedProtocols.length > 0 ? requestedProtocols : DEFAULT_PROTOCOLS;

  let scenarios = SCENARIOS;
  const requestedScenarios = optionList(args, "--scenario");
  if (requestedScenarios.length > 0) {
    const wanted = new Set(requestedScenarios);
    scenarios = SCENARIOS.filter(([name]) => wanted.has(name));
    if (scenarios.length === 0) {
      console.log(`[ERROR] No matching scenarios: ${requestedScenarios.join(" ")}`);
      process.exitCode = 1;
      return;
    }
  }

  const numSeeds = optionInt(args, "--num-seeds") ?? 1;
  const baseSeed = optionInt(args, "--sim-seed") ?? DEFAULT_SIM_SEED;
  const duration = optionInt(args, "--duration") ?? DEFAULT_DURATION;
  const nLeaf = optionInt(args, "--n-leaf") ?? DEFAULT_N_LEAF;

  const total = scenarios.length * protocols.length * numSeeds;
  let done = 0;
  let failed = 0;
  const seeds = Array.from({ length: numSeeds }, (_, index) => baseSeed + index);

  for (const [
    scenarioName,
    accessBandwidth,
    bottleneckBandwidth,
    accessDelay,
    bottleneckDelay,
  ] of scenarios) {
    for (const protocol of protocols) {
      for (const seed of seeds) {
        const ok = await runSim({
          protocol,
          scenario: scenarioName,
          accessBandwidth,
          bottleneckBandwidth,
          accessDelay,
          bottleneckDelay,
          logDir,
          duration,
          nLeaf,
          simSeed: seed,
          enableUdpBurst: enableUdp,
        });
        done += 1;
        if (!ok) failed += 1;
        console.log(`[PROGRESS] ${done}/${total} (failed: ${failed})`);
      }
    }
  }

  console.log(`\n[DONE] ${done - failed}/${total} succeeded, ${failed} failed`);
}

// =============================================================================
// Summary Report (summary)
// =============================================================================

/**
 * Parse a data rate such as `25Gbps` into Mbps.
 *
 * @param {string} value
 * @returns {number}
 * @throws {Error} When the value does not match `<number><K|M|G>bps`.
 */
export function rateToMbps(value) {
  const match = /^([\d.]+)([KMG])bps$/.exec(value);
  if (!match) throw new Error(`Unsupported data rate: ${value}`);
  const scale = { K: 1e-3, M: 1, G: 1e3 }[match[2]];
  return Number.parseFloat(match[1]) * (scale ?? 1);
}

/**
 * Parse a delay such as `2us` into milliseconds.
 *
 * @param {string} value
 * @returns {number}
 * @throws {Error} When the value does not match `<number><ns|us|ms|s>`.
 */
export function timeToMs(value) {
  const match = /^([\d.]+)(ns|us|ms|s)$/.exec(value);
  if (!match) throw new Error(`Unsupported time: ${value}`);
  const scale = { ns: 1e-6, us: 1e-3, ms: 1, s: 1e3 }[match[2]];
  return Number.parseFloat(match[1]) * (scale ?? 1);
}

/**
 * One anomaly record: source, scenario, protocol, reason, affected metrics.
 *
 * @typedef {readonly [string, string, string, string, string]} Anomaly
 */

/**
 * Append newly observed anomalies to `logs/error.txt`.
 *
 * Entries whose signature already appears in the file are skipped, so repeated
 * validation runs do not duplicate the same finding.
 *
 * @param {ReadonlyArray<Anomaly>} entries
 * @returns {Promise<void>}
 */
export async function appendAnomalies(entries) {
  if (entries.length === 0) return;
  const errorPath = path.join("logs", "error.txt");
  let existing = "";
  try {
    existing = await readFile(errorPath, "utf8");
  } catch {
    existing = "";
  }
  const timestamp = isoformatUtc().replace("+00:00", "Z");
  /** @type {string[]} */
  const appended = [];
  for (const [source, scenario, protocol, reason, metrics] of entries) {
    const signature = ` | ${source} | ${scenario} | ${protocol} | ${reason} | ${metrics}`;
    if (existing.includes(signature)) continue;
    appended.push(`${timestamp}${signature}`);
    // Accumulate so two identical entries within one call collapse too.
    existing += signature;
  }
  if (appended.length === 0) return;
  await mkdir(path.dirname(errorPath), { recursive: true });
  await appendFile(errorPath, `${appended.join("\n")}\n`, "utf8");
}

/**
 * Run a short informational command and return its trimmed stdout.
 *
 * @param {string} command
 * @param {string[]} args
 * @returns {string | null} `null` when the command is unavailable or fails.
 */
function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return null;
  const output = result.stdout.trim();
  return output.length > 0 ? output : null;
}

/**
 * Port of CPython's `platform._platform()` string builder.
 *
 * Empty components are dropped, spaces become underscores, slashes become
 * dashes, and runs of dashes are folded.
 *
 * @param {ReadonlyArray<string>} parts
 * @returns {string}
 */
function platformJoin(parts) {
  return parts
    .filter((part) => part.length > 0)
    .join("-")
    .replace(/ /g, "_")
    .replace(/\//g, "-")
    .replace(/unknown/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/-+$/, "");
}

/**
 * Describe the host the way Python's `platform.platform()` does.
 *
 * macOS is reproduced exactly: CPython substitutes the product version from
 * `mac_ver()` for the kernel release and appends the machine, processor, and
 * executable format reported by `platform.architecture()`. Other platforms fall
 * back to the shorter `system-release-machine` form, since their Python output
 * also splices in libc or service-pack details this helper does not probe.
 *
 * @returns {string} e.g. `macOS-26.3.2-arm64-arm-64bit-Mach-O`.
 */
function platformDescription() {
  if (os.platform() === "darwin") {
    return platformJoin([
      "macOS",
      commandOutput("sw_vers", ["-productVersion"]) ?? os.release(),
      os.arch(),
      commandOutput("uname", ["-p"]) ?? "",
      "64bit",
      "Mach-O",
    ]);
  }
  /** @type {Record<string, string>} */
  const displayNames = { linux: "Linux", win32: "Windows" };
  const platformName = displayNames[os.platform()] ?? os.platform();
  return platformJoin([platformName, os.release(), os.arch()]);
}

/**
 * Read the current git revision, or `unknown` outside a repository.
 *
 * @returns {string}
 */
function gitRevision() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error || result.status !== 0) return "unknown";
  return result.stdout.trim();
}

/**
 * `true` when the working tree has uncommitted changes.
 *
 * @returns {boolean}
 */
function workingTreeDirty() {
  // stderr is captured (not inherited) to match Python's `capture_output=True`,
  // so running outside a repository only reports the failure once.
  const result = spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return false;
  return result.stdout.trim().length > 0;
}

/**
 * Validate the native FlowMonitor runs and write the clean KPI tables.
 *
 * Every `(setting, scenario, protocol, seed)` combination expected by the
 * scenario catalogue is checked: missing files, malformed XML, and measurements
 * that violate the configured link budget are recorded as anomalies and
 * excluded. A `(setting, scenario, seed)` group is dropped entirely when any of
 * its four protocols fails, keeping the comparison tables balanced.
 *
 * @param {number} baseSeed - First RngRun expected on disk.
 * @param {number} numSeeds - Number of consecutive RngRun repetitions.
 * @returns {Promise<void>}
 */
export async function buildRealKpi(baseSeed, numSeeds) {
  /** @type {ReadonlyArray<readonly [string, string]>} */
  const settings = [
    ["tcp_only", osPathJoin(REAL_LOG_ROOT, "comparison")],
    ["udp_burst", osPathJoin(REAL_LOG_ROOT, "comparison-udp")],
  ];

  /** @type {Map<string, { access: string, bottleneck: string, baseOwdMs: number }>} */
  const scenarioConfig = new Map(
    SCENARIOS.map(([name, access, bottleneck, accessDelay, bottleneckDelay]) => [
      name,
      {
        access,
        bottleneck,
        baseOwdMs: 2 * timeToMs(accessDelay) + timeToMs(bottleneckDelay),
      },
    ]),
  );

  const seeds = Array.from({ length: numSeeds }, (_, index) => baseSeed + index);

  /** @type {Map<string, ScenarioResult>} */
  const valid = new Map();
  /** @type {Anomaly[]} */
  const anomalies = [
    [
      "logs/manifest.json",
      "all scenarios",
      "all protocols",
      "historical docs/mock.py generated deterministic fixtures with preset " +
        "performance bounds; legacy results are not native ns-3 output",
      "throughput, delay, jitter, loss, Jain fairness",
    ],
  ];

  for (const [setting, directory] of settings) {
    for (const scenario of scenarioConfig.keys()) {
      for (const protocol of DEFAULT_PROTOCOLS) {
        for (const seed of seeds) {
          const filename = `${scenario}_${protocol}_s${seed}.flowmonitor`;
          const filepath = osPathJoin(directory, filename);
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

          /** @type {string[]} */
          const reasons = [];
          const config = scenarioConfig.get(scenario);
          if (!config) continue;
          const throughput = result.totalThroughputMbps;
          const delay = result.avgDelayMs;
          const loss = result.totalLossRate;
          const fairness = result.jainFairness;

          if (result.forwardFlows.length !== DEFAULT_N_LEAF) {
            reasons.push(
              `expected ${DEFAULT_N_LEAF} forward TCP flows, found ` +
                `${result.forwardFlows.length}`,
            );
          }
          if (!Number.isFinite(throughput) || throughput <= 0) {
            reasons.push("throughput is non-positive or non-finite");
          } else if (throughput > rateToMbps(config.bottleneck) * 1.001) {
            reasons.push("throughput exceeds configured bottleneck");
          }
          if (!Number.isFinite(delay) || delay <= 0) {
            reasons.push("delay is non-positive or non-finite");
          } else if (delay < config.baseOwdMs * 0.999) {
            reasons.push("delay is below configured propagation bound");
          }
          if (!Number.isFinite(loss) || loss < 0 || loss > 100) {
            reasons.push("loss rate is outside [0, 100]");
          }
          if (!Number.isFinite(fairness) || fairness < 0 || fairness > 1) {
            reasons.push("Jain fairness is outside [0, 1]");
          }

          if (reasons.length > 0) {
            anomalies.push([
              relativePath,
              scenario,
              protocol,
              reasons.join("; "),
              "all metrics",
            ]);
            continue;
          }
          valid.set(`${setting}\u0000${scenario}\u0000${protocol}\u0000${seed}`, result);
        }
      }
    }
  }

  // Drop whole (setting, scenario, seed) groups whose protocol set is
  // incomplete, then drop the matching groups in the other setting so the two
  // settings stay comparable.
  /** @type {Set<string>} */
  const excludedGroups = new Set();
  for (const [setting] of settings) {
    for (const scenario of scenarioConfig.keys()) {
      for (const seed of seeds) {
        const missing = DEFAULT_PROTOCOLS.filter(
          (protocol) =>
            !valid.has(`${setting}\u0000${scenario}\u0000${protocol}\u0000${seed}`),
        );
        if (missing.length === 0) continue;
        excludedGroups.add(`${setting}\u0000${scenario}\u0000${seed}`);
        anomalies.push([
          settings.find(([name]) => name === setting)?.[1] ?? setting,
          scenario,
          missing.join(","),
          `incomplete protocol group for ${setting}, RngRun=${seed}`,
          "all comparison metrics",
        ]);
      }
    }
  }
  for (const scenario of scenarioConfig.keys()) {
    for (const seed of seeds) {
      const anyExcluded = settings.some(([setting]) =>
        excludedGroups.has(`${setting}\u0000${scenario}\u0000${seed}`),
      );
      if (!anyExcluded) continue;
      for (const [setting] of settings) {
        excludedGroups.add(`${setting}\u0000${scenario}\u0000${seed}`);
      }
    }
  }

  // Sort by (setting, scenario, protocol, seed), matching `sorted(valid.items())`.
  const cleanEntries = [...valid.entries()]
    .sort(([keyA], [keyB]) => {
      const a = keyA.split("\u0000");
      const b = keyB.split("\u0000");
      for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
      }
      return Number(a[3]) - Number(b[3]);
    })
    .filter(([key]) => {
      const [setting, scenario, , seed] = key.split("\u0000");
      return !excludedGroups.has(`${setting}\u0000${scenario}\u0000${seed}`);
    });

  const summaryDir = osPathJoin(REAL_LOG_ROOT, "summary");
  await mkdir(summaryDir, { recursive: true });

  const rawPath = osPathJoin(summaryDir, "kpi_forward.csv");
  const rawFields = [
    "Setting",
    "Scenario",
    "Protocol",
    "Seed",
    "AccessBW",
    "BottleneckBW",
    "Flows",
    "Goodput_Mbps",
    "Util",
    "Delay_ms",
    "Jitter_ms",
    "Loss_pct",
    "Jain",
    "Source",
  ];
  const rawRows = cleanEntries.map(([key, result]) => {
    const [setting] = key.split("\u0000");
    const config = scenarioConfig.get(result.scenario);
    const bottleneck = rateToMbps(config?.bottleneck ?? "1Mbps");
    return {
      Setting: setting,
      Scenario: result.scenario,
      Protocol: result.protocol,
      Seed: result.seed ?? "",
      AccessBW: config?.access ?? "",
      BottleneckBW: config?.bottleneck ?? "",
      Flows: result.forwardFlows.length,
      Goodput_Mbps: result.totalThroughputMbps.toFixed(6),
      Util: (result.totalThroughputMbps / bottleneck).toFixed(6),
      Delay_ms: result.avgDelayMs.toFixed(6),
      Jitter_ms: result.avgJitterMs.toFixed(6),
      Loss_pct: result.totalLossRate.toFixed(6),
      Jain: result.jainFairness.toFixed(6),
      Source: path.relative(REAL_LOG_ROOT, result.sourcePath),
    };
  });
  await writeFile(rawPath, buildCsv(rawFields, rawRows), "utf8");

  /** @type {Map<string, ScenarioResult[]>} */
  const grouped = new Map();
  for (const [key, result] of cleanEntries) {
    const [setting] = key.split("\u0000");
    const groupKey = `${setting}\u0000${result.scenario}\u0000${result.protocol}`;
    const bucket = grouped.get(groupKey);
    if (bucket) bucket.push(result);
    else grouped.set(groupKey, [result]);
  }

  const aggregatePath = osPathJoin(summaryDir, "kpi_aggregate.csv");
  /** @type {ReadonlyArray<readonly [string, (result: ScenarioResult) => number]>} */
  const metricGetters = [
    ["Goodput_Mbps", (result) => result.totalThroughputMbps],
    ["Delay_ms", (result) => result.avgDelayMs],
    ["Jitter_ms", (result) => result.avgJitterMs],
    ["Loss_pct", (result) => result.totalLossRate],
    ["Jain", (result) => result.jainFairness],
  ];
  const aggregateFields = ["Setting", "Scenario", "Protocol", "Runs"];
  for (const [metric] of metricGetters) {
    aggregateFields.push(`${metric}_Mean`, `${metric}_Std`, `${metric}_CI95`);
  }

  const aggregateRows = [...grouped.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((groupKey) => {
      const runs = grouped.get(groupKey) ?? [];
      const [setting, scenario, protocol] = groupKey.split("\u0000");
      /** @type {Record<string, string | number>} */
      const row = {
        Setting: setting,
        Scenario: scenario,
        Protocol: protocol,
        Runs: runs.length,
      };
      for (const [metric, getter] of metricGetters) {
        const [average, deviation, interval] = metricSummary(
          runs.map((run) => getter(run)),
        );
        row[`${metric}_Mean`] = average.toFixed(6);
        row[`${metric}_Std`] = deviation.toFixed(6);
        row[`${metric}_CI95`] = interval.toFixed(6);
      }
      return row;
    });
  await writeFile(aggregatePath, buildCsv(aggregateFields, aggregateRows), "utf8");

  await appendAnomalies(anomalies);

  /** @type {Record<string, string>} */
  const hashes = {};
  for (const [, result] of cleanEntries) {
    const relativePath = path.relative(REAL_LOG_ROOT, result.sourcePath);
    const digest = createHash("sha256")
      .update(await readFile(result.sourcePath))
      .digest("hex");
    hashes[relativePath] = digest;
  }

  const manifest = {
    generated_at_utc: isoformatUtc(),
    source: "native ns-3.40 FlowMonitor output",
    git_revision: gitRevision(),
    working_tree_dirty: workingTreeDirty(),
    platform: platformDescription(),
    expected: {
      scenarios: SCENARIOS.length,
      protocols: [...DEFAULT_PROTOCOLS],
      settings: settings.map(([name]) => name),
      seeds,
      records:
        SCENARIOS.length *
        DEFAULT_PROTOCOLS.length *
        settings.length *
        seeds.length,
    },
    accepted_records: cleanEntries.length,
    anomaly_count: anomalies.length - 1,
    files: hashes,
  };
  await writeFile(
    osPathJoin(REAL_LOG_ROOT, "manifest.json"),
    `${pyJsonDumps(manifest, { indent: 2 })}\n`,
    "utf8",
  );

  console.log(`[INFO] Clean KPI saved to ${rawPath} (${cleanEntries.length} records)`);
  console.log(
    `[INFO] Aggregated KPI saved to ${aggregatePath} (${grouped.size} groups)`,
  );
  console.log(`[INFO] New native-data anomalies: ${anomalies.length - 1}`);
}

/**
 * Validate native FlowMonitor outputs and write the clean KPI tables.
 *
 * @param {CliOptions} args
 * @returns {Promise<void>}
 */
export async function cmdSummary(args) {
  const baseSeed = optionInt(args, "--sim-seed") ?? DEFAULT_SIM_SEED;
  const numSeeds = optionInt(args, "--num-seeds") ?? 3;
  await buildRealKpi(baseSeed, numSeeds);
}

// =============================================================================
// Plotting Functions
// =============================================================================

/** A plotly axis reference, e.g. `"x2"` or `"y1 domain"`. */
/** @typedef {NonNullable<Annotation["xref"]>} AxisRef */

/**
 * Reference string for an x subplot axis: `xRef("")` -> `"x"`, and
 * `xRef("2", true)` -> `"x2 domain"`.
 *
 * Plotly's typings enumerate every legal axis name as a literal union, so the
 * generated name is asserted here. The names follow plotly's `<axis><index>`
 * convention, where an empty index means the first subplot.
 *
 * @param {string} index - Subplot index suffix; `""` for the first subplot.
 * @param {boolean} [domain] - Append `" domain"` to target the axis area itself.
 * @returns {Extract<AxisRef, `x${string}`>}
 */
function xRef(index, domain = false) {
  return /** @type {Extract<AxisRef, `x${string}`>} */ (
    `x${index}${domain ? " domain" : ""}`
  );
}

/**
 * Reference string for a y subplot axis; see {@link xRef}.
 *
 * @param {string} index - Subplot index suffix; `""` for the first subplot.
 * @param {boolean} [domain] - Append `" domain"` to target the axis area itself.
 * @returns {Extract<AxisRef, `y${string}`>}
 */
function yRef(index, domain = false) {
  return /** @type {Extract<AxisRef, `y${string}`>} */ (
    `y${index}${domain ? " domain" : ""}`
  );
}

/**
 * `true` for a usable measurement; narrows `(number | null)[]` to `number[]`.
 *
 * @param {number | null} value
 * @returns {value is number}
 */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Format a list for a warning line.
 *
 * @param {ReadonlyArray<string>} items
 * @returns {string}
 */
function formatMissingList(items) {
  return items.length > 0 ? items.join(", ") : "none";
}

/**
 * Report scenarios that do not carry every expected protocol.
 *
 * @param {Map<string, Map<string, ScenarioResult | AggregatedResult>>} scenarios
 * @param {string} context
 * @returns {void}
 */
function warnMissingProtocolEntries(scenarios, context) {
  const expected = PROTOCOL_ORDER.filter((protocol) =>
    [...scenarios.values()].some((entry) => entry.has(protocol)),
  );
  /** @type {string[]} */
  const missingLines = [];
  for (const scenario of [...scenarios.keys()].sort()) {
    const present = scenarios.get(scenario);
    const missing = expected.filter((protocol) => !present?.has(protocol));
    if (missing.length > 0) {
      missingLines.push(
        `  - ${scenario}: missing protocols -> ${formatMissingList(missing)}`,
      );
    }
  }
  if (missingLines.length > 0) {
    console.log(`Warning: Missing protocol data detected in ${context}:`);
    for (const line of missingLines) console.log(line);
  }
}

/**
 * Report flow-throughput gaps across protocols and flow ids.
 *
 * @param {Map<string, Map<string, Map<number, number>>>} data
 * @param {ReadonlyArray<string>} protocols
 * @param {ReadonlyArray<number>} flows
 * @returns {void}
 */
function warnMissingFlowEntries(data, protocols, flows) {
  /** @type {string[]} */
  const missingLines = [];
  for (const scenario of [...data.keys()].sort()) {
    const byProtocol = data.get(scenario);
    for (const protocol of protocols) {
      const byFlow = byProtocol?.get(protocol);
      if (!byFlow) {
        missingLines.push(
          `  - ${scenario}/${protocol}: missing entire protocol log`,
        );
        continue;
      }
      const missingFlows = flows
        .filter((flowId) => !byFlow.has(flowId))
        .map((flowId) => String(flowId));
      if (missingFlows.length > 0) {
        missingLines.push(
          `  - ${scenario}/${protocol}: missing flows -> ` +
            formatMissingList(missingFlows),
        );
      }
    }
  }
  if (missingLines.length > 0) {
    console.log("Warning: Missing flow throughput data detected:");
    for (const line of missingLines) console.log(line);
  }
}

/**
 * Annotation marking a measurement that is absent from the dataset.
 *
 * @param {string} category - Category the gap belongs to.
 * @returns {Partial<Annotation>}
 */
function missingAnnotation(category) {
  return {
    x: category,
    y: 0,
    xref: "x",
    yref: "y",
    text: "N/A",
    showarrow: false,
    textangle: -90,
    xanchor: "center",
    yanchor: "bottom",
    font: { size: 8, color: "#555555" },
  };
}

/**
 * Write a rendered PNG next to its source data, creating the directory first.
 *
 * @param {string} outputDir
 * @param {string} filename
 * @param {Buffer | undefined} png
 * @returns {Promise<string>} Path written to.
 */
async function writePng(outputDir, filename, png) {
  await mkdir(outputDir, { recursive: true });
  const target = path.join(outputDir, filename);
  if (png) await writeFile(target, png);
  return target;
}

/**
 * Protocol comparison charts: throughput, delay, and loss side by side.
 *
 * @param {AggregatedResult[]} results
 * @param {string} outputDir
 * @param {Renderer} renderer
 * @returns {Promise<void>}
 */
export async function plotProtocolComparison(results, outputDir, renderer) {
  await mkdir(outputDir, { recursive: true });

  /** @type {Map<string, Map<string, AggregatedResult>>} */
  const scenarios = new Map();
  for (const result of results) {
    let perProtocol = scenarios.get(result.scenario);
    if (!perProtocol) {
      perProtocol = new Map();
      scenarios.set(result.scenario, perProtocol);
    }
    perProtocol.set(result.protocol, result);
  }

  /** @type {Map<string, Map<string, AggregatedResult>>} */
  const comparison = new Map();
  for (const [scenario, perProtocol] of scenarios) {
    if (perProtocol.size > 1) comparison.set(scenario, perProtocol);
  }
  if (comparison.size === 0) {
    console.log("No multi-protocol comparison data found");
    return;
  }
  warnMissingProtocolEntries(comparison, "protocol comparison");

  const scenarioNames = [...comparison.keys()];

  /** @type {ReadonlyArray<{ metric: string, ylabel: string, title: string, getter: (result: AggregatedResult) => number }>} */
  const metrics = [
    {
      metric: "throughput",
      ylabel: "Throughput (Mbps)",
      title: "Protocol Throughput Comparison",
      getter: (result) => result.totalThroughputMbps,
    },
    {
      metric: "delay",
      ylabel: "Average Delay (ms)",
      title: "Protocol Delay Comparison",
      getter: (result) => result.avgDelayMs,
    },
    {
      metric: "loss",
      ylabel: "Packet Loss Rate (%)",
      title: "Protocol Packet Loss Comparison",
      getter: (result) => result.totalLossRate,
    },
  ];

  for (const { metric, ylabel, title, getter } of metrics) {
    const width = inches(14);
    const height = inches(6);

    /** @type {Partial<Data>[]} */
    const data = PROTOCOL_ORDER.map((protocol, index) => ({
      type: "bar",
      name: protocol,
      x: scenarioNames,
      y: scenarioNames.map((scenario) => {
        const entry = comparison.get(scenario)?.get(protocol);
        return entry ? getter(entry) : null;
      }),
      marker: { color: PROTOCOL_COLORS_BAR[index] },
    }));

    /** @type {Partial<Annotation>[]} */
    const annotations = [];
    for (const protocol of PROTOCOL_ORDER) {
      for (const scenario of scenarioNames) {
        if (!comparison.get(scenario)?.has(protocol)) {
          annotations.push(missingAnnotation(scenario));
        }
      }
    }

    /** @type {Partial<Layout>} */
    const layout = {
      ...baseLayout({
        width,
        height,
        baseFontSize: 10,
        margin: { top: 50, right: 20, bottom: 160, left: 80 },
      }),
      title: { text: title, font: { size: 12 }, x: 0.5, xanchor: "center" },
      barmode: "group",
      bargap: 0.3,
      bargroupgap: 0.06,
      xaxis: {
        ...axisStyle({ grid: false, tickSize: 9 }),
        type: "category",
        tickangle: -45,
        categoryorder: "array",
        categoryarray: scenarioNames,
      },
      yaxis: { ...axisStyle({ title: ylabel }), rangemode: "tozero" },
      legend: {
        orientation: "v",
        x: 0.99,
        y: 0.99,
        xanchor: "right",
        yanchor: "top",
      },
      annotations,
    };

    const rendered = await renderer.render(
      { name: `${metric}_comparison`, width, height, data, layout },
      { png: true },
      150 / 72,
    );
    await writePng(outputDir, `${metric}_comparison.png`, rendered.png);
  }

  console.log(`Protocol comparison charts saved to: ${outputDir}`);
}

/**
 * TcpSwift scenario metrics, split into three stacked horizontal-bar pages.
 *
 * @param {AggregatedResult[]} results
 * @param {string} outputDir
 * @param {Renderer} renderer
 * @returns {Promise<void>}
 */
export async function plotSwiftScenarios(results, outputDir, renderer) {
  await mkdir(outputDir, { recursive: true });

  /** @type {Map<string, number>} */
  const scenarioOrder = new Map(SCENARIOS.map(([name], index) => [name, index]));
  const swift = results
    .filter((result) => result.protocol === "TcpSwift")
    .sort((a, b) => {
      const orderA = scenarioOrder.get(a.scenario) ?? scenarioOrder.size;
      const orderB = scenarioOrder.get(b.scenario) ?? scenarioOrder.size;
      if (orderA !== orderB) return orderA - orderB;
      return a.scenario.localeCompare(b.scenario);
    });

  if (swift.length === 0) {
    console.log("No TcpSwift data found");
    return;
  }

  const oldCombinedChart = path.join(outputDir, "swift_scenarios.png");
  if (isFile(oldCombinedChart)) await rm(oldCombinedChart);
  for (const entry of await readdir(outputDir)) {
    if (/^swift_scenarios_part\d+\.png$/.test(entry)) {
      await rm(path.join(outputDir, entry));
    }
  }

  const TARGET_PARTS = 3;
  const baseSize = Math.floor(swift.length / TARGET_PARTS);
  const remainder = swift.length % TARGET_PARTS;
  /** @type {AggregatedResult[][]} */
  const chunks = [];
  let startIndex = 0;
  for (let partIndex = 0; partIndex < TARGET_PARTS; partIndex += 1) {
    const chunkSize = baseSize + (partIndex < remainder ? 1 : 0);
    if (chunkSize <= 0) continue;
    chunks.push(swift.slice(startIndex, startIndex + chunkSize));
    startIndex += chunkSize;
  }

  const allNames = swift.map((result) => result.scenario);
  const span = Math.max(allNames.length - 1, 1);
  const scenarioColors = new Map(
    allNames.map((name, index) => [name, viridis(0.2 + (0.6 * index) / span)]),
  );

  /** @type {ReadonlyArray<{ key: "totalThroughputMbps" | "avgDelayMs" | "avgJitterMs", xlabel: string, title: string, digits: number }>} */
  const metrics = [
    {
      key: "totalThroughputMbps",
      xlabel: "Throughput (Mbps)",
      title: "TcpSwift Throughput by Scenario",
      digits: 1,
    },
    {
      key: "avgDelayMs",
      xlabel: "Average Delay (ms)",
      title: "TcpSwift Delay by Scenario",
      digits: 4,
    },
    {
      key: "avgJitterMs",
      xlabel: "Average Jitter (ms)",
      title: "TcpSwift Jitter by Scenario",
      digits: 4,
    },
  ];

  /** @type {string[]} */
  const outputs = [];

  for (const [index, chunk] of chunks.entries()) {
    const partIndex = index + 1;
    const width = inches(14);
    const height = inches(Math.max(9, chunk.length * 0.55 + 4));
    const names = chunk.map((result) => result.scenario);
    const colors = names.map((name) => scenarioColors.get(name) ?? "#440154");

    /** @type {Partial<Data>[]} */
    const data = [];
    /** @type {Partial<Annotation>[]} */
    const annotations = [];
    /** @type {Record<string, Record<string, unknown>>} */
    const axes = {};

    metrics.forEach((metric, row) => {
      const key = row === 0 ? "" : String(row + 1);
      const values = chunk.map((result) => result[metric.key]);
      const maxValue = values.length > 0 ? Math.max(...values) : 0;
      const axisMax = maxValue > 0 ? maxValue * 1.15 : 1;

      data.push({
        type: "bar",
        orientation: "h",
        x: values,
        y: names,
        marker: { color: colors },
        xaxis: xRef(key),
        yaxis: yRef(key),
        showlegend: false,
        text: values.map((value) => value.toFixed(metric.digits)),
        textposition: "outside",
        textfont: { size: 8 },
        cliponaxis: false,
      });

      annotations.push({
        text: metric.title,
        x: 0.5,
        y: 1,
        xref: xRef(key, true),
        yref: yRef(key, true),
        xanchor: "center",
        yanchor: "bottom",
        showarrow: false,
        font: { size: 10 },
      });
      annotations.push({
        text: metric.xlabel,
        x: 0.5,
        y: -0.32,
        xref: xRef(key, true),
        yref: yRef(key, true),
        xanchor: "center",
        yanchor: "top",
        showarrow: false,
        font: { size: 9 },
      });

      axes[`xaxis${key}`] = {
        ...axisStyle({ grid: true, tickSize: 8 }),
        anchor: yRef(key),
        range: [0, axisMax],
      };
      axes[`yaxis${key}`] = {
        ...axisStyle({ grid: false, tickSize: 8 }),
        anchor: xRef(key),
        type: "category",
        autorange: "reversed",
        categoryorder: "array",
        categoryarray: names,
      };
    });

    /** @type {Partial<Layout>} */
    const layout = {
      ...baseLayout({
        width,
        height,
        baseFontSize: 9,
        margin: { top: 70, right: 80, bottom: 60, left: 160 },
      }),
      title: {
        text: `TcpSwift Scenario Metrics (Part ${partIndex}/${chunks.length})`,
        font: { size: 14 },
        x: 0.5,
        xanchor: "center",
      },
      grid: { rows: 3, columns: 1, pattern: "independent", ygap: 0.4 },
      ...axes,
      annotations,
    };

    const outputPath = await writePng(
      outputDir,
      `swift_scenarios_part${partIndex}.png`,
      (
        await renderer.render(
          { name: `swift_scenarios_part${partIndex}`, width, height, data, layout },
          { png: true },
          180 / 72,
        )
      ).png,
    );
    outputs.push(outputPath);
    console.log(`Swift scenario chart page saved to: ${outputPath}`);
  }

  console.log(
    "Swift scenario chart pages saved to: " +
      outputs.map((output) => path.basename(output)).join(", "),
  );
}

/**
 * Protocol radar chart over the metrics shared by every protocol.
 *
 * @param {AggregatedResult[]} results
 * @param {string} outputDir
 * @param {Renderer} renderer
 * @returns {Promise<void>}
 */
export async function plotRadarChart(results, outputDir, renderer) {
  await mkdir(outputDir, { recursive: true });

  /** @type {Map<string, Map<string, AggregatedResult>>} */
  const scenarioMap = new Map();
  for (const result of results) {
    let perProtocol = scenarioMap.get(result.scenario);
    if (!perProtocol) {
      perProtocol = new Map();
      scenarioMap.set(result.scenario, perProtocol);
    }
    perProtocol.set(result.protocol, result);
  }

  const availableProtocols = [
    ...new Set(results.map((result) => result.protocol)),
  ].sort();
  if (availableProtocols.length < 2) {
    console.log("At least 2 protocols required for radar chart");
    return;
  }

  const commonScenarios = [...scenarioMap.keys()]
    .sort()
    .filter((scenario) =>
      availableProtocols.every((protocol) =>
        scenarioMap.get(scenario)?.has(protocol),
      ),
    );
  if (commonScenarios.length === 0) {
    console.log("Warning: No common scenarios across all protocols for radar chart");
    return;
  }
  const excluded = [...scenarioMap.keys()]
    .filter((scenario) => !commonScenarios.includes(scenario))
    .sort();
  if (excluded.length > 0) {
    console.log(
      "Warning: Radar chart excluded non-intersection scenarios -> " +
        formatMissingList(excluded),
    );
  }

  const metricNames = ["Throughput", "Low Delay", "Low Jitter", "Low Loss"];

  /** @type {Map<string, number[]>} */
  const raw = new Map();
  for (const protocol of availableProtocols) {
    /** @type {number[][]} */
    const columns = [[], [], [], []];
    for (const scenario of commonScenarios) {
      const result = scenarioMap.get(scenario)?.get(protocol);
      if (!result) continue;
      columns[0].push(result.totalThroughputMbps);
      columns[1].push(result.avgDelayMs);
      columns[2].push(result.avgJitterMs);
      columns[3].push(result.totalLossRate);
    }
    raw.set(protocol, [
      mean(columns[0]),
      1 / (mean(columns[1]) + 0.001),
      1 / (mean(columns[2]) + 0.001),
      100 - mean(columns[3]),
    ]);
  }

  const maxima = metricNames.map((_, index) =>
    Math.max(...availableProtocols.map((p) => raw.get(p)?.[index] ?? Number.NaN)),
  );
  const minima = metricNames.map((_, index) =>
    Math.min(...availableProtocols.map((p) => raw.get(p)?.[index] ?? Number.NaN)),
  );
  const ranges = maxima.map(
    (max, index) => max - (minima[index] ?? 0) + 1e-10,
  );

  /** @type {Map<string, number[]>} */
  const normalized = new Map();
  for (const protocol of availableProtocols) {
    normalized.set(
      protocol,
      metricNames.map((_, index) => {
        const value = raw.get(protocol)?.[index] ?? Number.NaN;
        return (value - (minima[index] ?? 0)) / (ranges[index] ?? 1);
      }),
    );
  }

  const width = inches(8);
  const height = inches(8);
  /** @type {Partial<Data>[]} */
  const data = availableProtocols.map((protocol) => {
    const values = normalized.get(protocol) ?? [];
    const color =
      PROTOCOL_COLORS_MAP[
        /** @type {keyof typeof PROTOCOL_COLORS_MAP} */ (protocol)
      ] ?? "#333333";
    return {
      type: "scatterpolar",
      r: [...values, values[0]],
      theta: [...metricNames, metricNames[0]],
      fill: "toself",
      name: protocol,
      line: { color, width: 2 },
      fillcolor: color,
      opacity: 0.35,
    };
  });

  /** @type {Partial<Layout>} */
  const layout = {
    ...baseLayout({
      width,
      height,
      baseFontSize: 9,
      margin: { top: 80, right: 200, bottom: 60, left: 60 },
    }),
    title: {
      text: "Protocol Performance Radar Chart",
      font: { size: 12 },
      x: 0.5,
      xanchor: "center",
    },
    polar: {
      radialaxis: {
        range: [0, 1],
        visible: true,
        showline: false,
        gridcolor: GRID_COLOR,
        tickfont: { size: 8 },
      },
      angularaxis: {
        direction: "counterclockwise",
        gridcolor: GRID_COLOR,
        tickfont: { size: 9 },
      },
    },
    legend: { x: 1.02, y: 1, xanchor: "left", yanchor: "top" },
  };

  const rendered = await renderer.render(
    { name: "radar_comparison", width, height, data, layout },
    { png: true },
    150 / 72,
  );
  await writePng(outputDir, "radar_comparison.png", rendered.png);
  console.log(`Radar chart saved to: ${outputDir}`);
}

/**
 * Machine-readable companion table for the charts.
 *
 * @param {AggregatedResult[]} results
 * @param {string} outputDir
 * @returns {Promise<void>}
 */
export async function generateSummaryTable(results, outputDir) {
  await mkdir(outputDir, { recursive: true });
  if (results.length === 0) return;

  const fieldnames = [
    "Scenario",
    "Protocol",
    "Throughput (Mbps)",
    "Delay (ms)",
    "Jitter (ms)",
    "Loss (%)",
  ];
  const rows = results.map((result) => ({
    Scenario: result.scenario,
    Protocol: result.protocol,
    "Throughput (Mbps)": result.totalThroughputMbps.toFixed(2),
    "Delay (ms)": result.avgDelayMs.toFixed(4),
    "Jitter (ms)": result.avgJitterMs.toFixed(4),
    "Loss (%)": result.totalLossRate.toFixed(2),
  }));

  const csvPath = path.join(outputDir, "summary.csv");
  await writeFile(csvPath, buildCsv(fieldnames, rows), "utf8");
  console.log(`Summary table saved to: ${csvPath}`);
}

/**
 * Per-flow throughput grid: one row per scenario, one column per TCP data flow.
 *
 * @param {string} logDir
 * @param {string} outputDir
 * @param {Renderer} renderer
 * @returns {Promise<void>}
 */
export async function plotFlowThroughputComparison(logDir, outputDir, renderer) {
  const files = listFlowMonitorFiles(logDir);
  if (files.length === 0) {
    console.log(`No flowmonitor files found in: ${logDir}`);
    return;
  }

  /** @type {Map<string, Map<string, Map<number, number[]>>>} */
  const samples = new Map();
  for (const filepath of files) {
    const parsed = parseRunName(path.basename(filepath, ".flowmonitor"));
    if (!parsed) continue;
    let perProtocol = samples.get(parsed.scenario);
    if (!perProtocol) {
      perProtocol = new Map();
      samples.set(parsed.scenario, perProtocol);
    }
    let perFlow = perProtocol.get(parsed.protocol);
    if (!perFlow) {
      perFlow = new Map();
      perProtocol.set(parsed.protocol, perFlow);
    }
    for (const flow of parseFlowMonitor(filepath)) {
      if (flow.protocol !== 6 || ![1, 3, 5].includes(flow.flowId)) continue;
      const bucket = perFlow.get(flow.flowId) ?? [];
      bucket.push(flow.throughputMbps);
      perFlow.set(flow.flowId, bucket);
    }
  }

  /** @type {Map<string, Map<string, Map<number, number>>>} */
  const data = new Map();
  for (const [scenario, perProtocol] of samples) {
    /** @type {Map<string, Map<number, number>>} */
    const averaged = new Map();
    for (const [protocol, perFlow] of perProtocol) {
      /** @type {Map<number, number>} */
      const means = new Map();
      for (const [flowId, values] of perFlow) means.set(flowId, mean(values));
      averaged.set(protocol, means);
    }
    data.set(scenario, averaged);
  }

  const scenarios = [...data.keys()].sort();
  /** @type {Set<string>} */
  const available = new Set();
  for (const scenario of scenarios) {
    for (const protocol of data.get(scenario)?.keys() ?? []) available.add(protocol);
  }
  // Order matters for the x axis and is deliberately not PROTOCOL_ORDER: the
  // flow-throughput grid lists the baselines before Swift.
  const protocols = ["TcpNewReno", "TcpCubic", "TcpBbr", "TcpSwift"].filter(
    (protocol) => available.has(protocol),
  );
  const flows = [1, 3, 5];

  if (scenarios.length === 0 || protocols.length === 0) {
    console.log("No valid throughput data found for plotting");
    return;
  }
  warnMissingFlowEntries(data, protocols, flows);

  await mkdir(outputDir, { recursive: true });
  const SCENARIOS_PER_PAGE = 4;
  const totalPages = Math.ceil(scenarios.length / SCENARIOS_PER_PAGE);
  /** @type {string[]} */
  const outputs = [];

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const pageScenarios = scenarios.slice(
      pageIndex * SCENARIOS_PER_PAGE,
      (pageIndex + 1) * SCENARIOS_PER_PAGE,
    );
    const rows = pageScenarios.length;
    const width = inches(13);
    const height = inches(3.4 * rows + 1.4);

    /** @type {Partial<Data>[]} */
    const dataTraces = [];
    /** @type {Partial<Annotation>[]} */
    const annotations = [];
    /** @type {Record<string, Record<string, unknown>>} */
    const axes = {};

    pageScenarios.forEach((scenario, rowIndex) => {
      flows.forEach((flowId, columnIndex) => {
        const cell = rowIndex * flows.length + columnIndex;
        const key = cell === 0 ? "" : String(cell + 1);
        const perProtocol = data.get(scenario);
        const values = protocols.map(
          (protocol) => perProtocol?.get(protocol)?.get(flowId) ?? null,
        );
        const validValues = values.filter(isNumber);
        const axisMax =
          validValues.length > 0 ? Math.max(...validValues) * 1.2 : 100;
        const shortNames = protocols.map((protocol) => protocol.replace("Tcp", ""));

        dataTraces.push({
          type: "bar",
          x: shortNames,
          y: values,
          marker: {
            color: protocols.map(
              (protocol) =>
                FLOW_COLORS[/** @type {keyof typeof FLOW_COLORS} */ (protocol)],
            ),
            line: { color: "black", width: 0.5 },
          },
          xaxis: xRef(key),
          yaxis: yRef(key),
          text: values.map((value) =>
            isNumber(value) && value > 0 ? value.toFixed(1) : "",
          ),
          textposition: "outside",
          textfont: { size: 8 },
          cliponaxis: false,
        });

        values.forEach((value, index) => {
          if (isNumber(value)) return;
          annotations.push({
            x: shortNames[index],
            y: 0,
            xref: xRef(key),
            yref: yRef(key),
            text: "N/A",
            showarrow: false,
            textangle: -90,
            xanchor: "center",
            yanchor: "bottom",
            font: { size: 8, color: "#555555" },
          });
        });

        axes[`xaxis${key}`] = {
          ...axisStyle({ grid: false, tickSize: 9 }),
          anchor: yRef(key),
          type: "category",
        };
        axes[`yaxis${key}`] = {
          ...axisStyle({ title: "Throughput (Mbps)", tickSize: 9 }),
          anchor: xRef(key),
          range: [0, axisMax],
        };

        if (rowIndex === 0) {
          annotations.push({
            text: `Flow ${flowId}`,
            x: 0.5,
            y: 1.14,
            xref: xRef(key, true),
            yref: yRef(key, true),
            xanchor: "center",
            yanchor: "bottom",
            showarrow: false,
            font: { size: 11 },
          });
        }
        if (columnIndex === 0) {
          annotations.push({
            text: titleCase(scenario),
            x: -0.3,
            y: 0.5,
            xref: xRef(key, true),
            yref: yRef(key, true),
            xanchor: "center",
            yanchor: "middle",
            textangle: -90,
            showarrow: false,
            font: { size: 10 },
          });
        }
      });
    });

    /** @type {Partial<Layout>} */
    const layout = {
      ...baseLayout({
        width,
        height,
        baseFontSize: 9,
        margin: { top: 80, right: 30, bottom: 40, left: 110 },
      }),
      title: {
        text: `TCP Flow Throughput Comparison (Page ${pageIndex + 1}/${totalPages})`,
        font: { size: 14 },
        x: 0.5,
        xanchor: "center",
      },
      grid: {
        rows,
        columns: flows.length,
        pattern: "independent",
        ygap: 0.34,
        xgap: 0.34,
      },
      ...axes,
      annotations,
    };

    const out = await writePng(
      outputDir,
      `flow_throughput_comparison_part${pageIndex + 1}.png`,
      (
        await renderer.render(
          {
            name: `flow_throughput_comparison_part${pageIndex + 1}`,
            width,
            height,
            data: dataTraces,
            layout,
          },
          { png: true },
          200 / 72,
        )
      ).png,
    );
    outputs.push(out);
    console.log(`Flow throughput comparison page saved to: ${out}`);
  }

  if (outputs.length > 0) {
    console.log(
      "Flow throughput comparison pages saved to: " +
        outputs.map((output) => path.basename(output)).join(", "),
    );
  }
}

/**
 * `str.title()` equivalent: underscores become spaces, words are capitalised.
 *
 * @param {string} text
 * @returns {string}
 */
function titleCase(text) {
  return text
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Viridis control points, sampled uniformly over `[0, 1]`. */
const VIRIDIS_ANCHORS = [
  "#440154", "#470d60", "#48186a", "#482374",
  "#472d7b", "#453781", "#424086", "#3e4989",
  "#3b528b", "#375b8d", "#33638d", "#2f6b8e",
  "#2c728e", "#297a8e", "#26828e", "#23898e",
  "#21918c", "#1f988b", "#1fa088", "#22a785",
  "#28ae80", "#32b67a", "#3fbc73", "#4ec36b",
  "#5ec962", "#70cf57", "#84d44b", "#98d83e",
  "#addc30", "#c2df23", "#d8e219", "#ece51b",
  "#fde725",
];

/**
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * @param {[number, number, number]} rgb
 * @returns {string}
 */
function rgbToHex(rgb) {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Sample the viridis colormap.
 *
 * Interpolates linearly between 33 published anchors, which is visually
 * indistinguishable from matplotlib's 256-entry table for solid fills.
 *
 * @param {number} position - Position in `[0, 1]`.
 * @returns {string} Hex colour.
 */
export function viridis(position) {
  const clamped = Math.min(1, Math.max(0, position));
  const scaled = clamped * (VIRIDIS_ANCHORS.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(VIRIDIS_ANCHORS.length - 1, lower + 1);
  const blend = scaled - lower;
  const from = hexToRgb(VIRIDIS_ANCHORS[lower]);
  const to = hexToRgb(VIRIDIS_ANCHORS[upper]);
  const mixed = from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * blend),
  );
  return rgbToHex(/** @type {[number, number, number]} */ (mixed));
}

/**
 * Generate plots from native simulation results.
 *
 * @param {CliOptions} args
 * @returns {Promise<void>}
 */
export async function cmdDraw(args) {
  /** @type {Array<[string, string]>} */
  let datasets = [
    [path.join(REAL_LOG_ROOT, "comparison"), path.join(REAL_LOG_ROOT, "plots")],
    [
      path.join(REAL_LOG_ROOT, "comparison-udp"),
      path.join(REAL_LOG_ROOT, "plots-udp"),
    ],
  ];

  const comparisonDir = optionString(args, "--comparison-dir");
  if (comparisonDir) {
    const outputDir =
      optionString(args, "--output-dir") ??
      (comparisonDir.toLowerCase().includes("udp")
        ? path.join(REAL_LOG_ROOT, "plots-udp")
        : path.join(REAL_LOG_ROOT, "plots"));
    datasets = [[comparisonDir, outputDir]];
  }

  console.log("=".repeat(60));
  console.log("NS-3 FlowMonitor Data Visualization");
  console.log("=".repeat(60));

  let ok = 0;
  /** @type {Renderer | null} */
  let renderer = null;
  try {
    for (const [comparisonPath, outputDir] of datasets) {
      if (!isDirectory(comparisonPath)) {
        console.log(`Warning: Directory not found: ${comparisonPath}`);
        continue;
      }
      const results = aggregateResults(loadAllResults(comparisonPath));
      console.log(`\n--- Processing: ${comparisonPath} -> ${outputDir} ---`);
      console.log(
        `Loaded ${results.length} (scenario, protocol) results from ${comparisonPath}`,
      );
      if (results.length === 0) {
        console.log(`Warning: No flowmonitor files found in ${comparisonPath}`);
        continue;
      }
      // The renderer is opened lazily so a run with no readable dataset never
      // pays for launching a browser.
      if (!renderer) renderer = await FigureRenderer.open();
      await plotSwiftScenarios(results, outputDir, renderer);
      await plotProtocolComparison(results, outputDir, renderer);
      await plotRadarChart(results, outputDir, renderer);
      await generateSummaryTable(results, outputDir);
      await plotFlowThroughputComparison(comparisonPath, outputDir, renderer);
      ok += 1;
    }
  } finally {
    if (renderer) await renderer.close();
  }

  console.log(
    `\nAll charts generated! (${ok}/${datasets.length} datasets processed)`,
  );
}

// =============================================================================
// CLI Entry Point
// =============================================================================

/** @returns {ArgumentParser} */
function buildParser() {
  const parser = new ArgumentParser({
    program: "main.js",
    description: "NS-3 Swift TCP Simulation Management Tool",
    epilog:
      "Usage examples:\n" +
      "  node main.js sim                        # Run all pure TCP simulations\n" +
      "  node main.js sim --udp                  # Run all TCP+UDP simulations\n" +
      "  node main.js sim --scenario wifi_ac     # Run only the wifi_ac scenario\n" +
      "  node main.js sim --num-seeds 3          # 3 RngRun repetitions per config\n" +
      "  node main.js draw                       # Generate plots from logs/real\n" +
      "  node main.js draw --comparison-dir ./logs/real/comparison\n" +
      "  node main.js summary                    # Generate summary CSV from logs/real",
  });
  parser
    .addOption("--udp", {
      type: "boolean",
      help: "Enable UDP burst interference",
      default: false,
    })
    .addOption("--scenario", {
      type: "list",
      help: "Run only specified scenarios (space-separated)",
    })
    .addOption("--protocols", {
      type: "list",
      help: "Protocol list (default: TcpSwift TcpNewReno TcpCubic TcpBbr)",
      default: [],
    })
    .addOption("--duration", {
      type: "int",
      help: "Simulation duration (seconds)",
      default: DEFAULT_DURATION,
    })
    .addOption("--n-leaf", {
      type: "int",
      help: "Number of leaf nodes per side",
      default: DEFAULT_N_LEAF,
    })
    .addOption("--sim-seed", {
      type: "int",
      help: "Base random seed",
      default: DEFAULT_SIM_SEED,
    })
    .addOption("--num-seeds", {
      type: "int",
      help: "RngRun repetitions per scenario/protocol (seeds sim-seed .. sim-seed+N-1)",
      default: 1,
      defaultByCommand: { summary: 3 },
    })
    .addOption("--comparison-dir", {
      type: "string",
      help: "Specify a single data directory",
    })
    .addOption("--output-dir", {
      type: "string",
      help: "Specify output directory",
    })
    .addOption("--help", {
      type: "boolean",
      help: "Show this help message and exit",
      default: false,
    });
  return parser;
}

/** Subcommands understood by the CLI. */
const COMMANDS = new Set(["sim", "draw", "summary"]);

/**
 * @param {string[]} [argv] - Arguments after the script name.
 * @returns {Promise<number>} Process exit code.
 */
export async function main(argv = process.argv.slice(2)) {
  const parser = buildParser();
  /** @type {ReturnType<ArgumentParser["parse"]>} */
  let parsed;
  try {
    parsed = parser.parse(argv);
  } catch (error) {
    console.error(
      `[ERROR] ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(parser.usage());
    return 2;
  }

  // argparse prints the help text and exits 0 for `--help`; an unrecognised
  // subcommand is a usage error and exits 2, while a missing subcommand just
  // prints the help text and exits 1.
  if (parsed.options["--help"] === true) {
    console.log(parser.usage());
    return 0;
  }

  if (parsed.command === "sim") {
    await cmdSim(parsed.options);
  } else if (parsed.command === "draw") {
    await cmdDraw(parsed.options);
  } else if (parsed.command === "summary") {
    await cmdSummary(parsed.options);
  } else if (parsed.command === null) {
    console.log(parser.usage());
    return 1;
  } else {
    console.error(
      `[ERROR] argument command: invalid choice: '${parsed.command}' ` +
        `(choose from ${[...COMMANDS].map((name) => `'${name}'`).join(", ")})`,
    );
    console.error(parser.usage());
    return 2;
  }
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
