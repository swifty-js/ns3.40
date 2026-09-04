# Swift (ns3.40)

- [Hang Tiancheng](https://github.com/hangtiancheng)

## Build

```bash
sudo apt update && sudo apt full-upgrade
sudo apt install libzmq5 libzmq3-dev libprotobuf-dev protobuf-compiler
sudo apt autoclean && sudo apt autoremove

uv sync --no-install-project
source .venv/bin/activate
./ns3 configure --enable-mtp --enable-examples
./ns3 build
uv pip install ./contrib/opengym/model/ns3gym

./ns3 run "rl-tcp --transport_prot=TcpRl" &> ./logs/rl-tcp-ns3.log
python ./contrib/opengym/examples/rl-tcp/test_tcp.py --start=0 &> ./logs/rl-tcp-agent.log

./ns3 run "swift-tcp --transport_prot=TcpSwift" &> ./logs/swift-tcp-ns3.log
python ./contrib/opengym/examples/swift-tcp/test_swift.py --start=0 &> ./logs/swift-tcp-agent.log
python ./contrib/opengym/examples/swift-tcp/test_swift.py --start=0 --verbose &> ./logs/swift-tcp-agent.log

./ns3 run "swift-tcp --transport_prot=TcpNewReno" &> ./logs/swift-tcp-new-reno.log
```

## Install

```bash
# Linux (Debian/Ubuntu)
sudo apt install -y texlive-full
# MacOS
brew install --cask mactex

# https://github.com/be5invis/Sarasa-Gothic
brew install gnuplot
```
