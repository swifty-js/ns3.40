# Changelog

All notable changes to the swift-tcp example and its experiment tooling.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions refer
to the TcpSwift agent (`contrib/opengym/examples/swift-tcp/tcp_swift.py`).

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
