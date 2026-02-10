.DEFAULT_GOAL=help
# =============================================================================
# 全局配置参数
# =============================================================================
DURATION := 20                                       # 仿真持续时间 (秒)
N_LEAF := 3                                          # 哑铃拓扑每侧叶子节点数 (即并发 TCP 流数)
SIM_SEED := 42                                       # 仿真随机种子，保证实验可复现

# =============================================================================
# Git 版本管理
# =============================================================================
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

# =============================================================================
# 构建与清理
# =============================================================================
.PHONY: clean
clean: ## Remove ./build ./cmake-cache ./.lock-ns3* and caches
	rm -rf ./build ./cmake-cache \
	./.idea ./.cache ./.mypy_cache ./.ruff_cache ./.lock-ns3*

.PHONY: format
format: ## Format code
	# C/C++ 代码格式化 (clang-format)
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
	# Python 代码格式化 (ruff)
	ruff format ./
	# Shell 脚本格式化 (shfmt)，-r 避免无文件时报错
	find . -name "*.sh" -not -path "./.venv/*" | xargs -r shfmt -l -w
	# Markdown / JSON / YAML 等格式化 (prettier)
	prettier -w ./

.PHONY: build
build: ## Configure and build ns-3
	# 激活 Python 虚拟环境 (conda 或 venv)
	@conda activate ./.venv 2>/dev/null || source ./.venv/bin/activate 2>/dev/null || true
	# 配置 ns-3：启用 MTP 多线程并行仿真 + 示例程序
	@./ns3 configure --enable-mtp --enable-examples >/dev/null 2>&1
	# 编译 ns-3 全部模块
	@./ns3 build 2>/dev/null 2>&1
	# 创建日志输出目录
	@mkdir -p ./logs/comparison ./logs/comparison-udp ./logs/summary ./logs/plots ./logs/plots-udp

.PHONY: setup
setup: build ## Setup and build ns-3

.PHONY: kill
kill: ## Kill all ns3 lark processes
	pkill -f "ns3.40-lark-t" && echo "Killed all ns3 lark processes" || true

# =============================================================================
# 仿真运行 (通过 main.py 驱动)
# =============================================================================
.PHONY: compare
compare: build ## Run comparison across multiple protocols (no UDP burst)
	python ./main.py sim --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

.PHONY: compare-udp
compare-udp: build ## Run comparison across multiple protocols (with UDP burst)
	python ./main.py sim --udp --duration $(DURATION) --n-leaf $(N_LEAF) --sim-seed $(SIM_SEED)

# =============================================================================
# 绘图与汇总 (通过 main.py 驱动)
# =============================================================================
.PHONY: draw
draw: ## Generate plots from logs
	python ./main.py draw

.PHONY: summary
summary: ## Generate summary CSV report (TCP)
	python ./main.py summary

.PHONY: summary-udp
summary-udp: ## Generate summary CSV report (UDP)
	python ./main.py summary --udp

.PHONY: all
all: compare ## Run all simulations

# =============================================================================
# 帮助信息: 自动提取所有带 ## 注释的目标并格式化输出
# =============================================================================
.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	cut -d ":" -f1- | \
	awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'
