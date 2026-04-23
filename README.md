# Bakin

Multi-agent mission control for [OpenClaw](https://openclaw.dev). A self-hosted dashboard + backend that coordinates AI agents — tasks, workflows, asset management, scheduling, content calendars, memory observability, and hybrid full-text + semantic search — all driven by markdown files on the filesystem and pushed to the browser over Server-Sent Events.

Built on [Bun](https://bun.sh) end to end: runtime, bundler, package manager, and binary compiler. Distributed as a single-file executable (~69 MB on macOS arm64) with every core plugin and static asset embedded. Runs alongside the OpenClaw gateway on a Mac mini, accessed over Tailscale.

---

## Install

**One-liner (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/madeinwyo/bakin/main/install.sh | bash
```

Detects your platform (Mac arm64, Linux x64, Linux arm64), verifies the sha256 against the release's `checksums.txt`, and drops the binary at `/usr/local/bin/bakin` (or `~/.local/bin` fallback).

**Manual install:**

Grab the binary for your platform from [releases](https://github.com/madeinwyo/bakin/releases), `chmod +x`, and put it on your PATH.

**Self-update:**

```bash
bakin update
```

Replaces the running binary with the latest release. Uses the same sha256 verification as `install.sh`.

---

## First-time setup

```bash
bakin onboard
```

Walks you through creating `~/.bakin/`, seeding `settings.json`, checking for the OpenClaw binary + config, installing AntflyDB + Termite ML models, syncing mcporter, and verifying at least one LLM provider and one messaging channel. Writes `~/.bakin/.onboarded` so `bakin doctor` knows the machine is ready.

For CI or scripted installs:

```bash
bakin onboard --yes --json
```

Individual commands for piecemeal use:

| Command | Purpose |
|---|---|
| `bakin mkdir` | Create/verify the `~/.bakin/` directory tree |
| `bakin settings init` | Seed default `settings.json` |
| `bakin check openclaw` | Detect OpenClaw binary + config |
| `bakin check llm` | Verify at least one LLM provider |
| `bakin check channels` | Verify at least one messaging channel |
| `bakin check all` | Run every check, report each |
| `bakin install antfly` | Install AntflyDB via Homebrew |
| `bakin install models` | Download Termite ML models (~1.5 GB) |
| `bakin install mcporter` | Install mcporter + sync per-agent config |

## Start the server

```bash
bakin start        # foreground (Ctrl-C to stop)
bakin stop         # SIGTERM a running bakin process
bakin status       # dispatch + server + doctor status
```

Server listens on port **3737** by default (`PORT=` to override). Open `http://localhost:3737` in a browser.

---

## Architecture

```
server.ts                  HTTP entry. Node's http.createServer under Bun's
                           node-compat; dispatches to Web Fetch-style
                           handlers at packages/host/src/api/**.

packages/
  core/                    @bakin/core — shared types + utilities (content-dir
                           resolver, logger, settings, vault, hook registry,
                           OpenClaw path + config helpers).
  sdk/                     @bakin/sdk — the plugin-author surface. Sub-paths
                           @bakin/sdk/{ui,hooks,components,slots,types,utils}.
                           Published to npm at release time.
  host/                    @bakin/host — React 19 shell built with Bun.build,
                           TanStack Router routes under packages/host/src/
                           routes/, Web Fetch API handlers under
                           packages/host/src/api/**, and the runtime plugin
                           loader at packages/host/src/plugin-host/.

plugins/                   10 core plugins (tasks, workflows, assets, projects,
                           schedule, messaging, memory, models, team, health).
                           Each compiles to plugins/<id>/dist/{index.js,
                           client.js}; both are embedded in the binary.

src/
  core/                    Server-side subsystems with side effects (MCP
                           server, dispatch, watchdog, doctor, file watcher,
                           SSE broadcaster, audit log, CLI dispatcher,
                           onboarding steps, self-update).
  lib/                     Shared, side-effect-free code (plugin registry,
                           storage adapter, event bus, markdown parsers).

scripts/                   Build + infrastructure (build-vendors, build-
                           plugins, build-binary, generate-embedded-assets,
                           publish-sdk). `lib/` holds self-registering MCP
                           exec tools (log progress, gen_image, post_discord,
                           heartbeat, get_paths).

cli/                       Thin legacy CLI wrapper. Most commands go through
                           src/core/cli.ts inside the compiled binary.

dev/imitation-crab/        OpenClaw mock — seeds ~/.imitationcrab/ with
                           fixtures and runs a mock gateway on :18789 for
                           local dev without a real OpenClaw install.
```

### Runtime data (`~/.bakin/`)

Created on first run. Per-installation state, never in the repo.

```
~/.bakin/
  settings.json            Runtime config (dispatch, watchdog, antfly, alerts)
  plugin-settings/<id>.json Per-plugin settings
  plugins/<id>/            Installed user plugins (source + compiled dist/)
  agents/<id>/             UI data (avatars)
  assets/, projects/,      Plugin-owned markdown + sidecars
  workflows/, schedule/,
  team/, heartbeats/
  MEMORY-LOG.md            Agent memory log
  audit.jsonl              Append-only audit trail
  logs/server.log          Rotating server log
```

### Subsystems

On boot:

| Subsystem | Purpose | Interval |
|---|---|---|
| **Dispatch** | Assigns TODO tasks to agents via OpenClaw | 5 min |
| **Watchdog** | Detects stuck tasks + MCP outages, alerts via Discord | 5 min |
| **Doctor** | Health checks + safe auto-repair | 30 min |
| **File Watcher** | `~/.bakin/` chokidar, syncs to Antfly, broadcasts SSE | Real-time |
| **SSE** | Real-time event stream to the dashboard | 30 s keepalive |
| **MCP Server** | Tool server (Streamable HTTP + SSE) for agents | n/a |

All shut down gracefully on SIGTERM/SIGINT.

---

## Plugins

Every plugin ships as a source tree with a `bakin-plugin.json` manifest, an `index.ts` (server entry: `BakinPlugin` with `activate(ctx: PluginContext)`), and a `client.tsx` (browser entry: one `registerPlugin({ id, navItems, slots })` call). User plugins are built on install via `bun build` inside the Bakin binary; core plugins are pre-built at release time and embedded.

| Plugin | Purpose |
|---|---|
| **tasks** | Kanban board with drag-and-drop, backed by SQLite via `bun:sqlite` |
| **workflows** | Workflow execution engine with gates + xyflow canvas |
| **assets** | Asset management with sidecar metadata, month-sharded storage |
| **projects** | Project tracking with checklists |
| **schedule** | Cron jobs bridged into OpenClaw |
| **messaging** | Content calendar + brainstorm planning sessions |
| **memory** | Read-only observability over all 7 OpenClaw memory tiers + Bakin audit log (one unified `bakin_memory` table) |
| **models** | Agent ↔ model assignments with curated catalog |
| **team** | Agent team management (OpenClaw adapter layer) |
| **health** | System health dashboard |

See [`docs/plugin-authoring.md`](./docs/plugin-authoring.md) for authoring a plugin end to end, and [`.claude/knowledge/plugin-system.md`](./.claude/knowledge/plugin-system.md) for the deep reference.

### Managing plugins

```bash
bakin plugins list                          # installed plugins + versions
bakin plugins install ./my-plugin           # from local path
bakin plugins install github:user/repo      # from GitHub
bakin plugins remove my-plugin              # refuses to remove core plugins
bakin plugins scaffold <name>               # starter plugin at ./<name>/
```

---

## CLI reference

Most commands hit the local HTTP API (`http://localhost:3737` or `$BAKIN_URL`). Lifecycle commands (`start`, `stop`, `restart`, `dev`) operate on the server itself.

```bash
# System
bakin start                            # boot the server
bakin stop                             # graceful shutdown
bakin restart                          # stop + start
bakin dev                              # watch-mode dev loop (HMR) — source-tree only
bakin status                           # dispatch + server + doctor status
bakin version                          # print version
bakin update                           # replace binary with latest release
bakin doctor                           # run health checks
bakin dispatch                         # trigger task dispatch now
bakin logs                             # tail audit log
bakin logs mcp                         # filter by type
bakin paths                            # content directory paths

# Tasks
bakin tasks list [--column=<col>]
bakin tasks create "Fix the bug"
bakin tasks move <id> done
bakin tasks log <id> "progress"
bakin tasks block <id> "reason"
bakin tasks complete <id> "done"

# Workflows
bakin workflows list
bakin workflows start <taskId> <workflowId>
bakin workflows step <taskId>
bakin workflows submit <taskId> <stepId> '{...}'

# Agents
bakin agents list
bakin agents status <agent>
bakin agents tasks <agent>
bakin agents send <agent> "Hey"
bakin agent-rules --check | --apply

# Schedule
bakin schedule [add|pause|resume|run|runs|remove]

# Messaging
bakin messaging create "Title" <agent> --channels=discord
bakin messaging approve <id>
bakin messaging sessions
bakin messaging session-create <agent> "Topic"
bakin messaging confirm <sessionId>

# Assets
bakin trash [list|restore|empty]

# Settings
bakin settings get [key]
bakin settings set <key> <value>

# Search + docs
bakin search "runway video"
bakin search "shots" --table=assets --agent=patch --limit=20
bakin search:stats
bakin docs
bakin reindex [--table=<t> --rebuild]

# Service (macOS)
bakin setup service [--uninstall]
```

---

## REST API

Self-documenting: written to `~/.bakin/docs/API.md` on boot and served as JSON at `GET /api/docs`.

Core endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/events` | SSE event stream (file changes, tasks, audit, alerts) |
| `GET` | `/api/version` | Server version |
| `GET`/`POST` | `/api/dispatch` | Dispatch state / trigger dispatch |
| `GET`/`POST` | `/api/settings` | Settings (partial-merge on POST) |
| `GET` | `/api/paths?key=<k>` | Content directory paths |
| `GET` | `/api/agents` | List agents with status |
| `GET` | `/api/agents/:id/{status,tasks}` | Per-agent data |
| `POST` | `/api/agents/:id/message` | Send a message to an agent |
| `GET` | `/api/agents/avatar?id=<agent>` | Avatar image |
| `GET` | `/api/search` | Full-text + semantic search (`?q=&table=&agent=&limit=&facets=`) |
| `POST` | `/api/reindex` | Reindex content to Antfly |
| `GET` | `/api/plugins/manifest` | Plugin manifest for the runtime loader |
| `GET` | `/api/plugins/:id/assets/:path*` | Serve a plugin's compiled client bundle |
| `POST` | `/mcp` | MCP tool server (Streamable HTTP + SSE) |

Each plugin can register additional routes under `/api/plugins/:id/*`.

---

## Doctor

`bakin doctor` runs on startup and every 30 minutes. Checks cluster across:

| Category | Checks | Auto-fix? |
|---|---|---|
| **Infrastructure** | content-dir, gateway, antfly, search-tables, service | Mixed |
| **Agents** | roster, personas, orchestrator-rules, mcporter, managed blocks | Mixed |
| **Tasks** | taskboard, consistency, order integrity, skill exec tools | Mixed |
| **Workflows** | skill-sync, definitions, instances, workflow-skills | Yes |
| **Content** | assets, schedule-sync | No |

**Safe** (auto-fix): creating missing dirs/files, syncing skills + rules, cleaning stale workflow instances.
**Unsafe** (notify): roster mismatches, gateway down, taskDB inconsistencies — reported to OpenClaw as alerts.

Run manually: `bakin doctor` or `GET /api/plugins/health/doctor?fresh=true`.

---

## Search (Antfly)

[AntflyDB](https://antfly.dev) provides hybrid search (full-text BM25 + semantic vector) across every plugin's content. Enabled by default. Bakin auto-starts it as a child process on boot, creates tables, keeps them indexed via the file watcher, and shuts it down with SIGTERM.

- **Text embeddings:** `BAAI/bge-small-en-v1.5` (Termite ONNX backend, local)
- **Image embeddings:** `openai/clip-vit-base-patch32` (also local) — assets table carries side-by-side `assets_text` + `assets_visual` indexes
- **Reranker:** `mxbai-rerank-base-v1` on single-modality queries
- **Content extraction:** PDFs via `pdf-parse`, text formats via `fs.readFileSync`, into a `content` field before indexing

```bash
bakin search "runway video clips"
bakin search "landscape shots" --table=assets
bakin search:stats
curl "http://localhost:3737/api/search?q=runway+video&table=assets&limit=5"
```

See [`.claude/knowledge/search-system.md`](./.claude/knowledge/search-system.md) for the full architecture and [`multimodal-search.md`](./.claude/knowledge/multimodal-search.md) for the PDF/image pipeline.

---

## Settings

All config at `~/.bakin/settings.json`. Created with defaults on first run.

```bash
bakin settings get                                # view all
bakin settings set dispatch.intervalMs 600000     # every 10 minutes
```

Key defaults:

| Setting | Default | Purpose |
|---|---|---|
| `dispatch.intervalMs` | 300000 (5 m) | Task dispatch interval |
| `dispatch.maxDispatched` | 500 | Max in-flight tasks |
| `watchdog.stuckThresholdMs` | 1800000 (30 m) | Alert if no step progress |
| `doctor.intervalMs` | 1800000 (30 m) | Health check interval |
| `doctor.autoFixSkill` | true | Auto-fix safe issues |
| `antfly.enabled` | true | Enable Antfly search |
| `sse.maxClients` | 50 | Max SSE connections |

---

## OpenClaw skill

Bakin ships a skill file at `skill/SKILL.md` that teaches OpenClaw agents how to interact with Bakin — task lifecycle rules, required API calls, logging requirements, content locations.

Doctor auto-installs it to `~/.openclaw/workspace/skills/bakin/` and keeps it in sync. Verify with:

```bash
openclaw skills list
```

---

## Environment

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3737` | Server port |
| `BAKIN_URL` | `http://localhost:3737` | Base URL the CLI uses |
| `BAKIN_HOME` | `~/.bakin/` | Data directory override |
| `OPENCLAW_HOME` | `~/.openclaw/` | OpenClaw data directory |
| `OPENCLAW_PATH` | `/opt/homebrew/bin/openclaw` | OpenClaw binary |

---

## Developing

```bash
git clone git@github.com:madeinwyo/bakin.git
cd bakin
bun install
bun run dev       # or `bakin dev` if the CLI is on your PATH
```

Both `bun run dev` and `bakin dev` launch the same watch-mode coordinator. Edits flow through a dev SSE channel:

- Edit `packages/host/src/**` → full page reload (~2 s)
- Edit `plugins/<id>/**` → that plugin remounts without a reload; shell, other plugins, URL, scroll, and SSE connection all survive
- Edit Tailwind-scanned CSS → link-tag swap, no reload (input focus preserved)
- Build error → red overlay at the top; stale bundle keeps running; overlay clears on fix

Server-side code (`src/core/**`, `server.ts`, plugins' `index.ts`) still requires a manual Ctrl-C + `bun run dev` restart.

Other entry points:

```bash
bun run start     # one-shot build + serve (production-style preview)
bun run server    # serve current dist/ without rebuilding
bun run build     # full build including the distributable binary
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full development setup, build pipeline, and test rules; [`CLAUDE.md`](./CLAUDE.md) for code conventions; and [`.claude/knowledge/dev-loop.md`](./.claude/knowledge/dev-loop.md) for the dev-mode architecture deep-dive.

For mock dev without a real OpenClaw:

```bash
bun run dev:mock          # seeds + launches Imitation Crab mock + Bakin
bun run mock:seed --force # reseed fixtures
```

---

## License

MIT
