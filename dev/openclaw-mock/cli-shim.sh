#!/usr/bin/env bash
# OpenClaw CLI shim — delegates to the Node.js mock handler.
# Installed by the mock orchestrator at $OPENCLAW_HOME/bin/openclaw
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOCK_DIR="$(cd "$SCRIPT_DIR/../../dev/openclaw-mock" 2>/dev/null && pwd)"
if [ -z "$MOCK_DIR" ]; then
  # Fallback: resolve relative to the repo root via the shim location
  MOCK_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/dev/openclaw-mock"
fi
exec npx tsx "$MOCK_DIR/cli-shim.ts" "$@"
