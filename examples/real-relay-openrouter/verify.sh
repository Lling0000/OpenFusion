#!/usr/bin/env sh
set -eu

OPENFUSION_BIN="${OPENFUSION_BIN:-openfusion}"
OPENFUSION_CONFIG="${OPENFUSION_CONFIG:-examples/real-relay-openrouter/openfusion.config.example.json}"
OPENFUSION_PORT="${OPENFUSION_PORT:-8787}"
OPENFUSION_BASE_URL="${OPENFUSION_BASE_URL:-http://127.0.0.1:${OPENFUSION_PORT}/v1}"
OPENFUSION_MODEL="${OPENFUSION_MODEL:-openfusion/fusion}"
OPENFUSION_BASELINE_ROLE="${OPENFUSION_BASELINE_ROLE:-fast}"
OPENFUSION_UPSTREAM_KEY_ENV="${OPENFUSION_UPSTREAM_KEY_ENV:-OPENROUTER_API_KEY}"
OPENFUSION_LOCAL_KEY="${OPENFUSION_LOCAL_KEY:-openfusion-local-placeholder}"

case "$OPENFUSION_UPSTREAM_KEY_ENV" in
  ""|*[!ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_]*)
    echo "OPENFUSION_UPSTREAM_KEY_ENV must be an environment variable name."
    exit 1
    ;;
esac

eval "OPENFUSION_UPSTREAM_KEY_VALUE=\${$OPENFUSION_UPSTREAM_KEY_ENV:-}"

if [ -z "$OPENFUSION_UPSTREAM_KEY_VALUE" ]; then
  echo "Missing $OPENFUSION_UPSTREAM_KEY_ENV."
  echo "Set a real OpenRouter key first, for example:"
  echo "  export $OPENFUSION_UPSTREAM_KEY_ENV=\"...\""
  exit 1
fi

echo "OpenFusion real OpenRouter verification"
echo "Config: $OPENFUSION_CONFIG"
echo "Local URL: $OPENFUSION_BASE_URL"
echo "Baseline role: $OPENFUSION_BASELINE_ROLE"
echo
echo "This script makes real upstream calls through your configured OpenRouter role models."
echo

sh -c "$OPENFUSION_BIN doctor --real --config '$OPENFUSION_CONFIG'"
sh -c "$OPENFUSION_BIN compare --config '$OPENFUSION_CONFIG' --baseline-role '$OPENFUSION_BASELINE_ROLE'"
sh -c "$OPENFUSION_BIN adapter codex --config '$OPENFUSION_CONFIG' --port '$OPENFUSION_PORT'"

server_pid=""
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

env "$OPENFUSION_UPSTREAM_KEY_ENV=$OPENFUSION_UPSTREAM_KEY_VALUE" \
  OPENFUSION_API_KEY="$OPENFUSION_LOCAL_KEY" \
  sh -c "$OPENFUSION_BIN serve --config '$OPENFUSION_CONFIG' --port '$OPENFUSION_PORT'" &
server_pid="$!"

sleep 2

OPENFUSION_API_KEY="$OPENFUSION_LOCAL_KEY" \
  sh -c "$OPENFUSION_BIN doctor --probe-url '$OPENFUSION_BASE_URL' --probe-model '$OPENFUSION_MODEL'"

echo
echo "Real OpenRouter verification completed."
echo "Use $OPENFUSION_BASE_URL with model $OPENFUSION_MODEL from Codex or any OpenAI-compatible client."
