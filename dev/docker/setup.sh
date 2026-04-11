#!/bin/bash
# First-time setup for the containerized OpenClaw dev environment.
# Reads LLM_PROVIDER from .env to determine which auth flow to run.
#
# Usage: npm run docker:setup
#        bash dev/docker/setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OPENCLAW_HOME="$REPO_ROOT/dev/openclaw-home"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}▸${NC} $1"; }
warn()  { echo -e "${YELLOW}▸${NC} $1"; }
error() { echo -e "${RED}▸${NC} $1" >&2; }

# ── Pre-flight checks ────────────────────────────────────────────────────────

if ! command -v docker &>/dev/null; then
  error "Docker is not installed. Install Docker Desktop first."
  exit 1
fi

if ! docker info &>/dev/null 2>&1; then
  error "Docker is not running. Start Docker Desktop first."
  exit 1
fi

# ── .env file ─────────────────────────────────────────────────────────────────

if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn "Created $ENV_FILE from .env.example"
    warn "Edit dev/docker/.env — set LLM_PROVIDER and the matching API key, then re-run."
    exit 1
  else
    error "No .env.example found. Cannot continue."
    exit 1
  fi
fi

# Source .env to read values
set -a
source "$ENV_FILE"
set +a

LLM_PROVIDER="${LLM_PROVIDER:-codex}"

# ── Validate provider + key ──────────────────────────────────────────────────

case "$LLM_PROVIDER" in
  codex)
    MODEL="openai-codex/gpt-5.4"
    info "LLM provider: Codex (ChatGPT subscription via OAuth)"
    ;;
  openai)
    MODEL="openai/gpt-5.4"
    if [ -z "${OPENAI_API_KEY:-}" ]; then
      error "LLM_PROVIDER=openai but OPENAI_API_KEY is empty in dev/docker/.env"
      exit 1
    fi
    info "LLM provider: OpenAI API"
    ;;
  anthropic)
    MODEL="anthropic/claude-sonnet-4-20250514"
    if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
      error "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty in dev/docker/.env"
      exit 1
    fi
    info "LLM provider: Anthropic"
    ;;
  *)
    error "Unknown LLM_PROVIDER: $LLM_PROVIDER (expected: codex, openai, or anthropic)"
    exit 1
    ;;
esac

info "Default model: $MODEL"

# ── Generate gateway token if not set ─────────────────────────────────────────

if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  OPENCLAW_GATEWAY_TOKEN="bakin-dev-$(openssl rand -hex 16)"
  if grep -q "^OPENCLAW_GATEWAY_TOKEN=" "$ENV_FILE" 2>/dev/null; then
    sed -i '' "s|^OPENCLAW_GATEWAY_TOKEN=.*|OPENCLAW_GATEWAY_TOKEN=$OPENCLAW_GATEWAY_TOKEN|" "$ENV_FILE"
  else
    echo "OPENCLAW_GATEWAY_TOKEN=$OPENCLAW_GATEWAY_TOKEN" >> "$ENV_FILE"
  fi
  info "Generated gateway token and saved to .env"
fi

# ── Create openclaw-home directory ────────────────────────────────────────────

if [ -d "$OPENCLAW_HOME" ]; then
  info "openclaw-home/ already exists, skipping directory creation"
else
  info "Creating dev/openclaw-home/..."
  mkdir -p "$OPENCLAW_HOME"
fi

# ── Pull image ────────────────────────────────────────────────────────────────

info "Pulling OpenClaw Docker image..."
docker compose -f "$COMPOSE_FILE" pull openclaw-gateway

# ── Start gateway ─────────────────────────────────────────────────────────────

info "Starting OpenClaw gateway..."
docker compose -f "$COMPOSE_FILE" up -d openclaw-gateway

# ── Configure via non-interactive commands (skip interactive onboarding) ──────

info "Running non-interactive onboarding..."
docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T --entrypoint node openclaw-gateway \
  dist/index.js onboard --mode local --no-install-daemon </dev/null || {
  warn "Onboarding returned non-zero (may already be onboarded). Continuing..."
}

info "Configuring gateway for local access..."
docker compose -f "$COMPOSE_FILE" run --rm -T --no-deps --entrypoint node openclaw-gateway \
  dist/index.js config set --batch-json \
  '[{"path":"gateway.mode","value":"local"},{"path":"gateway.bind","value":"lan"},{"path":"gateway.controlUi.allowedOrigins","value":["http://localhost:18789","http://127.0.0.1:18789"]}]' || {
  warn "Config set returned non-zero. Continuing..."
}

# ── Seed config + inject keys ─────────────────────────────────────────────────

