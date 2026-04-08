#!/usr/bin/env bash
# OpenClaw CLI shim — delegates to the Node.js mock handler.
# Installed by the mock orchestrator at $OPENCLAW_HOME/bin/openclaw
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOCK_DIR="$(cd "$SCRIPT_DIR/../../dev/imitation-crab" 2>/dev/null && pwd)"
if [ -z "$MOCK_DIR" ]; then
  # Fallback: resolve relative to the repo root via the shim location
  MOCK_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/dev/imitation-crab"
fi
exec npx tsx "$MOCK_DIR/cli-shim.ts" "$@"
