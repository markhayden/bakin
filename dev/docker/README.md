# Docker Dev Environment

Run OpenClaw in a Docker container so it's never exposed on your host network. Bakin runs natively on your Mac with full hot reload.

## Prerequisites

- Docker Desktop (or OrbStack)
- Bun >= 1.2.0

## First-Time Setup

```bash
# 1. Install dependencies
bun install

# 2. Create your .env and set your LLM provider
cp dev/docker/.env.example dev/docker/.env
# Edit dev/docker/.env — set LLM_PROVIDER and the matching API key (see below)

# 3. Run setup (pulls image, starts gateway, configures auth)
./cmd/setup
# For Codex: walks you through OAuth in your browser
# For OpenAI/Anthropic: injects the API key automatically

# 4. Start Bakin
./cmd/start
```

Open http://localhost:3737 — that's Bakin.
Open http://127.0.0.1:18789 — that's the OpenClaw dashboard (use gateway token from `.env` to connect).

## Daily Workflow

```bash
./cmd/start               # Start OpenClaw container + Bakin
# Ctrl+C to stop Bakin
./cmd/stop                # Stop OpenClaw container
```

## Onboarding Test Instances

Use isolated Bakin homes when you want to replay first-run onboarding without touching `~/.bakin/`.

```bash
bun run instance:repo:reset
bun run instance:repo:onboard
bun run instance:repo:start
```

`repo` runs the CLI from this checkout. `installed` runs the `bakin` executable on `PATH`, which is the closer Homebrew/release smoke test:

```bash
bun run instance:installed:reset
bun run instance:installed:onboard
bun run instance:installed:start
```

Both modes share the Docker OpenClaw runtime in `dev/openclaw-home/`, but keep separate Bakin data under `dev/bakin-instances/<mode>/home/`.

For repeatable scripted onboarding, use the non-interactive aliases:

```bash
bun run instance:repo:onboard:yes
bun run instance:installed:onboard:yes
```

The base aliases pass through to `cmd/bakin-instance`, so you can inspect or run arbitrary commands in either profile:

```bash
bun run instance:repo -- path
bun run instance:repo -- env
bun run instance:repo -- shell
bun run instance:repo -- run doctor
```

Equivalent lower-level form:

```bash
./cmd/bakin-instance repo onboard --yes --json
./cmd/bakin-instance installed start
```

## LLM Provider Options

Set `LLM_PROVIDER` in `dev/docker/.env`:

| `LLM_PROVIDER` | Key needed | Model | Notes |
|-----------------|------------|-------|-------|
| `codex` (default) | *(none — OAuth)* | `openai-codex/gpt-5.4` | Uses ChatGPT Plus/Pro subscription. Setup runs OAuth flow automatically. |
| `openai` | `OPENAI_API_KEY` | `openai/gpt-5.4` | Direct API access, requires credits on platform.openai.com |
| `anthropic` | `ANTHROPIC_API_KEY` | `anthropic/claude-sonnet-4-20250514` | Claude models |

Setup validates the right key is present and sets the default model automatically.

## All Dev Modes

| Command | OpenClaw | Best for |
|---------|----------|----------|
| `npm run dev:docker` | Containerized (real) | Integration testing, agent work |
| `npm run dev:mock` | Imitation Crab (mock) | UI development, offline, zero API cost |
| `npm run dev` | Native install | Production-like (requires OpenClaw installed) |

## Commands

```bash
./cmd/setup               # First-time setup
./cmd/start               # Start OpenClaw + Bakin
./cmd/stop                # Stop OpenClaw
./cmd/restart             # Restart OpenClaw + Bakin
./cmd/wipe                # Full reset (wipes state, restores auth from backup)
./cmd/logs                # Tail gateway logs (./cmd/logs 100 for more lines)
./cmd/bakin-instance      # Isolated Bakin onboarding-test instances
```

Bun scripts are available for the common paths (`bun run docker:setup`, `bun run instance:repo:start`, `bun run instance:installed:onboard`, etc.).

## How It Works

```
Host (your Mac)
  Bakin (native, port 3737)
    ├── HTTP → localhost:18789 ──→ Docker container
    ├── CLI  → openclaw-shim.sh ──→ docker compose run
    └── FS   → dev/openclaw-home/ ←→ container bind mount

Docker container (bakin-openclaw-gateway)
  OpenClaw gateway (:18789, bound to 127.0.0.1 only)
  /home/node/.openclaw/ (shared volume)
```

- **HTTP**: Gateway port published to `127.0.0.1:18789` (not exposed to network)
- **CLI**: A shim script (`dev/docker/openclaw-shim.sh`) routes `execFile('openclaw', ...)` calls into the container via `docker compose run`
- **Filesystem**: `dev/openclaw-home/` is bind-mounted into the container. Both Bakin and OpenClaw read/write the same files.

## Discord Bot (optional)

One-time setup:

1. Create a bot at https://discord.com/developers/applications
2. Under **Bot** → enable **Message Content Intent**
3. Under **OAuth2** → check **bot** scope → check permissions: Send Messages, Attach Files, Read Message History, Manage Messages (integer: **108544**)
4. Copy the invite URL and add the bot to your server

Then in `dev/docker/.env`:
```bash
DISCORD_BOT_TOKEN=your-bot-token-here
DISCORD_GUILD_ID=your-server-id        # right-click server → Copy Server ID
DISCORD_USER_ID=your-user-id           # right-click yourself → Copy User ID
```

Run `./cmd/setup` — the bot comes online automatically.

**Pairing:** DM the bot on Discord. It replies with a code. Add it to `.env` and re-run setup:
```bash
DISCORD_PAIRING_CODE=the-code-from-dm
```
```bash
./cmd/setup   # auto-approves the pairing
```

## Troubleshooting

**Gateway not healthy**: `docker logs bakin-openclaw-gateway --tail 30`

**Agent not responding**: Check LLM auth — `cat dev/openclaw-home/agents/main/agent/auth-profiles.json`

**Quota errors in logs**: Your API key may not have credits. Set `LLM_PROVIDER=codex` in `.env` and re-run setup to use your ChatGPT subscription instead.

**Reset everything (fresh start)**: `./cmd/wipe` — wipes OpenClaw state, restores OAuth from backup, re-runs setup. Prompts for confirmation.
