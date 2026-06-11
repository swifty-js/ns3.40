#!/usr/bin/env bash

set -euo pipefail

git ls-files -z \
	'*.h' '*.c' \
	'*.hh' '*.cc' \
	'*.hpp' '*.cpp' \
	'*.hxx' '*.cxx' \
	'*.h++' '*.c++' |
	xargs -0 -r clang-format -i

# pip install ruff
ruff format ./

# go install mvdan.cc/sh/v3/cmd/shfmt@latest
git ls-files -z '*.sh' |
	xargs -0 -r shfmt -l -w

# pnpm add oxfmt -g
oxfmt --write ./
