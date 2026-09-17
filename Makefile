.DEFAULT_GOAL=help
DURATION := 20
N_LEAF := 3
SIM_SEED := 42
.PHONY: feat
feat:
	git add -A
	git commit -m "feat: Introduce new features"
	git push origin main

init:
	rm -rf ./.git
	git init
	git remote add origin git@github.com:swifty-js/ns3.40.git
	git add -A
	git commit -m "feat: Introduce new features"
	git push origin main -f --set-upstream

.PHONY: clean
clean:
	rm -rf ./build ./cmake-cache \
	./.cache ./.mypy_cache ./.ruff_cache ./.lock-ns3*

.PHONY: format
format:
	bash ./format.sh

.PHONY: build
build:
	./ns3 configure --enable-mtp --enable-examples
	./ns3 build

.PHONY: kill
kill:
	pkill -f "ns3.40-swift-t" && echo "Killed all ns3 swift processes" || true

.PHONY: tcp
tcp: build
	node ./main.js sim --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: udp
udp: build
	node ./main.js sim --udp --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: gen
gen:
	node ./main.js draw
	node ./main.js summary
