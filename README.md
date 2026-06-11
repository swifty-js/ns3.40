# Lark (ns3.40)

- [Hang Tiancheng](https://github.com/hangtiancheng)

## Build

```bash
sudo apt update && sudo apt full-upgrade
sudo apt install libzmq5 libzmq3-dev libprotobuf-dev protobuf-compiler
sudo apt autoclean && sudo apt autoremove

# conda config --add channels conda-forge
conda create -p ./.venv python=3.13
conda activate ./.venv

./ns3 configure --enable-mtp --enable-examples
./ns3 build

pip3 install --user ./contrib/opengym/model/ns3gym
pip3 install matplotlib pandoc pdf2image pdfplumber pillow pypdf ruff

./ns3 run "rl-tcp --transport_prot=TcpRl" &> ./logs/rl-tcp-ns3.log
python ./contrib/opengym/examples/rl-tcp/test_tcp.py --start=0 &> ./logs/rl-tcp-agent.log

./ns3 run "lark-tcp --transport_prot=TcpLark" &> ./logs/lark-tcp-ns3.log
python ./contrib/opengym/examples/lark-tcp/test_lark.py --start=0 &> ./logs/lark-tcp-agent.log
python ./contrib/opengym/examples/lark-tcp/test_lark.py --start=0 --verbose &> ./logs/lark-tcp-agent.log

./ns3 run "lark-tcp --transport_prot=TcpNewReno" &> ./logs/lark-tcp-new-reno.log
```

## Install

```bash
# Linux (Debian/Ubuntu)
sudo apt install -y texlive-full
# MacOS
brew install --cask mactex

wget https://github.com/be5invis/Sarasa-Gothic/releases/download/v1.0.39/SarasaGothic-TTF-1.0.39.7z
```
