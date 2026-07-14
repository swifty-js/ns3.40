.DEFAULT_GOAL=help
DURATION := 20
N_LEAF := 3
SIM_SEED := 42
.PHONY: feat
feat:
	git add -A
	git commit -m "feat: Introduce new features"
	git push origin main

.PHONY: init
init:
	rm -rf ./.git
	git init
	git remote add origin git@github.com:tianchenghang/ns3.40.git
	git add -A
	git commit -m "Initial commit"
	git push -f origin main --set-upstream

.PHONY: clean
clean:
	rm -rf ./build ./cmake-cache \
	./.cache ./.mypy_cache ./.ruff_cache ./.lock-ns3*

.PHONY: format
format:
	bash ./format.sh

.PHONY: build
build:
	test -d ./.venv || conda create -p ./.venv python=3.13
	conda activate ./.venv || source ./.venv/bin/activate || true
	./ns3 configure --enable-mtp --enable-examples
	./ns3 build

.PHONY: kill
kill:
	pkill -f "ns3.40-swift-t" && echo "Killed all ns3 swift processes" || true

.PHONY: tcp
tcp: build
	python ./main.py sim --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: udp
udp: build
	python ./main.py sim --udp --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: gen
gen:
	python ./main.py draw
	python ./main.py summary
