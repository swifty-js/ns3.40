#!/bin/bash
set -e

DOCS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DOCS_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[BUILD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

clean_aux() {
	local dir="${1:-.}"
	rm -f "$dir"/*.aux "$dir"/*.log "$dir"/*.out "$dir"/*.toc \
		"$dir"/*.bbl "$dir"/*.blg "$dir"/*.lof "$dir"/*.lot \
		"$dir"/*.fls "$dir"/*.fdb_latexmk "$dir"/*.synctex.gz
	find "$dir" -maxdepth 2 -name '*.aux' -delete 2>/dev/null || true
}

# xelatex × 2（无 bibtex，两遍解决交叉引用）
build_simple() {
	local tex="$1"
	local name="${tex%.tex}"
	log "编译 $tex ..."
	xelatex -interaction=nonstopmode -halt-on-error "$tex" >/dev/null 2>&1 || {
		err "$tex 第1遍失败，查看 $name.log"
		return 1
	}
	xelatex -interaction=nonstopmode -halt-on-error "$tex" >/dev/null 2>&1 || {
		err "$tex 第2遍失败，查看 $name.log"
		return 1
	}
	log "$name.pdf ✓"
}

# xelatex → bibtex → xelatex × 2
build_with_bib() {
	local tex="$1"
	local name="${tex%.tex}"
	log "编译 $tex（含 BibTeX）..."
	xelatex -interaction=nonstopmode -halt-on-error "$tex" >/dev/null 2>&1 || {
		err "$tex 第1遍失败"
		return 1
	}
	bibtex "$name" >/dev/null 2>&1 || warn "bibtex $name 有警告"
	xelatex -interaction=nonstopmode -halt-on-error "$tex" >/dev/null 2>&1 || {
		err "$tex 第2遍失败"
		return 1
	}
	xelatex -interaction=nonstopmode -halt-on-error "$tex" >/dev/null 2>&1 || {
		err "$tex 第3遍失败"
		return 1
	}
	log "$name.pdf ✓"
}

usage() {
	echo "用法: $0 <目标...>"
	echo ""
	echo "  njupt    编译 NJUPT 毕业论文 (含 BibTeX)"
	echo "  zh       编译中文会议论文 thesis.zh.tex"
	echo "  en       编译英文会议论文 thesis.en.tex"
	echo "  all      编译以上全部"
	echo "  clean    清理编译辅助文件"
}

do_build() {
	case "$1" in
	njupt)
		local njupt_dir="$DOCS_DIR/NJUPT_Professional_Thesis_draft1"
		cd "$njupt_dir"
		build_with_bib NJUPT_Professional_Thesis_d1.tex
		cd "$DOCS_DIR"
		;;
	zh) build_simple thesis.zh.tex ;;
	en) build_simple thesis.en.tex ;;
	all)
		for t in njupt zh en; do
			do_build "$t"
		done
		;;
	clean)
		log "清理辅助文件..."
		clean_aux "$DOCS_DIR"
		clean_aux "$DOCS_DIR/NJUPT_Professional_Thesis_draft1"
		clean_aux "$DOCS_DIR/NJUPT_Professional_Thesis_draft1/chapters"
		log "清理完成 ✓"
		;;
	*)
		err "未知目标: $1"
		usage
		return 1
		;;
	esac
}

if [ $# -eq 0 ]; then
	usage
	exit 0
fi

for target in "$@"; do
	do_build "$target"
done

log "全部完成 ✓"