OPENCLAW_JSON="$OPENCLAW_HOME/openclaw.json"

if command -v node &>/dev/null; then
  info "Configuring model and injecting API keys..."
  ANTHROPIC_KEY="${ANTHROPIC_API_KEY:-}" OPENAI_KEY="${OPENAI_API_KEY:-}" \
  GW_TOKEN="${OPENCLAW_GATEWAY_TOKEN}" DEFAULT_MODEL="$MODEL" \
  OC_HOME="$OPENCLAW_HOME" OC_JSON="$OPENCLAW_JSON" \
  node -e '
    const fs = require("fs");

    const ocJson = process.env.OC_JSON;
    const ocHome = process.env.OC_HOME;
    const gwToken = process.env.GW_TOKEN;
    const defaultModel = process.env.DEFAULT_MODEL;
    const anthropicKey = process.env.ANTHROPIC_KEY;
    const openaiKey = process.env.OPENAI_KEY;

    // Read or create config
    let config = {};
    try { config = JSON.parse(fs.readFileSync(ocJson, "utf-8")); } catch {}

    // Set gateway token
    if (!config.gateway) config.gateway = {};
    if (!config.gateway.auth) config.gateway.auth = {};
    config.gateway.auth.token = gwToken;

    // Set default model
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.model) config.agents.defaults.model = {};
    config.agents.defaults.model.primary = defaultModel;

    fs.writeFileSync(ocJson, JSON.stringify(config, null, 2));

    // Inject API keys into auth-profiles.json (only for key-based providers)
    if (anthropicKey || openaiKey) {
      const authDir = ocHome + "/agents/main/agent";
      const authPath = authDir + "/auth-profiles.json";
      fs.mkdirSync(authDir, { recursive: true });
      let profiles = { profiles: [] };
      try { profiles = JSON.parse(fs.readFileSync(authPath, "utf-8")); } catch {}
      if (!profiles.profiles) profiles.profiles = [];

      function upsertProfile(provider, apiKey) {
        if (!apiKey) return;
        const existing = profiles.profiles.find(p => p.provider === provider);
        if (existing) {
          existing.apiKey = apiKey;
        } else {
          profiles.profiles.push({ provider, apiKey });
        }
      }

      upsertProfile("anthropic", anthropicKey);
      upsertProfile("openai", openaiKey);

      fs.writeFileSync(authPath, JSON.stringify(profiles, null, 2));
    }
  ' || warn "Config injection failed — you may need to configure manually."
fi

# ── Restart gateway to pick up config changes ────────────────────────────────

info "Restarting gateway with updated config..."
docker compose -f "$COMPOSE_FILE" restart openclaw-gateway

# ── Wait for health check ────────────────────────────────────────────────────

info "Waiting for gateway to be healthy..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:18789/healthz >/dev/null 2>&1; then
    info "Gateway is healthy!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    error "Gateway did not become healthy after 30s. Check: docker compose -f dev/docker/docker-compose.yml logs"
    exit 1
  fi
  sleep 1
done

# ── Codex OAuth (only when LLM_PROVIDER=codex) ───────────────────────────────

