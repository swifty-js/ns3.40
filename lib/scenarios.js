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
 * Scenario catalogue and shared protocol presentation constants.
 *
 * In the Python layout `main.py` owned the scenario table and
 * `docs/plots/main.py` recovered it by parsing that file's AST. Both scripts are
 * JavaScript now, so the table lives here and is imported directly. That removes
 * the AST round-trip while keeping a single source of truth.
 */

/** Default simulation duration, in seconds. */
export const DEFAULT_DURATION = 20;

/** Default number of leaf nodes per side of the dumbbell. */
export const DEFAULT_N_LEAF = 3;

/** Default base RngRun seed. */
export const DEFAULT_SIM_SEED = 42;

/** Protocols exercised by a default run. */
export const DEFAULT_PROTOCOLS = [
  "TcpSwift",
  "TcpNewReno",
  "TcpCubic",
  "TcpBbr",
];

/** Root directory of the simulation artifacts. */
export const REAL_LOG_ROOT = "./logs/real";

/**
 * Scenario definition: name, access bandwidth, bottleneck bandwidth, access
 * delay, bottleneck delay.
 *
 * @typedef {readonly [string, string, string, string, string]} Scenario
 */

/** @type {ReadonlyArray<Scenario>} */
export const SCENARIOS = [
  // --- Category 1: Intra-Rack Data Center ---
  ["intra_rack_10g", "25Gbps", "10Gbps", "1us", "2us"],
  ["intra_rack_25g", "25Gbps", "25Gbps", "1us", "2us"],
  // --- Category 2: Leaf-Spine Architecture ---
  ["leaf_spine_20g", "50Gbps", "20Gbps", "2us", "5us"],
  ["leaf_spine_50g", "50Gbps", "50Gbps", "2us", "5us"],
  // --- Category 3: Oversubscription Convergence ---
  ["oversub_4to1_10g", "10Gbps", "2.5Gbps", "2us", "5us"],
  ["oversub_4to1_40g", "40Gbps", "10Gbps", "2us", "5us"],
  ["oversub_2to1_25g", "25Gbps", "12.5Gbps", "2us", "5us"],
  ["oversub_2to1_50g", "50Gbps", "25Gbps", "2us", "5us"],
  // --- Category 4: Congestion Level Gradient ---
  ["congested_light", "10Gbps", "5Gbps", "2us", "5us"],
  ["congested_medium", "10Gbps", "2Gbps", "2us", "5us"],
  // 20:1 -- was 10Gbps/1Gbps, identical to dc_oversub_10to1 (duplicate rows)
  ["congested_heavy", "10Gbps", "500Mbps", "2us", "5us"],
  // --- Category 5: Cross-Pod / Cross-DC ---
  ["cross_pod_10g", "25Gbps", "10Gbps", "5us", "50us"],
  ["cross_pod_20g", "50Gbps", "20Gbps", "5us", "50us"],
  ["cross_dc_wan", "10Gbps", "1Gbps", "10us", "5ms"],
  // --- Category 6: RDMA-like Ultra-Low Latency ---
  ["rdma_like_25g", "25Gbps", "25Gbps", "500ns", "1us"],
  ["rdma_like_50g", "50Gbps", "50Gbps", "500ns", "1us"],
  // --- Category 7: Mixed Traffic & Asymmetric ---
  ["mixed_small_flow", "10Gbps", "2Gbps", "2us", "10us"],
  ["mixed_large_flow", "50Gbps", "12.5Gbps", "2us", "10us"],
  ["asymmetric_high", "50Gbps", "1Gbps", "1us", "10us"],
  ["symmetric_low", "1Gbps", "1Gbps", "5us", "20us"],
  // --- Category 8: Data Center Bandwidth Scaling ---
  ["dc_100m", "1Gbps", "100Mbps", "2us", "5us"],
  ["dc_500m", "1Gbps", "500Mbps", "2us", "5us"],
  ["dc_100g", "100Gbps", "100Gbps", "1us", "2us"],
  ["dc_oversub_10to1", "10Gbps", "1Gbps", "2us", "5us"],
  // --- Category 9: WiFi Wireless ---
  ["wifi_ac", "1Gbps", "400Mbps", "1ms", "5ms"],
  ["wifi_ax", "1Gbps", "600Mbps", "1ms", "3ms"],
  ["wifi_n", "100Mbps", "50Mbps", "2ms", "10ms"],
  ["wifi_legacy", "100Mbps", "10Mbps", "5ms", "20ms"],
  // --- Category 10: Cellular Mobile (LTE / 5G NR) ---
  ["lte_good", "100Mbps", "50Mbps", "5ms", "20ms"],
  ["lte_poor", "50Mbps", "10Mbps", "10ms", "50ms"],
  ["nr_5g_embb", "1Gbps", "500Mbps", "1ms", "5ms"],
  ["nr_5g_edge", "500Mbps", "100Mbps", "2ms", "10ms"],
  // --- Category 11: WAN / Satellite ---
  ["wan_metro", "10Gbps", "1Gbps", "100us", "2ms"],
  ["wan_longhaul", "10Gbps", "1Gbps", "500us", "25ms"],
  // LEO (Starlink-like) -- was identical to lte_good (duplicate rows)
  ["satellite_leo", "500Mbps", "150Mbps", "2ms", "25ms"],
  ["satellite_geo", "50Mbps", "10Mbps", "10ms", "300ms"],
];

