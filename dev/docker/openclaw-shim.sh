#!/bin/bash
# CLI shim: routes openclaw commands into the Docker container.
# Used as OPENCLAW_PATH so Bakin's execFile() calls work transparently.
#
# Bakin runs on the host and builds openclaw paths from the host openclaw-home
# (e.g. --workspace /…/dev/openclaw-home/workspaces/pixel), but the CLI executes
# in the container where that home is /home/node/.openclaw. Translate the host
# prefix → the container path in every arg so path-passing commands (agents add,
# etc.) work; the bind mount keeps both views in sync.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER_HOME="/home/node/.openclaw"

HOST_HOME=""
if [ -d "$SCRIPT_DIR/../openclaw-home" ]; then
  HOST_HOME="$(cd "$SCRIPT_DIR/../openclaw-home" && pwd)"
fi

args=()
for arg in "$@"; do
  if [ -n "$HOST_HOME" ]; then
    args+=("${arg//$HOST_HOME/$CONTAINER_HOME}")
  else
    args+=("$arg")
  fi
done

docker compose -f "$SCRIPT_DIR/docker-compose.yml" run --rm -T openclaw-cli "${args[@]}"
