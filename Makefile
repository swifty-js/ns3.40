.DEFAULT_GOAL=help
DURATION := 20
N_LEAF := 3
SIM_SEED := 42
.PHONY: feat
feat: ## Introduce new features
	git add -A
	git commit -m "feat: Introduce new features"
	git push origin main

.PHONY: init
init: ## Initial commit
	rm -rf ./.git
	git init
	git remote add origin git@github.com:tianchenghang/ns3.40.git
	git add -A
	git commit -m "Initial commit"
	git push -f origin main --set-upstream

.PHONY: clean
clean: ## Remove ./build ./cmake-cache ./.lock-ns3* and caches
	rm -rf ./build ./cmake-cache \
	./.cache ./.mypy_cache ./.ruff_cache ./.lock-ns3*

.PHONY: format
format: ## Format code
	bash ./format.sh

.PHONY: build
build: ## Configure and build ns-3
	test -d ./.venv || conda create -p ./.venv python=3.13
	conda activate ./.venv || source ./.venv/bin/activate || true
	./ns3 configure --enable-mtp --enable-examples
	./ns3 build

.PHONY: kill
kill: ## Kill all ns3 lark processes
	pkill -f "ns3.40-lark-t" && echo "Killed all ns3 lark processes" || true

.PHONY: tcp
tcp: build ## Run comparison across multiple protocols (no UDP burst)
	python ./main.py sim --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: udp
udp: build ## Run comparison across multiple protocols (with UDP burst)
	python ./main.py sim --udp --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: gen
gen:
    # Generate plots (TCP + UDP)
	python ./main.py draw
    # Generate summary CSV report (TCP + UDP)
	python ./main.py summary

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	cut -d ":" -f1- | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
