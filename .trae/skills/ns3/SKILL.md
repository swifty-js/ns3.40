---
name: ns3
description: ns-3 is a network simulator. Use this skill whenever the user asks questions.
---

# The Network Simulator, Version 3

## Table of Contents

- [Overview](#overview-an-open-source-project)
- [Building ns-3](#building-ns-3)
- [Testing ns-3](#testing-ns-3)
- [Running ns-3](#running-ns-3)
- [ns-3 Documentation](#ns-3-documentation)
- [Working with the Development Version of ns-3](#working-with-the-development-version-of-ns-3)
- [Contributing to ns-3](#contributing-to-ns-3)
- [Reporting Issues](#reporting-issues)
- [ns-3 App Store](#ns-3-app-store)

> **NOTE**: Much more substantial information about ns-3 can be found at
> <https://www.nsnam.org>

## Overview: An Open Source Project

ns-3 is a free open source project aiming to build a discrete-event
network simulator targeted for simulation research and education.
This is a collaborative project; we hope that
the missing pieces of the models we have not yet implemented
will be contributed by the community in an open collaboration
process. If you would like to contribute to ns-3, please check
the [Contributing to ns-3](#contributing-to-ns-3) section below.

This README excerpts some details from a more extensive
tutorial that is maintained at:
<https://www.nsnam.org/documentation/latest/>

## Building ns-3

The code for the framework and the default models provided
by ns-3 is built as a set of libraries. User simulations
are expected to be written as simple programs that make
use of these ns-3 libraries.

To build the set of default libraries and the example
programs included in this package, you need to use the
`ns3` tool. This tool provides a Waf-like API to the
underlying CMake build manager.
Detailed information on how to use `ns3` is included in the
[quick start guide](doc/installation/source/quick-start.rst).

Before building ns-3, you must configure it.
This step allows the configuration of the build options,
such as whether to enable the examples, tests and more.

To configure ns-3 with examples and tests enabled,
run the following command on the ns-3 main directory:

```shell
./ns3 configure --enable-examples --enable-tests
```

Then, build ns-3 by running the following command:

```shell
./ns3 build
```

By default, the build artifacts will be stored in the `build/` directory.

### Supported Platforms

The current codebase is expected to build and run on the
set of platforms listed in the [release notes](RELEASE_NOTES.md)
file.

Other platforms may or may not work: we welcome patches to
improve the portability of the code to these other platforms.

## Testing ns-3

ns-3 contains test suites to validate the models and detect regressions.
To run the test suite, run the following command on the ns-3 main directory:

```shell
./test.py
```

More information about ns-3 tests is available in the
[test framework](doc/manual/source/test-framework.rst) section of the manual.

## Running ns-3

On recent Linux systems, once you have built ns-3 (with examples
enabled), it should be easy to run the sample programs with the
following command, such as:

```shell
./ns3 run simple-global-routing
```

That program should generate a `simple-global-routing.tr` text
trace file and a set of `simple-global-routing-xx-xx.pcap` binary
PCAP trace files, which can be read by `tcpdump -n -tt -r filename.pcap`.
The program source can be found in the `examples/routing` directory.

## Running ns-3 from Python

If you do not plan to modify ns-3 upstream modules, you can get
a pre-built version of the ns-3 python bindings.

```shell
pip install --user ns3
```

If you do not have `pip`, check their documents
on [how to install it](https://pip.pypa.io/en/stable/installation/).

After installing the `ns3` package, you can then create your simulation python script.
Below is a trivial demo script to get you started.

```python
from ns import ns

ns.LogComponentEnable("Simulator", ns.LOG_LEVEL_ALL)

ns.Simulator.Stop(ns.Seconds(10))
ns.Simulator.Run()
ns.Simulator.Destroy()
```

The simulation will take a while to start, while the bindings are loaded.
The script above will print the logging messages for the called commands.

Use `help(ns)` to check the prototypes for all functions defined in the
ns3 namespace. To get more useful results, query specific classes of
interest and their functions e.g., `help(ns.Simulator)`.

Smart pointers `Ptr<>` can be differentiated from objects by checking if
`__deref__` is listed in `dir(variable)`. To dereference the pointer,
use `variable.__deref__()`.

Most ns-3 simulations are written in C++ and the documentation is
oriented towards C++ users. The ns-3 tutorial programs (`first.cc`,
`second.cc`, etc.) have Python equivalents, if you are looking for
some initial guidance on how to use the Python API. The Python
API may not be as full-featured as the C++ API, and an API guide
for what C++ APIs are supported or not from Python do not currently exist.
The project is looking for additional Python maintainers to improve
the support for future Python users.

## ns-3 Documentation

Once you have verified that your build of ns-3 works by running
the `simple-global-routing` example as outlined in the [running ns-3](#running-ns-3)
section, it is quite likely that you will want to get started on reading
some ns-3 documentation.

All of that documentation should always be available from
the ns-3 website: <https://www.nsnam.org/documentation/>.

This documentation includes:

- a tutorial
- a reference manual
- models in the ns-3 model library
- a wiki for user-contributed tips: <https://www.nsnam.org/wiki/>
- API documentation generated using doxygen: this is
  a reference manual, most likely not very well suited
  as introductory text:
  <https://www.nsnam.org/doxygen/index.html>

## Working with the Development Version of ns-3

If you want to download and use the development version of ns-3, you
need to use the tool `git`. A quick and dirty cheat sheet is included
in the manual, but reading through the Git
tutorials found in the Internet is usually a good idea if you are not
familiar with it.

If you have successfully installed Git, you can get
a copy of the development version with the following command:

```shell
git clone https://gitlab.com/nsnam/ns-3-dev.git
```

However, we recommend to follow the GitLab guidelines for starters,
that includes creating a GitLab account, forking the ns-3-dev project
under the new account's name, and then cloning the forked repository.
You can find more information in the [manual](https://www.nsnam.org/docs/manual/html/working-with-git.html).

## Contributing to ns-3

The process of contributing to the ns-3 project varies with
the people involved, the amount of time they can invest
and the type of model they want to work on, but the current
process that the project tries to follow is described in the
[contributing code](https://www.nsnam.org/developers/contributing-code/)
website and in the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## Reporting Issues

If you would like to report an issue, you can open a new issue in the
[GitLab issue tracker](https://gitlab.com/nsnam/ns-3-dev/-/issues).
Before creating a new issue, please check if the problem that you are facing
was already reported and contribute to the discussion, if necessary.

## ns-3 App Store

The official [ns-3 App Store](https://apps.nsnam.org/) is a centralized directory
listing third-party modules for ns-3 available on the Internet.

More information on how to submit an ns-3 module to the ns-3 App Store is available
in the [ns-3 App Store documentation](https://www.nsnam.org/docs/contributing/html/external.html).

## Unison for ns-3

A fast and user-transparent parallel simulator implementation for ns-3.
More information about Unison can be found in our EuroSys '24 paper (coming soon).

Supported ns-3 version: [3.36.1](https://github.com/NASA-NJU/UNISON-for-ns-3/tree/unison-3.36.1), [3.37](https://github.com/NASA-NJU/UNISON-for-ns-3/tree/unison-3.37), [3.38](https://github.com/NASA-NJU/UNISON-for-ns-3/tree/unison-3.38), [3.39](https://github.com/NASA-NJU/UNISON-for-ns-3/tree/unison-3.39) and [3.40](github.com/NASA-NJU/UNISON-for-ns-3/tree/unison-3.40).
We are trying to keep Unison updated with the latest version of ns-3.
You can find each unison-enabled ns-3 version via `unison-*` tags.

## Getting Started

The quickest way to get started is to type the command

```shell
./ns3 configure --enable-mtp --enable-examples
```

> The build profile is set to default (which uses `-O2 -g` compiler flags) in this case.
> If you want to get `-O3` optimized build and discard all log outputs, please add `-d optimized` arguments.

The `--enable-mtp` option will enable multi-threaded parallelization.
You can verify Unison is enabled by checking whether `Multithreaded Simulation : ON` appears in the optional feature list.

Now, let's build and run a DCTCP example with default sequential simulation and parallel simulation (using 4 threads) respectively:

```shell
./ns3 build dctcp-example dctcp-example-mtp
time ./ns3 run dctcp-example
time ./ns3 run dctcp-example-mtp
```

The simulation should finish in 4-5 minutes for `dctcp-example` and 1-2 minutes for `dctcp-example-mtp`, depending on your hardware and your build profile.
The output in `*.dat` should be in accordance with the comments in the source file.

The speedup of Unison is more significant for larger topologies and traffic volumes.
If you are interested in using it to simulate topologies like fat-tree, BCube and 2D-torus, please refer to [Running Evaluations](#running-evaluations).

## Speedup Your Existing Code

To understand how Unison affects your model code, let's find the differences between two versions of the source files of the above example:

```shell
diff examples/tcp/dctcp-example.cc examples/mtp/dctcp-example-mtp.cc
```

It turns out that to bring Unison to the existing model code, all you need to do is to include the `ns3/mtp-interface.h` header file and add the following line at the beginning of the `main` function:

```c++
MtpInterface::Enable(numberOfThreads);
```

The parameter `numberOfThreads` is optional.
If it is omitted, the number of threads is automatically chosen and will not exceed the maximum number of available hardware threads on your system.
If you want to enable Unison for distributed simulation on existing MPI programs for further speedup, place the above line before MPI initialization and do not explicitly specify the simulator implementation in your code.
For such hybrid simulation with MPI, the `--enable-mpi` option is also required when configuring ns-3.

Unison resolved a lot of thread-safety issues with ns-3's architecture.
You don't need to consider these issues on your own for most of the time, except if you have custom global statistics other than the built-in flow-monitor.
In the latter case, if multiple nodes can access your global statistics, you can replace them with atomic variables via `std::atomic<>`.
When collecting tracing data such as Pcap, it is strongly recommended to create separate output files for each node instead of a single trace file.
For complex custom data structures, you can create critical sections by adding

```c++
MtpInterface::CriticalSection cs;
```

at the beginning of your methods.

## Examples

In addition to the DCTCP example, you can find other adapted examples in `examples/mtp`.
Meanwhile, Unison also supports manual partition, and you can find a minimal example in `src/mtp/examples/simple-mtp.cc`
For hybrid simulation with MPI, you can find a minimal example in `src/mpi/examples/simple-hybrid.cc`.

We also provide three detailed fat-tree examples for Unison, traditional MPI parallel simulation and hybrid simulation:

| Name            | Location                            | Required configuration flags                           | Running commands                                                         |
| --------------- | ----------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| fat-tree-mtp    | src/mtp/examples/fat-tree-mtp.cc    | `--enable-mtp --enable-exaples` without `--enable-mpi` | `./ns3 run "fat-tree-mtp --thread=4"`                                    |
| fat-tree-mpi    | src/mpi/examples/fat-tree-mpi.cc    | `--enable-mpi --enable-exaples` without `--enable-mtp` | `./ns3 run fat-tree-mpi --command-template "mpirun -np 4 %s"`            |
| fat-tree-hybrid | src/mpi/examples/fat-tree-hybrid.cc | `--enable-mtp --enable-mpi --enable-exaples`           | `./ns3 run fat-tree-mpi --command-template "mpirun -np 2 %s --thread=2"` |

Feel free to explore these examples, compare code changes and adjust the `-np` and `--thread` arguments.

## Running Evaluations

To evaluate Unison, please switch to [unison-evaluations](https://github.com/NASA-NJU/Unison-for-ns-3/tree/unison-evaluations) branch, which is based on ns-3.36.1.
In this branch, you can find various topology models in the `scratch` folder.
There are a lot of parameters you can set for each topology.
We provided a utility script `exp.py` to compare these simulators and parameters.
We also provided `process.py` to convert these raw experiment data to CSV files suitable for plotting.
Please see the [README in that branch](https://github.com/NASA-NJU/Unison-for-ns-3/tree/unison-evaluations) for more details.

The evaluated artifact (based on ns-3.36.1) is persistently indexed by DOI [10.5281/zenodo.10077300](https://doi.org/10.5281/zenodo.10077300).

## Module Documentation

### 1. Overview

Unison for ns-3 is mainly implemented in the `mtp` module (located at `src/mtp/*`), which stands for multi-threaded parallelization.
This module contains three parts: A parallel simulator implementation `multithreaded-simulator-impl`, an interface to users `mtp-interface`, and `logical-process` to represent LPs in terms of parallel simulation.

All LPs and threads are stored in the `mtp-interface`.
It controls the simulation progress, schedules LPs to threads and manages the lifecycles of LPs and threads.
The interface also provides some methods and options for users to tweak the simulation.

Each LP's logic is implemented in `logical-process`. It contains most of the methods of the default sequential simulator plus some auxiliary methods for parallel simulation.

The simulator implementation `multithreaded-simulator-impl` is a derived class from the base simulator.
It converts calls to the base simulator into calls to logical processes based on the context of the current thread.
It also provides a partition method for automatic fine-grained topology partition.

For distributed simulation with MPI, we added `hybrid-simulator-impl` in the `mpi` module (located at `src/mpi/model/hybrid-simulator-impl*`).
This simulator uses both `mtp-interface` and `mpi-interface` to coordinate local LPs and global MPI communications.
We also modified the module to make it locally thread-safe.

### 2. Modifications to ns-3 Architecture

In addition to the `mtp` and `mpi` modules, we also modified the following part of the ns-3 architecture to make it thread-safe, also with some bug fixing for ns-3.
You can find the modifications to each unison-enabled ns-3 version via `git diff unison-* ns-*`.

Modifications to the build system to provide `--enable-mtp` option to enable/disable Unison:

```
ns3                                                |    2 +
CMakeLists.txt                                     |    1 +
build-support/custom-modules/ns3-configtable.cmake |    3 +
build-support/macros-and-definitions.cmake         |   10 +
```

Modifications to the `core` module to make reference counting thread-safe:

```
src/core/CMakeLists.txt                            |    1 +
src/core/model/atomic-counter.h                    |   50 +
src/core/model/hash.h                              |   16 +
src/core/model/object.cc                           |    2 +
src/core/model/simple-ref-count.h                  |   11 +-
```

Modifications to the `network` module to make packets thread-safe:

```
src/network/model/buffer.cc                        |   15 +-
src/network/model/buffer.h                         |    7 +
src/network/model/byte-tag-list.cc                 |   14 +-
src/network/model/node.cc                          |    7 +
src/network/model/node.h                           |    7 +
src/network/model/packet-metadata.cc               |   26 +-
src/network/model/packet-metadata.h                |   14 +-
src/network/model/packet-tag-list.h                |   11 +-
src/network/model/socket.cc                        |    6 +
```

Modifications to the `internet` module to make it thread-safe and add per-flow ECMP routing:

```
src/internet/model/global-route-manager-impl.cc    |    2 +
src/internet/model/ipv4-global-routing.cc          |   32 +-
src/internet/model/ipv4-global-routing.h           |    8 +-
src/internet/model/ipv4-packet-info-tag.cc         |    2 +
src/internet/model/ipv6-packet-info-tag.cc         |    2 +
src/internet/model/tcp-option.cc                   |    2 +-
```

Modifications to the `flow-monitor` module to make it thread-safe:

```
src/flow-monitor/model/flow-monitor.cc             |   48 +
src/flow-monitor/model/flow-monitor.h              |    4 +
src/flow-monitor/model/ipv4-flow-classifier.cc     |   12 +
src/flow-monitor/model/ipv4-flow-classifier.h      |    5 +
src/flow-monitor/model/ipv4-flow-probe.cc          |    2 +
src/flow-monitor/model/ipv6-flow-classifier.cc     |   12 +
src/flow-monitor/model/ipv6-flow-classifier.h      |    5 +
src/flow-monitor/model/ipv6-flow-probe.cc          |    2 +
```

Modifications to the `nix-vector-routing` module to make it thread-safe:

```
src/nix-vector-routing/model/nix-vector-routing.cc |   92 ++
src/nix-vector-routing/model/nix-vector-routing.h  |    8 +
```

Modifications to the `mpi` module to make it thread-safe with the hybrid simulator:

```
src/mpi/model/granted-time-window-mpi-interface.cc |   25 +
src/mpi/model/granted-time-window-mpi-interface.h  |    7 +
src/mpi/model/mpi-interface.cc                     |    3 +-
```

### 3. Logging

The reason behind Unison's fast speed is that it divides the network into multiple logical processes (LPs) with fine granularity and schedules them dynamically.
To get to know more details of such workflow, you can enable the following log component:

```c++
LogComponentEnable("LogicalProcess", LOG_LEVEL_INFO);
LogComponentEnable("MultithreadedSimulatorImpl", LOG_LEVEL_INFO);
```

### 4. Advanced Options

These options can be modified at the beginning of the `main` function using the native config syntax of ns-3.

You can also change the default maximum number of threads by setting

```c++
Config::SetDefault("ns3::MultithreadedSimulatorImpl::MaxThreads", UintegerValue(8));
Config::SetDefault("ns3::HybridSimulatorImpl::MaxThreads", UintegerValue(8));
```

The automatic partition will cut off stateless links whose delay is above the threshold.
The threshold is automatically calculated based on the delay of every link.
If you are not satisfied with the partition results, you can set a custom threshold by setting

```c++
Config::SetDefault("ns3::MultithreadedSimulatorImpl::MinLookahead", TimeValue(NanoSeconds(500));
Config::SetDefault("ns3::HybridSimulatorImpl::MinLookahead", TimeValue(NanoSeconds(500));
```

The scheduling method determines the priority (estimated completion time of the next round) of each logical process.
There are five available options:

- `ByExecutionTime`: LPs with a higher execution time of the last round will have higher priority.
- `ByPendingEventCount`: LPs with more pending events of this round will have higher priority.
- `ByEventCount`: LPs with more pending events of this round will have higher priority.
- `BySimulationTime`: LPs with larger current clock time will have higher priority.
- `None`: Do not schedule. The partition's priority is based on their ID.

Many experiments show that the first one usually leads to better performance.
However, you can still choose one according to your taste by setting

```c++
GlobalValue::Bind("PartitionSchedulingMethod", StringValue("ByExecutionTime"));
```

By default, the scheduling period is 2 when the number of partitions is less than 16, 3 when it is less than 256, 4 when it is less than 4096, etc.
Since more partitions lead to more scheduling costs.
You can also set how frequently scheduling occurs by setting

```c++
GlobalValue::Bind("PartitionSchedulingPeriod", UintegerValue(4));
```

## Links

If you find the code useful, please consider citing our paper (coming soon).
Below are some links that may also be helpful to you:

- [ns-3 Tutorial](https://www.nsnam.org/docs/tutorial/html/index.html)
- [ns-3 Model Library](https://www.nsnam.org/docs/models/html/index.html)
- [ns-3 Manual](https://www.nsnam.org/docs/manual/html/index.html)