if [ "$LLM_PROVIDER" = "codex" ]; then
  AUTH_PROFILES="$OPENCLAW_HOME/agents/main/agent/auth-profiles.json"
  AUTH_BACKUP="$SCRIPT_DIR/auth-profiles.backup.json"
  HAS_CODEX=false

  if [ -f "$AUTH_PROFILES" ] && grep -q "openai-codex" "$AUTH_PROFILES" 2>/dev/null; then
    HAS_CODEX=true
  fi

  # Try restoring from backup
  if [ "$HAS_CODEX" = false ] && [ -f "$AUTH_BACKUP" ]; then
    info "Restoring Codex OAuth from backup..."
    mkdir -p "$(dirname "$AUTH_PROFILES")"
    cp "$AUTH_BACKUP" "$AUTH_PROFILES"
    HAS_CODEX=true
  fi

  # No backup — run OAuth flow
  if [ "$HAS_CODEX" = false ]; then
    echo ""
    info "Codex OAuth required. Running auth flow..."
    echo ""
    echo "  A URL will appear — open it in your browser and authorize."
    echo "  The callback page won't load (that's expected)."
    echo "  Copy the URL from your browser's address bar and paste it back here."
    echo ""

    docker run --rm -it -p 1455:1455 \
      -v "$OPENCLAW_HOME:/home/node/.openclaw" \
      ghcr.io/openclaw/openclaw:latest \
      node dist/index.js models auth login --provider openai-codex || {
      warn "Codex OAuth did not complete. You can run it later:"
      echo ""
      echo "  docker run --rm -it -p 1455:1455 \\"
      echo "    -v \"\$(pwd)/dev/openclaw-home:/home/node/.openclaw\" \\"
      echo "    ghcr.io/openclaw/openclaw:latest \\"
      echo "    node dist/index.js models auth login --provider openai-codex"
      echo ""
    }

    # Restart gateway to pick up OAuth token
    docker compose -f "$COMPOSE_FILE" restart openclaw-gateway
    sleep 3
  else
    info "Codex OAuth already configured — skipping."
  fi

  # Register the OAuth profile in openclaw.json so the gateway knows to use it
  if [ -f "$AUTH_PROFILES" ] && grep -q "openai-codex" "$AUTH_PROFILES" 2>/dev/null && command -v node &>/dev/null; then
    OC_JSON="$OPENCLAW_JSON" node -e '
      const fs = require("fs");
      const p = process.env.OC_JSON;
      const config = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (!config.auth) config.auth = {};
      if (!config.auth.profiles) config.auth.profiles = {};
      // Extract profile key from auth-profiles.json
      const authPath = p.replace("openclaw.json", "agents/main/agent/auth-profiles.json");
      try {
        const auth = JSON.parse(fs.readFileSync(authPath, "utf-8"));
        const profiles = auth.profiles || {};
        for (const [key, val] of Object.entries(profiles)) {
          if (val.provider === "openai-codex") {
            config.auth.profiles[key] = { provider: "openai-codex", mode: "oauth" };
          }
        }
      } catch {}
      fs.writeFileSync(p, JSON.stringify(config, null, 2));
    '
    info "Registered Codex OAuth profile in openclaw.json"

    # Restart to pick up the auth config
    docker compose -f "$COMPOSE_FILE" restart openclaw-gateway
    sleep 3
  fi

  # Back up auth profiles for next time
  if [ -f "$AUTH_PROFILES" ] && grep -q "openai-codex" "$AUTH_PROFILES" 2>/dev/null; then
    cp "$AUTH_PROFILES" "$AUTH_BACKUP"
    info "Backed up Codex OAuth to dev/docker/auth-profiles.backup.json"
  fi
fi

# ── Discord (optional) ────────────────────────────────────────────────────────

if [ -n "${DISCORD_BOT_TOKEN:-}" ]; then
  info "Configuring Discord bot..."

  # Wire the token, enable Discord, and configure guild allowlist
  GUILD_ID="${DISCORD_GUILD_ID:-}" USER_ID="${DISCORD_USER_ID:-}" \
  OC_JSON="$OPENCLAW_JSON" node -e '
    const fs = require("fs");
    const p = process.env.OC_JSON;
    const guildId = process.env.GUILD_ID;
    const userId = process.env.USER_ID;
    const config = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (!config.channels) config.channels = {};
    config.channels.discord = {
      enabled: true,
      token: { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" }
    };

    // Configure guild allowlist if server ID provided
    if (guildId) {
      config.channels.discord.groupPolicy = "allowlist";
      if (!config.channels.discord.guilds) config.channels.discord.guilds = {};
      const guild = { requireMention: false };
      if (userId) guild.users = [userId];
      config.channels.discord.guilds[guildId] = guild;
    }

    fs.writeFileSync(p, JSON.stringify(config, null, 2));
  '

  # Restart to connect the bot
  docker compose -f "$COMPOSE_FILE" restart openclaw-gateway
  sleep 5

  # Auto-approve pairing if code is provided
  if [ -n "${DISCORD_PAIRING_CODE:-}" ]; then
    info "Approving Discord pairing code..."
    docker compose -f "$COMPOSE_FILE" run --rm -T openclaw-cli pairing approve discord "$DISCORD_PAIRING_CODE" || {
      warn "Pairing approval failed — code may be expired or already used."
    }
  else
    echo ""
    warn "Discord bot is online but not paired yet."
    echo ""
    echo "  Next steps:"
    echo "  1. DM the bot on Discord — it will reply with a pairing code"
    echo "  2. Add the code to dev/docker/.env:"
    echo "       DISCORD_PAIRING_CODE=<the code>"
    echo "  3. Re-run: npm run docker:setup"
    echo ""
    echo "  This is a one-time step. After pairing, the connection persists"
    echo "  across restarts. Only a full reset (rm -rf dev/openclaw-home)"
    echo "  requires re-pairing."
    echo ""
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
info "Setup complete! Run Bakin with:"
echo ""
echo "  npm run dev:docker"
echo ""
info "To stop OpenClaw:"
echo ""
echo "  npm run docker:down"
echo ""
