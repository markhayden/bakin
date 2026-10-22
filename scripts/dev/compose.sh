#!/bin/bash
# ONE entrypoint for `docker compose` against the dev rig's compose file.
# The image build pins bun to the repo's `.bun-version` (compose interpolates
# `${BUN_VERSION:?}` on EVERY parse, including `down`), so every caller must
# derive it: `bun run docker:up|down`, `bun run instance`, and the OpenClaw CLI
# shim all route through this export.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export BUN_VERSION="${BUN_VERSION:-$(tr -d '[:space:]' < "$REPO_ROOT/.bun-version")}"
exec docker compose -f "$REPO_ROOT/dev/docker/docker-compose.yml" "$@"
