# Beacon

Multi-agent mission control for [OpenClaw](https://openclaw.dev). A plugin-based dashboard and backend that coordinates AI agents — task management, content calendars, real-time activity feeds, health checks, and search.

Built with Next.js, TypeScript, and Tailwind CSS. Runs alongside the OpenClaw gateway.

---

## Quick Start

```bash
# Install dependencies
npm install

# Start the dev server (Next.js + custom backend on port 3737)
npm run dev

# Open the dashboard
open http://localhost:3737
```

The server auto-creates a `content/` directory on first run with default settings and required subdirectories.

### Mock Dev

For local development without a real OpenClaw install, use the Imitation Crab mock:

```bash
# Reseed the mock home with fresh fixtures
pnpm mock:seed --force

# Start the mock gateway and Bakin together
pnpm dev:mock
```

The mock seeds `~/.imitationcrab/` and uses it for both `BAKIN_HOME` and `OPENCLAW_HOME`.

If you want to start Bakin separately after reseeding:

```bash
BAKIN_HOME=~/.imitationcrab OPENCLAW_HOME=~/.imitationcrab OPENCLAW_PATH=~/.imitationcrab/bin/openclaw npm run dev
```

### CI Contract

The repo now uses a workspace-level CI contract built for monorepo growth:

- every app/package should define `lint`, `typecheck`, `test`, and `build` when those tasks apply
- pull requests run affected checks through Turbo
- pushes to `main` run the full workspace safety-net checks

Today the required CI lane focuses on `test` and `build`, while `lint` and `typecheck` remain available for packages that are ready to enforce them.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3737` | Server port |
| `BEACON_URL` | `http://localhost:3737` | Used by the CLI to reach the server |

---

## Architecture

```
beacon/
├── server.ts              # Custom HTTP server (Next.js + API routes + subsystems)
├── mc.config.ts            # Plugin configuration
├── cli/beacon.ts           # CLI tool
├── skill/SKILL.md          # OpenClaw skill (agent instructions)
├── src/
│   ├── app/                # Next.js pages (dashboard UI)
│   ├── core/               # Backend subsystems
│   │   ├── settings.ts     # Centralized settings (content/.beacon/settings.json)
│   │   ├── openclaw-client.ts  # HTTP client for OpenClaw gateway
│   │   ├── dispatch.ts     # Task dispatch loop
│   │   ├── watchdog.ts     # Stuck task detection + alerts
│   │   ├── doctor.ts       # Health checks, auto-repair, skill sync
│   │   ├── watcher.ts      # File watcher (chokidar) + Antfly sync
│   │   ├── sse.ts          # Server-Sent Events (real-time updates)
│   │   ├── antfly.ts       # Optional vector DB integration
│   │   ├── vault.ts        # Credential management
│   │   ├── audit.ts        # Structured audit logging
│   │   ├── logger.ts       # Structured logging
│   │   ├── calendar-cron.ts    # Scheduled content execution
│   │   ├── continuation.ts     # Task dependency resolution
│   │   ├── lifecycle.ts        # Graceful shutdown
│   │   ├── middleware.ts       # Request validation
│   │   ├── api-docs.ts         # Self-documenting API
│   │   ├── agents.ts           # Agent status + communication
│   │   ├── migrations.ts       # Plugin data migrations
│   │   └── plugin-installer.ts # Plugin install/remove
│   ├── lib/                # Shared utilities (plugin system, storage, event bus)
│   ├── components/         # React components
│   └── context/            # React context providers
├── plugins/                # Plugin packages
│   ├── tasks/              # Kanban task management
│   ├── calendar/           # Content calendar pipeline
│   ├── memory/             # Audit logs + agent workspaces
│   ├── models/             # AI model configuration
│   └── workflows/          # Workflow template library
├── content/                # Runtime data (auto-created)
│   ├── MEMORY-LOG.md       # Decision log
│   ├── calendar.json       # Calendar items
│   ├── audit.jsonl         # Audit trail
│   ├── .beacon/settings.json   # Settings
│   ├── team/personas/      # Agent personality files
│   ├── docs/API.md         # Auto-generated API docs
│   └── assets/             # Generated content (images, video, etc.)
└── tests/                  # Vitest test suites
```

### Subsystems

On startup, the server initializes these subsystems:

| Subsystem | Purpose | Default Interval |
|-----------|---------|-----------------|
| **Dispatch** | Assigns TODO tasks to agents via OpenClaw | 5 min |
| **Watchdog** | Detects stuck tasks, alerts via Discord | 5 min |
| **Doctor** | Health checks, auto-repair, skill sync | 30 min |
| **Calendar Cron** | Executes scheduled content items | 5 min |
| **File Watcher** | Monitors `content/` for changes, broadcasts SSE events | Real-time |
| **SSE** | Real-time event stream to dashboard clients | 30s keepalive |

All subsystems shut down gracefully on SIGTERM/SIGINT.

---

## Plugins

Plugins are configured in `mc.config.ts` and loaded at startup. Each plugin can register API routes, navigation items, and event handlers.

| Plugin | Description | Key Routes |
|--------|-------------|------------|
| **tasks** | Kanban board backed by OpenClaw `flow_runs` SQLite | `/api/plugins/tasks/` (CRUD + move, log, block) |
| **calendar** | Content pipeline (draft → published) | `/api/plugins/calendar/` |
| **memory** | Audit log viewer + agent workspace inspector | `/api/plugins/memory/audit`, `/workspace` |
| **models** | Agent model assignments + available models | `/api/plugins/models/*` |
| **workflows** | Reusable workflow templates | `/api/plugins/workflows/definitions`, `/steps/:taskId` |

---

## API

Beacon exposes a REST API on the same port as the dashboard. Full documentation is:

- **Auto-generated** at startup → written to `content/docs/API.md`
- **Served as JSON** at `GET /api/docs`
- **Viewable in the CLI** via `beacon docs`

### Core Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/events` | SSE event stream (file changes, task events, alerts) |
| `GET` | `/api/dispatch` | Dispatch timer state |
| `POST` | `/api/dispatch` | Trigger immediate dispatch |
| `GET` | `/api/settings` | Current settings |
| `POST` | `/api/settings` | Update settings (partial merge) |
| `GET` | `/api/agents` | List all agents with status |
| `GET` | `/api/agents/:id/status` | Detailed agent status |
| `POST` | `/api/agents/:id/message` | Send message to agent |
| `GET` | `/api/agents/:id/tasks` | Tasks assigned to agent |
| `GET` | `/api/plugins/health/doctor` | Run health checks (`?fresh=true` to force re-run) |
| `GET` | `/api/search` | Search indexed content (`?q=<query>&table=&agent=&limit=`) |
| `GET` | `/api/docs` | API documentation (JSON) |
| `POST` | `/api/reindex` | Reindex all content to Antfly |
| `POST` | `/api/plugins/install` | Install a plugin |
| `POST` | `/api/plugins/remove` | Remove a plugin |

API docs are regenerated automatically every time the server starts. No manual step needed.

---

## CLI

The `beacon` CLI wraps the HTTP API for terminal use. All commands hit `http://localhost:3737` (or `$BEACON_URL`).

```bash
# System
beacon status                        # Health overview
beacon doctor                        # Run health checks
beacon dispatch                      # Trigger task dispatch

# Tasks
beacon tasks list                    # All tasks
beacon tasks list --column=todo      # Filter by column
beacon tasks create "Fix the bug"    # Create task
beacon tasks move abc123 done        # Move task

# Agents
beacon agents list                   # All agents + status
beacon agents status patch           # Detailed status
beacon agents tasks patch            # Tasks for agent
beacon agents send patch "Hey"       # Message an agent

# Settings
beacon settings get                  # All settings
beacon settings get dispatch.intervalMs
beacon settings set watchdog.stuckThresholdMs 3600000

# Plugins
beacon plugins list                  # Installed plugins
beacon plugins install ./my-plugin   # Install from path
beacon plugins install github:user/repo  # Install from GitHub
beacon plugins remove my-plugin      # Remove plugin

# Search & Docs
beacon search "runway video"                    # Search all indexed content
beacon search "tacos" --table=content           # Filter by table
beacon search "deploy fix" --agent=patch        # Filter by agent
beacon search "photos" --table=content --limit=5  # Combine filters
beacon docs                                     # Print API docs
beacon reindex                                  # Reindex content to Antfly
```

---

## Doctor

Beacon Doctor runs on startup and every 30 minutes to keep systems healthy. It performs 6 checks:

| Check | Auto-Fix? | Description |
|-------|-----------|-------------|
| **agent-roster** | No | Verifies Beacon agents match OpenClaw config |
| **personas** | Yes | Creates stub persona files for missing agents |
| **taskboard** | No | Validates OpenClaw `flow_runs` SQLite is accessible |
| **skill** | Yes | Installs/updates the Beacon skill in OpenClaw |
| **gateway** | No | Pings the OpenClaw gateway |
| **antfly** | No | Verifies Antfly connection when enabled |

**Auto-fix policy:**
- **Safe** (auto-fix): Creating files/directories, installing the Beacon skill
- **Unsafe** (notify): Roster mismatches, gateway down, task DB issues — issues requiring human judgment are reported to main-operator via OpenClaw

Run manually: `beacon doctor` or `GET /api/plugins/health/doctor?fresh=true`

---

## OpenClaw Skill

Beacon includes a skill file at `skill/SKILL.md` that teaches OpenClaw agents how to interact with Beacon. The skill covers task lifecycle rules, required API calls, logging requirements, and content locations.

Doctor automatically installs this skill to `~/.openclaw/workspace/skills/beacon/` and keeps it in sync as you update it. Verify with:

```bash
openclaw skills list
```

---

## Antfly (Vector Search)

[AntflyDB](https://antfly.dev) provides hybrid search (full-text BM25 + semantic vector) across all content. Beacon works without it — file-only mode is the default. When enabled, Beacon auto-manages the entire lifecycle: installs the binary, starts the server, creates tables with embeddings, indexes content, and stops it on shutdown.

### Quick Setup

```bash
beacon setup antfly    # Install binary + enable + reindex (one command)
```

This will:
1. Install AntflyDB via Homebrew (`brew install --cask antflydb/antfly/antfly`)
2. Enable Antfly in settings
3. Start the Antfly server
4. Create all tables with full-text + embeddings indexes
5. Reindex existing content

### Manual Setup

If you prefer to set it up yourself:

```bash
# Install the binary
brew install --cask antflydb/antfly/antfly

# Enable in Beacon
beacon settings set antfly.enabled true

# Restart Beacon (Antfly auto-starts, creates tables, waits for shards)
npm run dev

# Backfill existing content
beacon reindex
```

### How It Works

- **Auto-start:** Beacon spawns `antfly swarm` as a child process on boot (port 8080)
- **Auto-stop:** Killed gracefully on Beacon shutdown (SIGTERM, force after 5s)
- **Auto-tables:** 5 tables created on first run with full-text + embeddings indexes
- **Embeddings:** Built-in all-MiniLM-L6-v2 model (384-dim, INT8-quantized) — no external model server needed
- **Dual-write sync:** File watcher indexes content to Antfly on every write
- **Fire-and-forget:** All indexing is non-blocking — file writes succeed even if Antfly is down
- **External Antfly:** If Antfly is already running on port 8080 (started externally), Beacon detects it and skips spawning a child process

### What Gets Indexed

| Table | Source | Indexed When |
|-------|--------|-------------|
| `beacon_tasks` | Completed tasks | On move to Done |
| `beacon_decisions` | `MEMORY-LOG.md` | On file write |
| `beacon_audit` | `audit.jsonl` | On every audit event |
| `beacon_content` | Project docs, personas, calendar | On file write |
| `beacon_assets` | Generated assets | On create |

### Search

```bash
beacon search "runway video clips"                   # All tables
beacon search "landscape shots" --table=content       # Single table
beacon search "deploy fix" --agent=patch              # By agent
beacon search "portraits" --table=assets --limit=20   # Combined filters

# API
curl "http://localhost:3737/api/search?q=runway+video&table=content&agent=pixel&limit=5"
```

### Antfly Dashboard

When running, Antfly serves its own dashboard at `http://localhost:11433` for inspecting tables, shards, and indexes directly.

---

## Settings

All configuration lives in `content/.beacon/settings.json`. Created with defaults on first run. Update via API or CLI.

```bash
beacon settings get                  # View all
beacon settings set dispatch.intervalMs 600000   # 10 min dispatch
```

Key defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `dispatch.intervalMs` | `300000` (5m) | Task dispatch interval |
| `dispatch.maxDispatched` | `500` | Max tasks in flight |
| `watchdog.stuckThresholdMs` | `1800000` (30m) | Alert if task has no progress |
| `doctor.intervalMs` | `1800000` (30m) | Health check interval |
| `doctor.autoFixSkill` | `true` | Auto-fix safe issues |
| `antfly.enabled` | `false` | Enable Antfly search |
| `sse.maxClients` | `50` | Max SSE connections |

---

## Testing

```bash
npm test                  # Run all tests
npm run test:watch        # Watch mode
npm run test:coverage     # With coverage report
```

Tests use [Vitest](https://vitest.dev) and cover core modules, plugins, library utilities, and selected React components. Test files are in `tests/`.

- `pnpm test` — full suite
- `pnpm test:components` — React component tests

Component tests live in `tests/components/**/*.test.tsx` and use a per-file `// @vitest-environment jsdom` annotation plus Testing Library.

---

## OpenClaw Communication

Beacon communicates with the OpenClaw gateway via HTTP (not CLI exec). The gateway runs on port `18789` by default.

- **Send messages to agents:** `POST /v1/chat/completions`
- **Invoke tools:** `POST /tools/invoke`
- **Channel messages (Discord):** CLI fallback for channel routing

Configure the gateway connection:

```bash
beacon settings set openclaw.gatewayUrl http://127.0.0.1
beacon settings set openclaw.gatewayPort 18789
```

---

## SSE (Real-Time Events)

The dashboard and external clients can subscribe to real-time events:

```bash
curl -N http://localhost:3737/api/events
```

Events include file changes, task updates, audit entries, activity logs, and system alerts. SSE supports reconnection via `Last-Event-ID` header with a 200-event replay buffer.

---

## Development

```bash
npm run dev       # Start dev server with hot reload
npm test          # Run tests
npm run lint      # Lint
npm run build     # Production build
```

### Project Conventions

- **TypeScript strict mode** with path aliases (`@/` → `src/`, `@mc/*` → `plugins/*`)
- **Hybrid storage** — tasks in OpenClaw SQLite, decisions and content as files in `~/.bakin/`
- **Plugin architecture** — extend via `plugins/` directory and `mc.config.ts`
- **Structured audit logging** — all state changes logged to `content/audit.jsonl`
- **OpenClaw HTTP client** — no CLI exec; all agent communication goes through the gateway API

---

## License

MIT
