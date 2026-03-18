# Lark (ns3.40)

## Makefile

```txt
$ make help
clean   Remove ./build ./cmake-cache ./logs ./.lock-ns3* and caches
build   Build ns3, enable mtp and examples
```

## Build from source

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
pip3 install matplotlib

./ns3 run "rl-tcp --transport_prot=TcpRl" &> ./logs/rl-tcp-ns3.log
python ./contrib/opengym/examples/rl-tcp/test_tcp.py --start=0 &> ./logs/rl-tcp-agent.log

./ns3 run "lark-tcp --transport_prot=TcpLark" &> ./logs/lark-tcp-ns3.log
python ./contrib/opengym/examples/lark-tcp/test_lark.py --start=0 &> ./logs/lark-tcp-agent.log
python ./contrib/opengym/examples/lark-tcp/test_lark.py --start=0 --verbose &> ./logs/lark-tcp-agent.log

./ns3 run "lark-tcp --transport_prot=TcpNewReno" &> ./logs/lark-tcp-new-reno.log
```

## Useful commands

```bash
git fetch origin tag ns-3.40
git switch -c dev ns-3.40

find . -type f -not -name "*.rst" -not -name "*.md" -delete
find . -name "*.rst" -exec sh -c 'mv "$1" "${1%.rst}.md"' sh {} \;
find . -depth -type d -empty -delete

ln -s ./.github/skills ./.trae/skills
```
