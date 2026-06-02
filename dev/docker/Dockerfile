# Custom OpenClaw image for the Bakin dev rig.
#   - bun: run Bakin from source inside the sandbox container
#   - mcporter: the bridge that exposes Bakin's MCP tools to the agent (the
#     agent runs `mcporter call bakin-<agent>.<tool>`); installed as root so it
#     lands on PATH (the node user can't npm-i-g at runtime)
#
# Used by all services (gateway/cli/sandbox). The Bakin repo is mounted at
# runtime, not copied, so the build context stays tiny.
ARG OPENCLAW_IMAGE_TAG=latest
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_IMAGE_TAG}

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
  && bun --version \
  && npm install -g mcporter \
  && command -v mcporter
USER node
