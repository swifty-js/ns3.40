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
	./.idea ./.cache ./.mypy_cache ./.ruff_cache ./.lock-ns3*

.PHONY: format
format: ## Format code
	find ./build-support ./contrib ./examples ./src ./scratch ./utils -name "*.h" \
	-o -name "*.c" \
	-o -name "*.hh" \
	-o -name "*.cc" \
	-o -name "*.hpp" \
	-o -name "*.cpp" \
	-o -name "*.h++" \
	-o -name "*.c++" \
	-o -name "*.hxx" \
	-o -name "*.cxx" | xargs clang-format -i
	# pip install ruff
	ruff format ./
	# go install mvdan.cc/sh/v3/cmd/shfmt@latest
	find . -name "*.sh" -not -path "./.venv/*" | xargs -r shfmt -l -w
	# pnpm add @biomejs/biome -g
	biome format --write --vcs-enabled=true \
	--vcs-client-kind=git \
	--vcs-use-ignore-file=true \
	--files-ignore-unknown=true ./

.PHONY: build
build: ## Configure and build ns-3
	@conda activate ./.venv 2>/dev/null || source ./.venv/bin/activate 2>/dev/null || true
	@./ns3 configure --enable-mtp --enable-examples >/dev/null 2>&1
	@./ns3 build 2>/dev/null 2>&1
	@mkdir -p ./logs/comparison ./logs/comparison-udp ./logs/summary ./logs/plots ./logs/plots-udp

.PHONY: setup
setup: build ## Setup and build ns-3

.PHONY: kill
kill: ## Kill all ns3 lark processes
	pkill -f "ns3.40-lark-t" && echo "Killed all ns3 lark processes" || true

.PHONY: compare
compare: build ## Run comparison across multiple protocols (no UDP burst)
	python ./main.py sim --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: compare-udp
compare-udp: build ## Run comparison across multiple protocols (with UDP burst)
	python ./main.py sim --udp --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: draw
draw: ## Generate plots from logs
	python ./main.py draw

.PHONY: summary
summary: ## Generate summary CSV report (TCP + UDP)
	python ./main.py summary

.PHONY: all
all: compare ## Run all simulations

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	cut -d ":" -f1- | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
