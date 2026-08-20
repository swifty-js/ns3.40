# Changelog

All notable changes to the swift-tcp example and its experiment tooling.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions refer
to the TcpSwift agent (`contrib/opengym/examples/swift-tcp/tcp_swift.py`).

## [3.0.0] - 2026-08-20

Fixes for the findings of the 2026-08-20 code review (C1-C5 plus secondary
issues). All quantitative results recorded before this version (including the
tables in `docs/thesis.tex` and `logs/summary/results_20260611_100706.csv`)
were produced by the pre-fix algorithm and configuration and must be
regenerated with a full experiment-matrix rerun.

### Fixed

- **C1 (critical) - delivery-rate estimator** (`tcp_swift.py`):
  the per-ACK formula `segmentsAcked * segSize / lastRtt` under-estimated
  bandwidth by roughly the number of ACKs per RTT, collapsing the BDP
  estimate; cwnd then pinned at the `200*MSS` safety floor, capping WAN
  throughput at `200*MSS/RTT` (wan_longhaul 45 Mbps and cross_dc_wan
  237 Mbps both matched that ceiling exactly). Delivery rate is now
  cumulative ACKed bytes over a sliding time window
  (`min(max(2*min_rtt, 5 ms), 1 s)`). Verified with a synthetic ACK-stream
  harness (1 Gbps / 52 ms): BDP estimate 6.50 MB vs true 6.50 MB, steady
  throughput ~1000 Mbps (previously ~45 Mbps).
  Commit `68b9d77`.
- **C2 - dead ECN pathway** (`sim.cc`, `main.py`): every experiment ran on
  `PfifoFastQueueDisc`, which never marks CE, so beta_ecn, ECN rewards, and
  the ECN-based narrative were never exercised; ECN was also enabled only
  for TcpSwift, biasing baselines. The bottleneck now defaults to
  `RedQueueDisc` marking from 30% of queue length (MinTh=0.3q, MaxTh=0.9q,
  UseEcn), ECN is enabled for **all** TCP variants, and the runner records
  `--queue_disc_type` on the command line. Commit `96301b3`.
- **C3 - ECN misclassification** (`tcp_swift.py`): ECE/CWR-triggered
  `GetSsThresh` callbacks were classified as generic loss (beta=0.70);
  they now receive the ECN response (beta=0.75). Commit `6ed0a8c`.
- **C4 - reward adaptation carried no signal** (`tcp_swift.py`,
  `tcp-swift-env.cc` comment): the per-ACK reward is >= +0.5 on nearly every
  ACK, so the fixed `ema > 0.5` threshold was a constant +0.01 ratchet
  toward `alpha_max`. Alpha now moves only when the fast reward EMA
  (eta=0.15) departs from its slow baseline EMA (eta_b=0.02) by a dynamic
  margin, with an asymmetric down-margin for loss/timeout spikes.
  Commit `615e7a2`.
- **C5 - experiment-matrix integrity** (`main.py`, `sim.cc`):
  - `satellite_leo` duplicated `lte_good` parameter-for-parameter (their
    result rows were byte-identical); it is now a Starlink-like LEO link
    (500M/150M, 2ms/25ms).
  - `congested_heavy` duplicated `dc_oversub_10to1`; it is now a 20:1
    oversubscription point (10G/500M).
  - `sim --num-seeds N` runs N RngRun repetitions per configuration;
    artifacts carry an `_s<seed>` suffix and `summary`/`draw` average
    across seeds (old seedless artifacts still parse). The summary CSV
    gains a `Seeds` column.
  - `sim.cc` now logs `AccessBW`/`BottleneckBW` (the CSV columns were
    always `N/A` because those lines never existed) and TCP
    `AggregateThroughput`/`AggregateLossRate`; the summary previously
    recorded only the first flow's throughput.
  Commit `a40c294`.
- **Secondary hardening** (`tcp-swift-env.cc`, `tcp-swift.h`,
  `tcp-swift-env.h`, `tcp-swift.cc`, `sim.cc`, `tcp_swift.py`):
  - Deferred cwnd cached in `GetSsThresh` is discarded on CA_LOSS (RTO)
    instead of overriding the stack's slow-start restart later.
  - The consecutive-decrease counter is no longer reset during the
    post-decrease freeze, so the `D_max` floor works as documented.
  - The advertised `error_p` parameter is wired to a `RateErrorModel` on
    the bottleneck (it was parsed but ignored).
  - Removed the dead `envTimeStep` option and the commented-out defaults
    for nonexistent `TcpSwift::Reward/Penalty` attributes.
  - Flow i starts at `start_time*(i+1)`, so flow 0 no longer starts at
    t=0 simultaneously with the sinks.
  - Leftover `TCP_SWIFT_*` include guards renamed to `TCP_SWIFT_*`; log
    components renamed `TcpSwift`/`TcpSwiftEnv`.
  Commit `b6d2680`.

### Documentation

- `docs/thesis.tex` algorithm descriptions aligned with the v3
  implementation (time-window delivery rate, ECN classification, ssthresh
  formula, baseline-relative reward adaptation, MSS=1440, per-agent reward
  EMA, seed policy), and the evidence-boundary note now states that all
  quantitative tables predate the v3 fixes. Commit `cae8cb1`.

### Validation

- `python3 -m py_compile` on `tcp_swift.py` and `main.py`.
- Synthetic ACK-stream harness (no ns-3 required) confirming the C1 fix.
- Regex/backward-compatibility check of run-name parsing and a `summary`
  smoke run over the existing pre-fix logs (288 grouped records).
- C++ changes are review-verified only; compile with `./ns3 build swift-tcp`
  on the Linux experiment machine (this repo's macOS host does not build).

### Rerun checklist

1. `./ns3 configure --enable-mtp --enable-examples && ./ns3 build`
2. `python main.py sim --num-seeds 10`
3. `python main.py sim --udp --num-seeds 10`
4. `python main.py summary && python main.py draw`
5. Refresh `docs/thesis.tex` tables from the new `summary.csv` files.
