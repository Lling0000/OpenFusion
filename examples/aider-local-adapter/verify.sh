#!/usr/bin/env sh
set -eu

OPENFUSION_BIN="${OPENFUSION_BIN:-openfusion}"
OPENFUSION_BASE_URL="${OPENFUSION_BASE_URL:-http://127.0.0.1:8787/v1}"
OPENFUSION_MODEL="${OPENFUSION_MODEL:-openfusion/fusion}"

sh -c "$OPENFUSION_BIN adapter aider"
sh -c "$OPENFUSION_BIN doctor --probe-url $OPENFUSION_BASE_URL --probe-model $OPENFUSION_MODEL"
