#!/bin/bash
# CLI shim: routes openclaw commands into the Docker container.
# Used as OPENCLAW_PATH so Bakin's execFile() calls work transparently.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
docker compose -f "$SCRIPT_DIR/docker-compose.yml" run --rm -T openclaw-cli "$@"
