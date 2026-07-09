# Custom OpenClaw image for the Bakin dev rig.
#   - bun: run Bakin from source inside the sandbox container
#   (Bakin's MCP tools reach the agent via native mcp.servers entries that
#   Bakin provisions into the runtime config at boot — no bridge binary.)
#
# Used by all services (gateway/cli/sandbox). The Bakin repo is mounted at
# runtime, not copied, so the build context stays tiny.
# Pinned (#385 follow-up): `:latest` drifted 5 weeks stale unnoticed. Keep
# this tag matched to the production Mac mini's OpenClaw and bump both
# together (override per-run via OPENCLAW_IMAGE_TAG in dev/docker/.env).
ARG OPENCLAW_IMAGE_TAG=2026.6.11
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_IMAGE_TAG}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
  && bun --version
USER node
