#!/usr/bin/env bash
# python-sdk-check: packages/sdk/python ruff lint and format, mypy, pytest with coverage.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
ci_tools python
cd packages/sdk/python

ci_step "pip install -e .[dev]"
# A throwaway venv, so nothing is installed into the cached interpreter.
python3 -m venv "$CI_TMP/venv"
export PATH="$CI_TMP/venv/bin:$PATH" PIP_DISABLE_PIP_VERSION_CHECK=1
pip install -e ".[dev]"

ci_step "ruff check"
ruff check .

ci_step "ruff format --check"
ruff format --check .

ci_step "mypy"
mypy bugwatch/

ci_step "pytest"
pytest --cov=bugwatch --cov-report=term-missing
