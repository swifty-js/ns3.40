# Swift — Multi-Signal Congestion Control on ns-3.40

**Swift** (`TcpSwift`) is a deterministic, multi-signal fusion TCP congestion
control algorithm implemented directly in C++ for the
[ns-3.40](https://www.nsnam.org/) discrete-event network simulator. It targets
long-distance and heterogeneous access paths — data-center fabrics, WiFi,
LTE/5G, metro/long-haul WAN and satellite links — where fixed-parameter,
single-signal algorithms struggle to balance throughput, delay and loss.

- Author: [Hang Tiancheng](https://github.com/hangtiancheng)
- Paper: _Swift: 启发式多信号融合自适应网络拥塞控制算法_ — see [`docs/thesis.tex`](docs/thesis.tex)

## Highlights

- **Multi-signal congestion awareness.** ECN state, the congestion-avoidance
  state machine, congestion-event semantics, RTT versus min-RTT and
  bytes-in-flight are consumed directly by the native congestion controller.
- **Adaptive fusion control.** A min-RTT-aware RTT-inflation ratio, relative
  performance feedback and consecutive-growth trends jointly tune a per-flow
  multiplicative factor α ∈ [0.85, 1.30]; cwnd converges toward the α × BDP
  target, where BDP comes from a windowed max-filter over a sliding-window
  delivery-rate estimate.
- **Stability and safety under uncertain signals.** Differentiated window-retention
  factors (loss ρ = 0.70, ECN ρ = 0.75, timeout ρ = 0.50), a consecutive-decrease
  floor, a post-decrease freeze window, queue-dwell-free slow-start threshold
  updates and hard window clamps.
- **Reproducible benchmark harness.** 36 link scenarios × 4 protocols
  (`TcpSwift`, `TcpNewReno`, `TcpCubic`, `TcpBbr`) × N seeds, with resume
  support, automated plotting and CSV reporting.

## Repository Layout

```
.
├── scratch/swift-tcp/                # Native C++ Swift implementation
│   ├── tcp-swift.{h,cc}              #   Congestion controller and per-flow state
│   ├── sim.cc                        #   Dumbbell-topology simulation entry point
│   └── CMakeLists.txt                #   Scratch executable definition
├── main.js                           # typed experiment runner / plotter / summarizer
├── lib/                              # FlowMonitor parser and Plotly renderer
├── Makefile                          # build, tcp, udp, gen, format, clean targets
├── flowmonitor/                      # web dashboard for FlowMonitor results
├── docs/                             # thesis, patent draft, build driver and plots
└── logs/                             # simulation artifacts, plots and summary CSVs
```

## Build

Swift uses only standard ns-3 C++ modules. No OpenGym, ZeroMQ, Protobuf or
Python bindings are required to build or run simulations on macOS or Linux.

```bash
./ns3 clean
./ns3 configure --build-profile=optimized --enable-mtp --enable-examples
./ns3 build swift-tcp
./ns3 build
```

`make build` wraps the configure/build steps; `make clean` removes all build
artifacts and caches. Install the Node.js tooling and the headless browser once:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm typecheck
```

## Quick Start

All protocols run as a single native ns-3 process.

```bash
# Swift
./ns3 run "swift-tcp --transport_prot=TcpSwift"

# Classic baseline
./ns3 run "swift-tcp --transport_prot=TcpNewReno"
```

The `swift-tcp` binary accepts the full scenario parameter set:
`--transport_prot`, `--access_bandwidth`, `--bottleneck_bandwidth`,
`--access_delay`, `--bottleneck_delay`, `--duration`, `--nLeaf`, `--simSeed`,
`--enable_udp_burst`, `--queue_disc_type` and `--prefix_name`
(see `scratch/swift-tcp/sim.cc`).

## Benchmark Matrix

`main.js` drives the full evaluation. It is plain ESM JavaScript checked by
TypeScript through `// @ts-check` and JSDoc annotations. It defines **36 scenarios** across
11 categories — intra-rack and leaf-spine data center, oversubscription,
congestion gradients, cross-pod/cross-DC, RDMA-like ultra-low latency, mixed
and asymmetric traffic, bandwidth scaling, WiFi (802.11n/ac/ax/legacy),
cellular (LTE, 5G NR eMBB/edge) and WAN/satellite (metro, long-haul, LEO, GEO) —
and runs each against `TcpSwift`, `TcpNewReno`, `TcpCubic` and `TcpBbr`.
The optional `--udp` flag adds an on/off UDP flow whose configured peak rate is
64% of the bottleneck rate and whose nominal long-term offered load is 32%.
Completed runs are skipped automatically using the seed-qualified filenames.
New native results are isolated from legacy generated fixtures under `logs/real/`.

```bash
node main.js sim --num-seeds 3             # pure TCP -> logs/real/comparison
node main.js sim --udp --num-seeds 3       # UDP burst -> logs/real/comparison-udp
node main.js sim --scenario wifi_ac        # single scenario
node main.js draw                          # plots -> logs/real/plots*
node main.js summary                       # CSV -> logs/real/summary
```

Makefile shortcuts: `make tcp`, `make udp` (single quick run), `make gen`
(draw + summary), `make kill` (stop stray ns-3 processes).

## Results Dashboard

The [`lark/`](lark) app is a Vite + [@lark.js/mvc](https://github.com/hangtiancheng)
dashboard that renders the flowmonitor results (throughput, delay, jitter,
loss, per-flow breakdowns) from `logs/`. It is deployed to GitHub Pages at
<https://tianchenghang.github.io/ns3.40> via `.github/workflows/deploy.yml`.

```bash
pnpm install
pnpm --filter flowmonitor parse   # logs/*.flowmonitor -> lark/public/data
pnpm --filter flowmonitor dev     # local dev server
```

## Documentation Toolchain

For compiling the thesis and generating plots:

```bash
# Linux (Debian/Ubuntu)
sudo apt install -y texlive-full
# MacOS
brew install --cask mactex

# https://github.com/be5invis/Sarasa-Gothic
brew install gnuplot

node docs/build.js thesis   # conference paper
node docs/build.js njupt    # NJUPT thesis
node docs/build.js all      # both documents in parallel
node docs/plots/main.js     # Plotly PNG/SVG + Chromium vector PDF
```

The document and figure drivers are typed JavaScript. Plotly.js runs inside a
headless Chromium page; `Plotly.toImage` writes PNG/SVG and `page.pdf()` writes
the vector PDF output.

## Development

```bash
make format    # clang-format (C/C++), ruff format (Python), shfmt (shell)
```

## License

Apache License 2.0 for the Swift additions (`scratch/swift-tcp`, `ieg`, tooling
scripts); ns-3 itself is GPL-2.0-only — see
[LICENSE](LICENSE) and upstream ns-3 licensing for details.
