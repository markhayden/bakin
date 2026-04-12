# Bakin

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

The server auto-creates a `~/.bakin/` directory on first run with default settings and required subdirectories.

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
| `BAKIN_URL` | `http://localhost:3737` | Used by the CLI to reach the server |

---

## Architecture

```
bakin/
├── server.ts              # Custom HTTP server (Next.js + API routes + subsystems)
├── bakin.config.ts         # Plugin configuration
├── cli/bakin.ts            # CLI tool
├── skill/SKILL.md          # OpenClaw skill (agent instructions)
├── src/
│   ├── app/                # Next.js pages (dashboard UI)
│   ├── core/               # Backend subsystems
│   │   ├── settings.ts     # Centralized settings (~/.bakin/settings.json)
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
│   │   ├── mcp-server.ts       # MCP tool server (Streamable HTTP + SSE)
│   │   ├── discord-gateway.ts  # Discord WebSocket gateway (interaction buttons)
│   │   ├── migrations.ts       # Plugin data migrations
│   │   └── plugin-installer.ts # Plugin install/remove
│   ├── lib/                # Shared utilities (plugin system, storage, event bus)
│   ├── components/         # React components
│   └── context/            # React context providers
├── plugins/                # Plugin packages
│   ├── tasks/              # Kanban task management
│   ├── workflows/          # Workflow execution engine
│   ├── assets/             # Asset management
│   ├── projects/           # Project tracking
│   ├── schedule/           # Cron job scheduling
│   ├── messaging/          # Content calendar + brainstorm
│   ├── memory/             # Audit logs + agent workspaces
│   ├── models/             # AI model configuration
│   ├── team/               # Agent team management
│   └── health/             # System health dashboard
├── scripts/lib/            # MCP exec tools (self-registering)
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
| **File Watcher** | Monitors `~/.bakin/` for changes, broadcasts SSE events | Real-time |
| **SSE** | Real-time event stream to dashboard clients | 30s keepalive |

All subsystems shut down gracefully on SIGTERM/SIGINT.

---

## Plugins

Plugins are configured in `bakin.config.ts` and loaded at startup. Each plugin can register API routes, navigation items, exec tools, and event handlers.

| Plugin | Description | Key Routes |
|--------|-------------|------------|
| **tasks** | Kanban board with drag-and-drop | `/api/plugins/tasks/` (CRUD + move, log, block) |
| **workflows** | Workflow execution engine with gates | `/api/plugins/workflows/` |
| **assets** | Asset management with sidecar metadata | `/api/plugins/assets/` |
| **projects** | Project tracking with checklists | `/api/plugins/projects/` |
| **schedule** | Cron job scheduling | `/api/plugins/schedule/` |
| **messaging** | Content calendar + brainstorm sessions | `/api/plugins/messaging/` |
| **memory** | Audit log viewer + agent workspaces | `/api/plugins/memory/` |
| **models** | Agent model assignments | `/api/plugins/models/` |
| **team** | Agent team management (OpenClaw adapter) | `/api/plugins/team/` |
| **health** | System health dashboard | `/api/plugins/health/` |

---

## API

Bakin exposes a REST API on the same port as the dashboard. Full documentation is:

- **Auto-generated** at startup → written to `~/.bakin/docs/API.md`
- **Served as JSON** at `GET /api/docs`
- **Viewable in the CLI** via `bakin docs`

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
| `POST` | `/mcp` | MCP tool server (Streamable HTTP + SSE) |

API docs are regenerated automatically every time the server starts.

---

## CLI

The `bakin` CLI wraps the HTTP API for terminal use. All commands hit `http://localhost:3737` (or `$BAKIN_URL`).

```bash
# System
bakin status                        # Health overview
bakin doctor                        # Run health checks
bakin dispatch                      # Trigger task dispatch

# Tasks
bakin tasks list                    # All tasks
bakin tasks list --column=todo      # Filter by column
bakin tasks create "Fix the bug"    # Create task
bakin tasks move abc123 done        # Move task

# Agents
bakin agents list                   # All agents + status
bakin agents status patch           # Detailed status
bakin agents tasks patch            # Tasks for agent
bakin agents send patch "Hey"       # Message an agent

# Settings
bakin settings get                  # All settings
bakin settings get dispatch.intervalMs
bakin settings set watchdog.stuckThresholdMs 3600000

# Plugins
bakin plugins list                  # Installed plugins
bakin plugins install ./my-plugin   # Install from path
bakin plugins install github:user/repo  # Install from GitHub
bakin plugins remove my-plugin      # Remove plugin

# Search & Docs
bakin search "runway video"                    # Search all indexed content
bakin search "tacos" --table=content           # Filter by table
bakin search "deploy fix" --agent=patch        # Filter by agent
bakin search "photos" --table=content --limit=5  # Combine filters
bakin docs                                     # Print API docs
bakin reindex                                  # Reindex content to Antfly
```

---

## Doctor

Bakin Doctor runs on startup and every 30 minutes to keep systems healthy. It performs 6 checks:

| Check | Auto-Fix? | Description |
|-------|-----------|-------------|
| **agent-roster** | No | Verifies Bakin agents match OpenClaw config |
| **personas** | Yes | Creates stub persona files for missing agents |
| **taskboard** | No | Validates OpenClaw `flow_runs` SQLite is accessible |
| **skill** | Yes | Installs/updates the Bakin skill in OpenClaw |
| **gateway** | No | Pings the OpenClaw gateway |
| **antfly** | No | Verifies Antfly connection when enabled |