/** Scenario names, in catalogue order. */
export const SCENARIO_NAMES = SCENARIOS.map(([name]) => name);

/**
 * Scenario lookup: name -> `[accessBw, bottleneckBw, accessDelay, bottleneckDelay]`.
 *
 * @type {ReadonlyMap<string, readonly [string, string, string, string]>}
 */
export const SCENARIO_LINKS = new Map(
  SCENARIOS.map(([name, access, bottleneck, accessDelay, bottleneckDelay]) => [
    name,
    /** @type {const} */ ([access, bottleneck, accessDelay, bottleneckDelay]),
  ]),
);

/**
 * Published scenario numbering used by the thesis table `tab:scenarios`.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
export const S_ORDER = [
  ["S1", "intra_rack_10g"],
  ["S2", "intra_rack_25g"],
  ["S3", "leaf_spine_20g"],
  ["S4", "asymmetric_high"],
  ["S5", "congested_heavy"],
  ["S6", "symmetric_low"],
  ["S7", "dc_500m"],
  ["S8", "dc_100m"],
  ["S9", "cross_dc_wan"],
  ["S10", "wan_metro"],
  ["S11", "wifi_ac"],
  ["S12", "wifi_ax"],
  ["S13", "wifi_n"],
  ["S14", "wifi_legacy"],
  ["S15", "nr_5g_embb"],
  ["S16", "nr_5g_edge"],
  ["S17", "lte_good"],
  ["S18", "lte_poor"],
  ["S19", "satellite_geo"],
];

/** Scenario index by S-number, e.g. `S8` -> `dc_100m`. */
export const SCENARIO_BY_SID = new Map(S_ORDER);

/** S-number by scenario name, e.g. `dc_100m` -> `S8`. */
export const SID_BY_SCENARIO = new Map(
  S_ORDER.map(([sid, scenario]) => [scenario, sid]),
);

/** S-numbers that have a matching UDP-burst run. */
export const UDP_PAIRED_SIDS = [
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
];

/** Protocol display order used by every ranking and chart. */
export const PROTOCOL_ORDER = ["TcpSwift", "TcpNewReno", "TcpCubic", "TcpBbr"];

/** Bar colours for the protocol comparison charts, indexed like `PROTOCOL_ORDER`. */
export const PROTOCOL_COLORS_BAR = [
  "#42b883", // Vue Green
  "#61dafb", // React Blue
  "#dd0031", // Angular Red
  "#673ab8", // Preact Purple
];

/** Protocol colours for the radar chart. */
export const PROTOCOL_COLORS_MAP = {
  TcpSwift: "#42b883", // Vue Green
  TcpNewReno: "#61dafb", // React Blue
  TcpCubic: "#dd0031", // Angular Red
  TcpBbr: "#673ab8", // Preact Purple
};

/**
 * Per-flow colours for the flow-throughput grid; like the Python original this
 * intentionally differs from `PROTOCOL_COLORS_MAP`.
 */
export const FLOW_COLORS = {
  TcpNewReno: "#61dafb", // React Blue
  TcpCubic: "#673ab8", // Preact Purple
  TcpBbr: "#42b883", // Vue Green
  TcpSwift: "#dd0031", // Angular Red
};

/** Short protocol labels used by the thesis figures. */
export const PROTOCOL_LABEL = {
  TcpSwift: "Swift",
  TcpNewReno: "NewReno",
  TcpCubic: "CUBIC",
  TcpBbr: "BBR",
};

/**
 * Colours used by the thesis figures, in `PROTOCOL_ORDER` order.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DOCS_PLOT_COLORS = {
  TcpSwift: "#61DAFB", // React Blue
  TcpNewReno: "#673AB8", // Preact Purple
  TcpCubic: "#42B883", // Vue Green
  TcpBbr: "#DD0031", // Angular Red
};
