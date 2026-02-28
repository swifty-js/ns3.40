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

conda create -p ./.venv python=3.13
conda activate ./.venv

./ns3 configure --enable-mtp --enable-examples
./ns3 build

pip3 install --user ./contrib/opengym/model/ns3gym

./ns3 run "rl-tcp --transport_prot=TcpRl" &> ./logs/rl-tcp-ns3.log
python ./contrib/opengym/examples/rl-tcp/test_tcp.py --start=0 &> ./logs/rl-tcp-agent.log

./ns3 run "lark-tcp --transport_prot=TcpLark" &> ./logs/lark-tcp-ns3.log
python ./contrib/opengym/examples/lark-tcp/test_lark.py --start=0 &> ./logs/lark-tcp-agent.log
python ./contrib/opengym/examples/lark-tcp/test_lark.py --start=0 --verbose &> ./logs/lark-tcp-agent.log

./ns3 run "lark-tcp --transport_prot=TcpNewReno" &> ./logs/lark-tcp-new-reno.log
```

## References

- [ns-3 Tutorial](https://www.nsnam.org/docs/tutorial/html/index.html)
- [ns-3 Model Library](https://www.nsnam.org/docs/models/html/index.html)
- [ns-3 Manual](https://www.nsnam.org/docs/manual/html/index.html)