**Auto-fix policy:**
- **Safe** (auto-fix): Creating files/directories, installing the Bakin skill
- **Unsafe** (notify): Roster mismatches, gateway down, task DB issues — issues requiring human judgment are reported to roscoe via OpenClaw

Run manually: `bakin doctor` or `GET /api/plugins/health/doctor?fresh=true`

---

## OpenClaw Skill

Bakin includes a skill file at `skill/SKILL.md` that teaches OpenClaw agents how to interact with Bakin. The skill covers task lifecycle rules, required API calls, logging requirements, and content locations.

Doctor automatically installs this skill to `~/.openclaw/workspace/skills/bakin/` and keeps it in sync as you update it. Verify with:

```bash
openclaw skills list
```

---

## Antfly (Vector Search)

[AntflyDB](https://antfly.dev) provides hybrid search (full-text BM25 + semantic vector) across all content. Bakin works without it — file-only mode is the default. When enabled, Bakin auto-manages the entire lifecycle: installs the binary, starts the server, creates tables with embeddings, indexes content, and stops it on shutdown.

### Quick Setup

```bash
bakin setup antfly    # Install binary + enable + reindex (one command)
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

# Enable in Bakin
bakin settings set antfly.enabled true

# Restart Bakin (Antfly auto-starts, creates tables, waits for shards)
npm run dev

# Backfill existing content
bakin reindex
```

### How It Works

- **Auto-start:** Bakin spawns `antfly swarm` as a child process on boot (port 8080)
- **Auto-stop:** Killed gracefully on Bakin shutdown (SIGTERM, force after 5s)
- **Auto-tables:** 7 tables created on first run — tasks, assets, projects, workflows, schedule, team, audit
- **Multimodal indexing:** Text content indexed via BAAI/bge-small-en-v1.5, image content via OpenAI CLIP (clip-vit-base-patch32), both running locally through Antfly's Termite ML subsystem. The assets table uses two embedding indexes side by side (`assets_text` + `assets_visual`) so text and visual queries hit the right modality automatically.
- **Server-side content extraction:** PDFs and text formats (.md, .txt, .json, .csv, .yaml) are extracted to a `content` field in Bakin before indexing — pdf-parse handles PDFs, fs.readFileSync handles plain text. See `.claude/knowledge/multimodal-search.md` for the pipeline.
- **Cross-encoder reranker:** Single-modality tables get a post-retrieval rerank pass via mxbai-rerank-base-v1 for sharper relevance. Multimodal tables (assets) skip reranking — see `search-system.md` for why.
- **Schema migration:** Bumping `SCHEMA_VERSION` in `src/core/search-migration.ts` drops and recreates all bakin_* tables on next boot, with background reindex. Embedder and schema changes happen transparently.
- **Dual-write sync:** File watcher indexes content to Antfly on every write
- **Fire-and-forget:** All indexing is non-blocking with exponential-backoff retries on transient shard-startup errors — file writes succeed even if Antfly is down
- **External Antfly:** If Antfly is already running on port 8080 (started externally), Bakin detects it and skips spawning a child process

For the full architecture see `.claude/knowledge/search-system.md`. For the multimodal pipeline specifically see `.claude/knowledge/multimodal-search.md`.

### What Gets Indexed

| Table | Source | Indexed When |
|-------|--------|-------------|
| `bakin_tasks` | Completed tasks | On move to Done |
| `bakin_audit` | `audit.jsonl` | On every audit event |
| `bakin_assets` | Generated assets | On create |
| `bakin_projects` | Project files | On file write |
| `bakin_workflows` | Workflow instances | On state change |
| `bakin_schedule` | Scheduled jobs | On create/update |
| `bakin_team` | Agent profiles | On profile change |

### Search

```bash
bakin search "runway video clips"                   # All tables
bakin search "landscape shots" --table=assets        # Single table
bakin search "deploy fix" --agent=patch              # By agent
bakin search "portraits" --table=assets --limit=20   # Combined filters

# API
curl "http://localhost:3737/api/search?q=runway+video&table=assets&agent=pixel&limit=5"
```

### Antfly Dashboard

When running, Antfly serves its own dashboard at `http://localhost:11433` for inspecting tables, shards, and indexes directly.

---

## Settings

All configuration lives in `~/.bakin/settings.json`. Created with defaults on first run. Update via API or CLI.

```bash
bakin settings get                  # View all
bakin settings set dispatch.intervalMs 600000   # 10 min dispatch
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

Bakin communicates with the OpenClaw gateway via HTTP (not CLI exec). The gateway runs on port `18789` by default.

- **Send messages to agents:** `POST /v1/chat/completions`
- **Invoke tools:** `POST /tools/invoke`
- **Channel messages (Discord):** CLI fallback for channel routing

Configure the gateway connection:

```bash
bakin settings set openclaw.gatewayUrl http://127.0.0.1
bakin settings set openclaw.gatewayPort 18789
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

- **TypeScript strict mode** with path aliases (`@/` → `src/`, `@bakin/*` → `plugins/*`)
- **Hybrid storage** — tasks in OpenClaw SQLite, decisions and content as files in `~/.bakin/`
- **Plugin architecture** — extend via `plugins/` directory and `bakin.config.ts`
- **Structured audit logging** — all state changes logged to `~/.bakin/audit.jsonl`
- **OpenClaw HTTP client** — no CLI exec; all agent communication goes through the gateway API

---

## License

MIT
