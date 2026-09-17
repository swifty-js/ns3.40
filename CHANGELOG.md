# Changelog

All notable changes to the swift-tcp example and its experiment tooling.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions refer
to the TcpSwift agent (`contrib/opengym/examples/swift-tcp/tcp_swift.py`).

## [0.2.0] - Patent figures and native simulation evidence

### Added

- `docs/plots/patent.js`, the patent figure pipeline. It reads the native
  ns-3.40 artifacts in `logs/real/{comparison,comparison-udp}` for seven
  scenarios (long-haul WAN, metro WAN, GEO satellite, 802.11n WLAN, poor-coverage
  LTE, congested aggregation, low-bandwidth data centre) × four protocols × three
  RngRun seeds (42/43/44) × {pure TCP, UDP burst}, validates every run with the
  same acceptance rules as `main.js summary`, writes
  `logs/real/summary/patent_kpi_forward.csv` and `patent_kpi_aggregate.csv`, and
  renders five figures: `fig08_patent_state_flow`, `fig09_patent_window_flow`
  (flowcharts) plus `fig10_patent_goodput`, `fig11_patent_delay`,
  `fig12_patent_robustness` (results). Incomplete batches abort the rendering
  instead of publishing partial data.
- `docs/patent.md`: new embodiment five reporting the simulation configuration and
  results — scenario table, aggregate goodput and mean one-way delay tables, a
  UDP-burst retention/added-loss table, figures 5–7, and a paragraph that states
  the mixed results (higher long-haul and GEO delay than the loss-based
  baselines, degraded Jain fairness in the WLAN scenario, lower goodput retention
  under the UDP burst in three scenarios) explicitly.
- `docs/patent.md`: figure references in steps S1–S5 for the two new flowcharts,
  an expanded 附图说明 (figures 1–7), and a complete 说明书附图 section; the
  摘要附图 is now the method flowchart alone.

### Changed

- `docs/plots/main.js`: exported the shared diagram helpers (`ShapeState`,
  `diagramCanvas`, `diagramLayout`, `roundedRectPath`, `saveFigure`), which the
  patent pipeline imports instead of duplicating the rendering code. The archived
  figure set and its manifest are unchanged.
- `docs/plots/README.md`: documents the two independent figure pipelines, the
  data source and validation of each figure, and the fact that the archived
  `logs/{comparison,comparison-udp}` dataset must not be cited as an experimental
  result.

### Notes

- The 168 new native runs were produced with the optimized `swift-tcp` binary. The
  `./ns3 run` entry point currently reconfigures the debug profile and fails to
  build upstream ns-3.40 `src/internet/model/arp-queue-disc-item.cc` under the
  current clang because of `-Werror` on a variable-length array; the optimized
  binary built from the same sources was invoked directly with the argument set
  `main.js sim` uses.
- Pure-loss-baseline runs are deterministic in this configuration: the three
  RngRun repetitions are value-identical, so their 95% intervals are zero. Only
  TcpBbr varies between repetitions.
- No new anomaly was recorded in `logs/error.txt`; all 168 runs passed the link
  budget validation (forward-flow count, throughput ceiling, delay floor, loss
  and fairness ranges).

### Validation

- `node docs/plots/patent.js`
- `npx tsc --noEmit`
- `git diff --check`

## [0.1.0] - Documentation claim hardening

### Changed

- Updated `docs/thesis.tex`, `docs/NJUPT_Professional_Thesis_draft1`, and
  `docs/patent.md` with minimal corrections grounded in the current heuristic
  controller and ns-3.40 configuration. The three artifacts now use the same
  three-part contribution framing and distinguish ns3-gym message transport
  from reinforcement learning.
- Replaced universal throughput claims with conservative cross-scenario wording
  and reported delay, loss, and Jain fairness as mixed, generally comparable
  results. Corrected TCP flow start times to 0.1/0.2/0.3 seconds, removed
  unsupported causal and optimality statements, and retained the single-run
  evidence limitation.
- Removed references to repository-local CSV, manifest, log, and FlowMonitor
  artifact paths from the paper, graduate thesis, and patent. These documents
  now describe only the ns-3.40 experiment configuration and metric definitions.
- Refreshed the aggregate summary with `python ./main.py summary`; the new
  288-row result is value-identical to the previous summary.
- Recorded one new metadata-integrity entry in `logs/error.txt`: three generated
  CSV files no longer match the stale size and SHA-256 entries in
  `logs/manifest.json`. All 288 FlowMonitor files remain parseable and their
  forward-flow metrics reproduce the current summaries, so no scenario,
  protocol row, or metric was excluded.

### Validation

- `python docs/build.py thesis`
- `python docs/build.py njupt`
- `git diff --check`
