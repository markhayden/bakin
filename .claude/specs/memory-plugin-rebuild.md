# SPEC: Memory Plugin Rebuild

_Created: 2026-04-17 | Owner: Mark_

## Objective

Rebuild the Bakin `memory` plugin from scratch as a read-only observability dashboard over every OpenClaw memory tier plus Bakin's own audit log. Every tier is indexed into a single Antfly table (`bakin_memory`) discriminated by a `tier` facet, so the entire memory system participates in Bakin's semantic and global search. Primary navigation is by agent with a dedicated global section for cross-agent views. This is a full rebuild — the existing plugin code is deleted, not migrated.

The point of this plugin is to make "the hidden prompts driving agent behavior" visible: session transcripts, tool call results, active-recall injections, compaction checkpoints, dream artifacts, short-term recall traces, durable memory files, and the Bakin audit trail — all browsable and searchable from one surface.

### Who this is for
- **Primary:** Mark — the human operator of a single-user self-hosted Bakin instance. Wants one place to see everything driving agent behavior.
- **Secondary:** Agents via MCP — `bakin_exec_memory_*` tools give any agent programmatic access to the same indexed corpus.

### Success criteria
1. Every OpenClaw memory tier listed in the access-surface report is visible in the `/memory` UI and indexed into `bakin_memory`.
2. Global search (`/api/search` + `/memory/search`) returns results from every tier with scores and a visible `tier` badge.
3. First-activate backfill indexes the last 30 days of session transcripts, daily notes, checkpoints, dreams, durable memory, and Bakin audit.
4. Live updates: new transcript events, daily notes, dream artifacts, and audit entries reach the UI within ~1s via the existing SSE + watcher pipeline.
5. The daily-notes tab supports a head-to-head comparison between OpenClaw's built-in FTS+vector index (via `openclaw memory search --json`) and Bakin's Antfly index over the same files.
6. Zero direct reads of `~/.openclaw/` paths outside a single adapter module.
7. Zero shell-outs to `openclaw` outside a single CLI wrapper module.
8. All tests mock `getContentDir`, the OpenClaw CLI wrapper, the WS client, and the watcher. No test touches `~/.bakin/` or the real gateway.

---

## Scope

### In scope (MVP)

- 7 memory tiers, each a row shape in `bakin_memory` with its own `tier` facet value:
  - `session` — session store entries (one row per session)
  - `turn` — per-turn transcript events (one row per `message` / `tool_call` / `tool_result`)
  - `checkpoint` — compaction checkpoint files (one row per `.checkpoint.*.jsonl`)
  - `daily_note` — `workspace/memory/YYYY-MM-DD*.md` markdown (one row per file)
  - `dream` — dream artifacts (one row per phase/date combo + one per `.dreams/*.json` signal file)
  - `durable` — canonical memory files (`MEMORY.md`, `DREAMS.md`, `SOUL.md`, `MEMORY-LOG.md`) — one row per heading chunk
  - `audit` — Bakin's own `audit.jsonl` (replaces the existing `bakin_audit` table)

- UI with per-tier tabs, by-agent primary navigation, global cross-agent view, per-tier and global search.
- Native WebSocket RPC client against the OpenClaw gateway (replaces shell-out temptation — see Decision 3 below).
- CLI wrapper for `openclaw memory status/search/promote`.
- Watcher-driven live updates via existing Bakin SSE pipeline.
- 5 MCP exec tools: `bakin_exec_memory_search`, `..._get_session`, `..._get_turn`, `..._list_agents`, `..._status`.
- Imitation-crab mock expansion: fixture session JSONL, daily note, dream stub, plus `sessions.list`/`sessions.get`/`sessions.subscribe` RPC handlers.
- URL-state-backed filters for agent, tier, query.

### Out of scope (v2+)

- Write actions: pin-a-recall, promote-candidate, supersede-entry, force-dream, clear-recall-cache, `sessions.compact`, `sessions.reset`, `sessions.abort`. No buttons exist.
- Per-turn prompt inspector showing the reconstructed system prompt + recall injections + tool definitions. Data is indexable today; the UI is v2 once we see how the browser tab is used.
- Multiple content types per plugin (`getTableForPlugin` enforces one). If we later need schema isolation per tier, we split.
- Antfly memoryaf integration.
- Subagent `workspaces/<id>/memory/` directories — on this instance, only `main` has one. Implementation assumes 0-or-1 memory dir per agent; extending when subagents populate one is trivial.
- Cross-machine or remote OpenClaw — assume local OpenClaw only.

### Explicit non-goals

- This is not a redesign of OpenClaw's memory stack. We observe it; we do not replace it.
- This is not a search substrate evaluation beyond the daily-notes A/B toggle. LanceDB/FTS5 vs Antfly is a UI comparison feature, not a benchmark harness.
- No feature flags, no gradual rollout, no parallel-old-plugin period. Delete the old, ship the new.

---

## Core Features & Acceptance Criteria

### Feature 1: Memory overview page (`/memory`)

- Agent picker (dropdown sourced from `openclaw.json` agent roster + `all agents`).
- One card per tier, each showing: row count in `bakin_memory` filtered to that tier+agent, last-updated timestamp, quick-link to the tier tab.
- Global search bar wired to `useSearch({ plugin: 'memory' })`.

**Acceptance:** navigating to `/memory` on a fresh instance shows 7 tier cards, all counts render without errors, search bar returns results from any tier.

### Feature 2: Session tier tab

- Table of sessions filtered by agent: key, chatType, model/provider, inputTokens, outputTokens, totalTokens, estimatedCostUsd, status, updatedAt.
- Row click opens `/memory/session/<sessionKey>` — a deep view with:
  - Session metadata panel
  - Turn-by-turn transcript renderer (chronological, paginated)
  - Per-turn usage (tokens in/out, cacheRead/cacheWrite, cost, model snapshot)
  - Tool call events rendered with collapsible args + result snippets (truncated to 2KB, linkable to raw file)
  - Compaction checkpoint markers inline when the session has them
- Live update: new turns appear in ~1s when the session is active.

**Acceptance:** opening an active session shows turns appearing as the agent is running.

### Feature 3: Transcript/turn tier tab (cross-session)

- Chronological feed of turn events across selected agent(s).
- Filters: event type (`message` / `tool_call` / `tool_result`), model, session kind, date range.
- Full-text search scoped to turns.

**Acceptance:** searching "embedding" across transcripts returns matches with session context, scored semantically.

### Feature 4: Daily notes tab with LanceDB/Antfly toggle

- List of `workspace/memory/*.md` files for the selected agent.
- Markdown renderer for the selected note.
- Search toggle: **Antfly** (queries `bakin_memory` tier=daily_note) | **LanceDB** (shells out to `openclaw memory search --json`).
- Side-by-side score comparison mode: one query, results from both indexes rendered in parallel columns.

**Acceptance:** toggling between Antfly and LanceDB for the same query shows clearly labeled result sets with scores.

### Feature 5: Dream tier tab

- Timeline of dream artifacts across phases (light / REM / deep / short-term-promotion).
- For each artifact: phase label, date, source day, summary text, promotion markers if present.
- Short-term recall trace inspector showing ranking signals (frequency, relevance, diversity, recency, consolidation, tags) when `short-term-recall.json` has entries.
- "Empty state" copy explaining dormant dreaming — we expect this to be common early.

**Acceptance:** a freshly-written `memory/dreaming/<phase>/<date>.md` appears in the UI within ~1s via the watcher.

### Feature 6: Checkpoint tier tab

- Table of `.checkpoint.*.jsonl` files per agent: sessionId, checkpointId, trigger, tokensBefore, tokensAfter, createdAt, summarySnippet.
- Checkpoint detail shows: trigger reason, before/after token counts, summary text, back-link to the owning session.

**Acceptance:** compaction events surface in UI within ~1s of OpenClaw writing the file.

### Feature 7: Durable memory tab

- Per-agent list of canonical bootstrap files: `MEMORY.md`, `DREAMS.md`, `SOUL.md`, `MEMORY-LOG.md`, `USER.md`, `IDENTITY.md`, `AGENTS.md`, `TOOLS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`.
- Rendered markdown view per file.
- Search indexes by heading chunk (H1/H2 boundaries → one row each in `bakin_memory` with tier=durable).

**Acceptance:** editing `SOUL.md` externally triggers a reindex and appears in search results within ~1s.

### Feature 8: Audit tier tab

- Replaces current audit timeline.
- Filters: agent, event type, channel, date range.
- SSE merge path for new entries.

**Acceptance:** new audit events appear within ~1s.

### Feature 9: Global memory search (`/memory/search`)

- One search box, results from all tiers for the selected agent (or `all agents`).
- Result card: tier badge, title/snippet, score, timestamp, agent badge, click-through to the owning tier view.
- URL-state: `?q=<query>&tier=<facet>&agent=<id>`.

**Acceptance:** one query returns mixed-tier results ranked by semantic score.

### Feature 10: MCP exec tools (5 tools)

1. `bakin_exec_memory_search` — hybrid search over `bakin_memory`. Args: `query`, `tier?`, `agent?`, `limit?`. Returns: array of `{ tier, agent, title, snippet, score, sourceRef, updatedAt }`.
2. `bakin_exec_memory_get_session` — fetch a session by key, including recent turns. Args: `sessionKey`, `turnLimit?`. Returns session metadata + last N turns.
3. `bakin_exec_memory_get_turn` — fetch a single turn by `turnId`. Args: `turnId`. Returns full turn event.
4. `bakin_exec_memory_list_agents` — list agent ids with per-tier row counts. No args.
5. `bakin_exec_memory_status` — indexer health: backlog depth, last successful indexed entry per tier, watcher status. No args.

**Acceptance:** each tool is registered in the MCP tools list, callable from any agent, returns structured JSON.

---

## Data Model

### Table: `bakin_memory`

Single Antfly table. Registered via `ctx.search.registerContentType` with:

```typescript
{
  type: 'memory',
  table: 'bakin_memory',
  facets: ['tier', 'agent', 'kind', 'eventType', 'phase', 'date'],
  textFields: ['title', 'snippet', 'content'],
  metaField: 'meta', // per-tier structured fields stringified as JSON
  ttl: null, // durable; governed by per-tier retention if needed
}
```

### Common row shape (every tier)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable ID per row. See per-tier ID rules below. |
| `tier` | enum | `session \| turn \| checkpoint \| daily_note \| dream \| durable \| audit` |
| `agent` | string | agent id (`main`, `pixel`, `main-operator`, etc.) |
| `title` | string | short human-readable label (e.g., session key, file basename, event type) |
| `snippet` | string | truncated content for preview (≤ 2KB) |
| `content` | string | full searchable text (truncated per tier — see below) |
| `sourceRef` | object | `{ backend: 'openclaw\|bakin', path?, file?, offset?, sessionId?, eventId?, checkpointId? }` — lets UI re-fetch canonical content |
| `updatedAt` | number | epoch ms — last observed write time |
| `createdAt` | number | epoch ms — row creation |
| `meta` | string (JSON) | per-tier structured fields |

### Per-tier `meta` shapes

**session** (`tier='session'`):
- `id` rule: `session:<sessionKey>` (sessionKey itself is unique enough)
- `meta`: `{ sessionKey, sessionId, kind, chatType, model, modelProvider, inputTokens, outputTokens, totalTokens, contextTokens, estimatedCostUsd, status, startedAt, endedAt, runtimeMs, abortedLastRun, systemSent, origin: { label, provider, surface, chatType, from, to, accountId } }`
- Source: `openclaw gateway call sessions.list` (rich metadata) + fallback to `agents/<id>/sessions/sessions.json` if gateway unreachable.

**turn** (`tier='turn'`):
- `id` rule: `turn:<sessionId>:<eventId>` — JSONL entries carry `id`.
- `meta`: `{ sessionId, sessionKey, eventType, role, parentId, timestamp, tool?, toolCallId?, usage?, costUsd?, provider?, model?, truncated?, rawByteOffset? }`
- `content`: extracted text (message text for `message` events; args+result text for `tool_call`/`tool_result`). Truncated to 32KB; `truncated=true` + `rawByteOffset` set when over cap.
- Source: `agents/<agent>/sessions/<sessionId>.jsonl` lines.
- **Skip:** `thinking_level_change`, `model_change`, `custom` events (keep as session-meta only, don't index as turns). Exception: `custom.model-snapshot` updates its session's `meta`.
- **Skip files:** `*.reset.*.jsonl` (historical backups, not live state).

**checkpoint** (`tier='checkpoint'`):
- `id` rule: `checkpoint:<sessionId>:<checkpointId>`
- `meta`: `{ sessionId, checkpointId, trigger, tokensBefore, tokensAfter, summary, createdAt }`
- `content`: the summary text.
- Source: `agents/<agent>/sessions/<sessionId>.checkpoint.<checkpointId>.jsonl` — first line is session header; later lines include summary. Parser extracts `trigger` and usage counts.

**daily_note** (`tier='daily_note'`):
- `id` rule: `daily_note:<agent>:<basename>`
- `meta`: `{ file, date, sizeBytes, openclawIndexed: true }` (latter asserts we expect OpenClaw's FTS5+vector index to also hold this)
- `content`: full markdown (no truncation — these are ≤50KB typically).
- Source: `workspace/memory/*.md` (main agent) or `workspaces/<id>/memory/*.md` (subagents if populated).

**dream** (`tier='dream'`):
- `id` rule: `dream:<agent>:<phase>:<date>` or `dream:<agent>:<artifactType>` for JSON signal files
- `meta`: `{ phase, date, sourceDay?, artifactType: 'phase_doc' | 'short_term_recall' | 'phase_signals' | 'events_log' | 'session_corpus' }`
- `content`: markdown body for phase docs; JSON-stringified structured content for signal files.
- Sources:
  - `workspace/memory/dreaming/<phase>/<YYYY-MM-DD>.md`
  - `workspace/memory/.dreams/short-term-recall.json`
  - `workspace/memory/.dreams/phase-signals.json`
  - `workspace/memory/.dreams/events.jsonl`
  - `workspace/memory/.dreams/session-corpus/<date>.{md,txt}`

**durable** (`tier='durable'`):
- `id` rule: `durable:<agent>:<basename>:<headingSlug>` — one row per heading chunk
- `meta`: `{ file, headingLevel, headingPath: string[], chunkIndex }`
- `content`: heading + body text to next heading.
- Source: `workspace/*.md` (the canonical bootstrap files, not `workspace/memory/*`).
- Chunker: H1 and H2 boundaries. Files without headings → single row with chunkIndex=0.

**audit** (`tier='audit'`):
- `id` rule: `audit:<entryId>` or `audit:<sha256(line)>` if entry has no id
- `meta`: `{ event, agent?, channel?, actor?, data }` — full audit entry meta.
- `content`: event + data stringified.
- Source: Bakin's `~/.bakin/audit.jsonl` (existing).

### Provenance & source references

Every row carries a `sourceRef` object with enough information to re-fetch the canonical artifact. This is the Antfly `memoryaf` external-reference pattern from Session 4 of the blog series. Format:

```typescript
{
  backend: 'openclaw' | 'bakin',
  path: string,         // absolute path to the canonical file
  file: string,         // basename
  offset?: number,      // byte offset into the file for line-oriented formats
  sessionId?: string,
  eventId?: string,
  checkpointId?: string,
}
```

The UI uses `sourceRef` to re-fetch on demand (e.g., show the full 200KB tool result that was truncated in the indexed row).

### Backfill policy

- On first plugin activation (or `?backfill=true` URL flag), index:
  - **sessions:** all from `sessions.list` (cheap — one RPC call)
  - **turns:** last 30 days of sessions, skip `.reset.*`, skip sessions >10MB (those chunk head 2000 lines + tail 2000 lines)
  - **checkpoints:** last 30 days of checkpoint files
  - **daily_notes:** all (small volume)
  - **dreams:** all (small volume)
  - **durable:** all canonical files
  - **audit:** last 30 days of audit.jsonl
- Backfill runs in a background job with progress events surfaced via SSE to `useContentStore`.
- Subsequent activations reconcile via existing `search-reconcile.ts` mtime-aware matcher.

### Duplicate / supersession handling

- Re-indexing the same `id` upserts (Antfly primary key on `id`).
- Source file deletion → row removed via watcher unlink hook (already auto-wired by `registerFileBackedContentType`).
- For non-file-backed tiers (session, turn, checkpoint, audit), we use `ctx.search.remove` explicitly on deletion events.

---

## Access Surfaces

| Tier | Primary source | Fallback | Access module |
|---|---|---|---|
| `session` | `openclaw gateway call sessions.list` via native WS client | FS read `agents/<id>/sessions/sessions.json` | `openclaw-gateway.ts` |
| `turn` | FS read `agents/<id>/sessions/<sessionId>.jsonl` | — | `openclaw-adapter.ts` |
| `checkpoint` | FS read `.checkpoint.*.jsonl` | — | `openclaw-adapter.ts` |
| `daily_note` | FS read `workspace/memory/*.md` | — | `openclaw-adapter.ts` |
| `dream` | FS read `workspace/memory/.dreams/*`, `workspace/memory/dreaming/**/*` | — | `openclaw-adapter.ts` |
| `durable` | FS read `workspace/*.md` (canonical) | — | `openclaw-adapter.ts` |
| `audit` | FS read `~/.bakin/audit.jsonl` | — | Bakin core audit (existing) |
| Daily-notes **comparison** | `openclaw memory search --query X --json` via CLI wrapper | — | `openclaw-cli.ts` |
| Memory index health | `openclaw memory status --json` via CLI wrapper | — | `openclaw-cli.ts` |
| Live session updates (v2) | `openclaw gateway call sessions.subscribe` WS push | — | `openclaw-gateway.ts` |

### Decision 3 revisited: native WS client

**Use a native WS client from the start.** Rationale for flipping from my earlier "shell-out first":
- `sessions.subscribe` is the single cleanest path to live session updates. Shelling out can't subscribe.
- The gateway protocol is a small WS envelope (method + params + id + response/stream frames) — ~100 lines of client code.
- Auth token is already loaded via `vault.get('gateway-token')` in `openclaw-client.ts`.
- Shell-outs impose latency (~200–400ms node startup per call) that a dashboard notices.
- Once the WS client exists, CLI shell-out becomes legacy code immediately.

**Exception:** `openclaw memory search --json` and `openclaw memory status --json` have no RPC equivalent — CLI is the only option there. Isolate those in `openclaw-cli.ts`.

### Auth

Gateway token read from `~/.openclaw/openclaw.json` at `gateway.auth.token`, loaded via existing vault mechanism. Same code path Bakin already uses for `/tools/invoke`.

### Watcher paths

Register with `ctx.watchFiles()`:

- `~/.openclaw/agents/*/sessions/sessions.json` → tier=session reindex
- `~/.openclaw/agents/*/sessions/*.jsonl` (excluding `.reset.*`) → tier=turn incremental-append index
- `~/.openclaw/agents/*/sessions/*.checkpoint.*.jsonl` → tier=checkpoint reindex
- `~/.openclaw/workspace/memory/*.md` → tier=daily_note reindex (also triggers `workspaces/*/memory/*.md`)
- `~/.openclaw/workspace/memory/.dreams/**/*` → tier=dream reindex
- `~/.openclaw/workspace/memory/dreaming/**/*.md` → tier=dream reindex
- `~/.openclaw/workspace/*.md` (canonical — MEMORY.md, SOUL.md, etc.) → tier=durable reindex
- `~/.bakin/audit.jsonl` → tier=audit append index

Incremental-append indexing: for JSONL files, track last-indexed byte offset per file (Bakin storage, `plugin-settings/memory/offsets.json`). On change event, seek to offset, read new lines, index them, update offset. Full reindex on file shrink or reset.

---

## UI

### Routes

- `/memory` — overview (agent picker + tier cards + global search)
- `/memory?agent=<id>` — scoped overview
- `/memory?agent=<id>&tier=<tier>` — tier browser
- `/memory/session/<sessionKey>` — session deep view with turn-by-turn feed
- `/memory/search?q=<query>&tier=<tier>&agent=<id>` — global results

All state URL-backed via `useQueryState` / `useQueryArrayState`. Pages wrapped in `<Suspense>`.

### Components

Under `plugins/memory/components/`:

- `memory-shell.tsx` — layout: agent picker + tier tab bar + content area
- `tier-overview-cards.tsx` — 7 cards for `/memory`
- `session-list.tsx` + `session-row.tsx` — tier=session table
- `session-detail.tsx` + `turn-feed.tsx` + `turn-card.tsx` — session deep view
- `transcript-feed.tsx` — tier=turn cross-session view
- `daily-notes-browser.tsx` + `search-substrate-toggle.tsx` — tier=daily_note with LanceDB/Antfly toggle
- `dream-timeline.tsx` + `dream-artifact-viewer.tsx` + `short-term-recall-table.tsx` — tier=dream
- `checkpoint-table.tsx` + `checkpoint-detail.tsx` — tier=checkpoint
- `durable-browser.tsx` + `durable-viewer.tsx` — tier=durable
- `audit-feed.tsx` — tier=audit (rewritten, reusing existing SSE merge logic)
- `memory-search-results.tsx` — cross-tier global search results

### Existing UI deleted

All components under `plugins/memory/components/` are removed and rebuilt. Current: `memory-tabs.tsx`, `memory-log.tsx`, `audit-timeline.tsx`, `agent-browser.tsx`, `gateway-viewer.tsx`. Gone.

### Search UX

- Per-tier tab has a local search box (scoped to that tier via `useSearch({ plugin: 'memory', filters: { tier: X } })`).
- `/memory/search` is the global surface.
- Results show tier badge, agent badge, timestamp, score, snippet, click-through.
- Daily-notes tab has an extra **Substrate: Antfly | LanceDB | Both** toggle that swaps the search backend. "Both" mode renders two columns side-by-side for the same query.

---

## MCP Tools

Registered via `ctx.registerExecTool` during `activate()`. Names follow the `bakin_exec_{pluginId}_{action}` convention.

| Tool | Args | Returns |
|---|---|---|
| `bakin_exec_memory_search` | `{ query: string, tier?: MemoryTier, agent?: string, limit?: number }` | `{ results: Array<{ id, tier, agent, title, snippet, score, sourceRef, updatedAt }> }` |
| `bakin_exec_memory_get_session` | `{ sessionKey: string, turnLimit?: number }` | `{ session, turns: [...] }` |
| `bakin_exec_memory_get_turn` | `{ turnId: string }` | `{ turn }` |
| `bakin_exec_memory_list_agents` | `{}` | `{ agents: Array<{ id, counts: Record<MemoryTier, number> }> }` |
| `bakin_exec_memory_status` | `{}` | `{ watcher: { running, queueDepth }, offsets: Record<filePath, number>, lastIndexedByTier: Record<MemoryTier, number> }` |

All tools recorded via `recordUsage({ kind: 'mcp', ... })` (automatic via `registerTools`).

---

## Commands

No new CLI subcommands for Bakin core. The plugin works via its REST routes (auto-registered under `/api/plugins/memory/...`) and MCP exec tools.

Dev / ops commands used during build:

- `pnpm dev` — runs Bakin + mock OpenClaw
- `pnpm mock:seed --force` — reseeds imitation-crab fixtures (must be extended for new mock data)
- `pnpm test` — runs vitest; tests MUST mock getContentDir, the OpenClaw CLI wrapper, the WS client, and the watcher
- `openclaw gateway call sessions.list --json` — manual validation against real OpenClaw

---

## Project Structure

### Files to create

```
plugins/memory/
  bakin-plugin.json                       # updated manifest (permissions, settings schema)
  index.ts                                # plugin entry — registers content type, routes, watchers, exec tools
  client.tsx                              # nav items
  types.ts                                # MemoryTier, MemoryRow, SourceRef, per-tier meta shapes
  lib/
    openclaw-adapter.ts                   # filesystem reads — all ~/.openclaw paths routed through here
    openclaw-gateway.ts                   # native WS client for gateway RPC (sessions.list/get/subscribe/usage)
    openclaw-cli.ts                       # CLI wrapper for openclaw memory status/search/promote
    indexer.ts                            # orchestrates backfill + per-tier incremental indexing
    offsets.ts                            # persisted byte-offset tracking for JSONL append indexing
    tier-parsers/
      session-parser.ts                   # session.list → MemoryRow
      turn-parser.ts                      # JSONL lines → MemoryRow[]
      checkpoint-parser.ts                # checkpoint JSONL → MemoryRow
      daily-note-parser.ts                # markdown → MemoryRow
      dream-parser.ts                     # dream artifacts → MemoryRow
      durable-parser.ts                   # canonical markdown → heading-chunked MemoryRow[]
      audit-parser.ts                     # audit.jsonl → MemoryRow
    routes/
      sessions.ts                         # GET /sessions, GET /sessions/:key
      turns.ts                            # GET /turns
      checkpoints.ts                      # GET /checkpoints
      daily-notes.ts                      # GET /daily-notes, POST /daily-notes/compare-search
      dreams.ts                           # GET /dreams
      durable.ts                          # GET /durable
      audit.ts                            # GET /audit
      status.ts                           # GET /status (indexer health)
  components/
    memory-shell.tsx
    tier-overview-cards.tsx
    session-list.tsx
    session-row.tsx
    session-detail.tsx
    turn-feed.tsx
    turn-card.tsx
    transcript-feed.tsx
    daily-notes-browser.tsx
    search-substrate-toggle.tsx
    dream-timeline.tsx
    dream-artifact-viewer.tsx
    short-term-recall-table.tsx
    checkpoint-table.tsx
    checkpoint-detail.tsx
    durable-browser.tsx
    durable-viewer.tsx
    audit-feed.tsx
    memory-search-results.tsx
  mcp/
    search.ts                             # bakin_exec_memory_search
    get-session.ts                        # bakin_exec_memory_get_session
    get-turn.ts                           # bakin_exec_memory_get_turn
    list-agents.ts                        # bakin_exec_memory_list_agents
    status.ts                             # bakin_exec_memory_status

src/app/memory/
  page.tsx                                # /memory overview
  search/page.tsx                         # /memory/search
  session/[sessionKey]/page.tsx           # /memory/session/<key>

tests/plugins/memory/
  indexer.test.ts
  tier-parsers/
    session-parser.test.ts
    turn-parser.test.ts
    checkpoint-parser.test.ts
    daily-note-parser.test.ts
    dream-parser.test.ts
    durable-parser.test.ts
    audit-parser.test.ts
  openclaw-gateway.test.ts
  openclaw-cli.test.ts
  openclaw-adapter.test.ts
  offsets.test.ts
  routes.test.ts
  mcp-tools.test.ts
  fixtures/
    session-transcript.jsonl
    checkpoint.jsonl
    daily-note.md
    dream-phase-doc.md
    short-term-recall.json
    durable-soul.md
    audit.jsonl
```

### Files to delete

```
plugins/memory/components/memory-tabs.tsx
plugins/memory/components/memory-log.tsx
plugins/memory/components/audit-timeline.tsx
plugins/memory/components/agent-browser.tsx
plugins/memory/components/gateway-viewer.tsx
(existing plugins/memory/index.ts, lib/, types.ts — rewritten, not retained)
```

Also deprecate `bakin_audit` table name — migrated to `bakin_memory` with `tier='audit'`. No shim; no backwards compat (per kickoff directive). Update `src/core/api-search-handler.ts` and any other consumer to use the new table.

### Files to modify

- `plugins/memory/bakin-plugin.json` — add permissions (`storage.read`, `events.emit`, `openclaw.read`), settings schema (backfill window, size caps)
- `dev/imitation-crab/gateway.ts` — add `sessions.list`, `sessions.get`, `sessions.subscribe` WS methods
- `dev/imitation-crab/seed.ts` — seed fixture session JSONL, daily note, dream stub, checkpoint
- `src/core/openclaw-client.ts` — extract WS RPC client or factor a `gatewayCall()` helper (if the native WS client lives there, not in the plugin)
- `src/lib/constants.ts` — memory nav item (keep; update label/icon if needed)
- `.claude/knowledge/search-plugin-guide.md` — add note about memory plugin's consolidated `tier` facet approach
- `.claude/knowledge/search-system.md` — update to reflect `bakin_memory` unifying `bakin_audit`
- `CLAUDE.md` — update Directory Map description for `plugins/memory/`
- `README.md` — one-line update if it mentions the audit log as a separate surface

---

## Code Style

Follow CLAUDE.md conventions exactly:

- TypeScript strict mode; no `any` across module boundaries
- Zod validation at boundaries (MCP tool args, REST inputs, JSONL line parsing, settings)
- `createLogger('memory')` and `createLogger('memory:indexer')` etc.
- `kebab-case.ts` files, `PascalCase` types, `UPPER_SNAKE_CASE` true constants
- Import order: node builtins → external → `@/*` → `@bakin/*` → relative
- Path aliases: `@bakin/memory/*` → `./plugins/memory/*`
- Zero hardcoded paths to `~/.openclaw/` or `~/.bakin/` — always via `getOpenClawPath()` / `getContentDir()`
- All OpenClaw filesystem reads route through `lib/openclaw-adapter.ts`
- All OpenClaw gateway RPC calls route through `lib/openclaw-gateway.ts`
- All OpenClaw CLI shell-outs route through `lib/openclaw-cli.ts`
- No comments explaining _what_ the code does; only non-obvious _why_ comments

---

## Testing Strategy

### Mandatory mocks in every test file

```typescript
vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ /* ... */ }),
}))
vi.mock('../../src/core/logger', () => ({ createLogger: () => noopLogger }))
vi.mock('../../src/core/watcher', () => ({ /* stub */ }))
vi.mock('@bakin/memory/lib/openclaw-cli', () => ({ /* stub CLI outputs */ }))
vi.mock('@bakin/memory/lib/openclaw-gateway', () => ({ /* stub WS responses */ }))
vi.mock('@bakin/memory/lib/openclaw-adapter', () => ({ /* stub FS */ })) // or override with fixture files
```

### Unit tests

- Each tier parser has a test with a fixture file asserting the produced `MemoryRow[]` shape.
- `offsets.ts` — tests for append detection, shrink detection, initial-read.
- `openclaw-gateway.ts` — tests for WS envelope, auth, error handling, subscribe frame handling.
- `openclaw-cli.ts` — tests with mocked `execFile`.
- `indexer.ts` — tests for backfill window, 10MB skip, reset-file skip.

### Integration tests (plugin-level)

- Use `tests/plugins/test-helpers.ts` (`activatePlugin`, `callRoute`, `callTool`).
- Seed tier fixtures in a temp dir, activate the plugin, assert indexer writes expected rows.
- Each MCP tool has a round-trip test: call with args, assert returned shape.
- Each REST route has a round-trip test.

### Fixture corpus

All fixtures under `tests/plugins/memory/fixtures/` — small files that exercise edge cases (empty session, tool-call-only turn, very long tool result, reset backup, checkpoint with trigger=overflow, dormant dream with empty short-term-recall.json).

### What is NOT tested

- Real OpenClaw connectivity (integration tests use mocks + fixtures).
- Real Antfly connectivity (existing test harness handles this; Antfly is optional at runtime).
- UI rendering behavior (existing pattern: no snapshot tests; confirm manually in dev).

---

## Boundaries

### Always

- Read ~/.openclaw/ through `openclaw-adapter.ts`. Never hardcode paths elsewhere.
- Validate MCP tool args + REST bodies with Zod.
- Index rows with stable `id`s; upsert on reindex.
- Include `sourceRef` on every indexed row.
- Truncate `content` per tier's cap and set `truncated=true` when applicable.
- Honor the 30-day backfill window unless `?backfill=all` is explicitly passed.
- Route every MCP tool through `recordUsage({ kind: 'mcp', ... })` (auto via `registerTools`).
- Log errors with `log.error('...', err, { ...context })` so they reach `server.log`.

### Ask first

- Extending indexing beyond 30 days — confirm the intended volume.
- Adding any write path (pin, promote, invalidate, force-dream). All writes are v2.
- Changing the `bakin_memory` schema after initial deploy — requires a reindex plan.
- Shipping without the imitation-crab mock being updated (would break dev workflow).

### Never

- Write to any OpenClaw path (`~/.openclaw/...`). Bakin reads; never writes to OpenClaw.
- Copy OpenClaw data. `bakin_memory` is an _index_ over OpenClaw — `sourceRef` points back to canonical content.
- Ship any code that calls `~/.openclaw/` directly outside the adapter modules.
- Ship any test that touches `~/.bakin/` or the real OpenClaw gateway.
- Re-implement OpenClaw's own memory indexing. We index into _our_ Antfly table; their SQLite stays theirs.
- Add backwards-compatibility shims for the old memory plugin, old `bakin_audit` table, or old route paths. Clean cut per kickoff directive.

---

## Documentation Impact

Files to update when work lands:

- `CLAUDE.md` — Directory Map entry for `plugins/memory/`, Search Indexing section (note `bakin_memory` unification)
- `README.md` — only if it currently describes audit as a separate surface (probably not)
- `.claude/knowledge/search-plugin-guide.md` — single-table-with-tier-facet pattern reference
- `.claude/knowledge/search-system.md` — update table inventory
- `.claude/knowledge/url-state-deep-linking.md` — add `/memory` URL params to status table
- New: `.claude/knowledge/memory-plugin.md` — deep dive covering tiers, sources, indexer, WS client, CLI wrapper

---

## Nice-to-Haves (to request from OpenClaw)

Documented for future feature requests; not blockers:

1. `memory.status` / `memory.search` / `memory.promote` gateway RPC methods (eliminate CLI shell-out for those paths).
2. `compaction.list(agentId, sessionKey)` and `compaction.get(checkpointId)` RPC (structured access to checkpoint metadata).
3. `dreams.status` / `dreams.artifacts(phase, date)` RPC (remove filesystem dependency for dream tier).
4. `active_recall.last(sessionKey)` RPC (surface "what memory summary got injected into this turn" without parsing session-store debug lines).
5. Option to index session transcripts in OpenClaw's `memory/<agent>.sqlite` (cross-session recall would then work through OpenClaw instead of requiring a parallel Bakin index).
6. Stable JSON output from `openclaw memory promote` when the candidate set is empty (currently returns "Unexpected end of JSON input").

---

## Risks & Open Questions

**R1 — Indexing volume.** Per-turn indexing over 30 days of active agents could be 10k–50k rows. Antfly capacity and reindex speed untested at this scale. Mitigation: initial backfill runs in background with progress SSE; backlog monitoring via `bakin_exec_memory_status`.

**R2 — Dreaming dormancy.** We're building the dream tier UI against documented paths that are empty on the current instance. First real dream run is the true shakedown. Mitigation: fixture corpus includes plausible dream artifacts; UI has explicit empty-state copy.

**R3 — Native WS client complexity.** The gateway WS protocol is not documented externally; we infer it from the CLI. If the protocol changes across OpenClaw releases, the client breaks. Mitigation: version-pin acceptable OpenClaw versions in settings; `openclaw-gateway.ts` stays small and testable; CLI fallback for `sessions.list` if WS fails.

**R4 — Antfly optional at runtime.** If Antfly is disabled, search becomes a no-op. Mitigation: `bakin_memory` reads gracefully degrade; UI shows "search disabled — enable Antfly" banner when calls fail.

**R5 — `bakin_audit` table removal is a breaking change.** Any external tool expecting that table name breaks. Mitigation: single-user instance, no external consumers, explicit kickoff directive to drop backwards compat.

**Open Q1 — Session reset backups (`*.jsonl.reset.*`):** confirmed skipped. Is there a reason we'd want them visible as a "reset history" tier later? Flag for v2 discussion.

**Open Q2 — Subagent memory directories:** `workspaces/<id>/memory/` is empty on this instance. Implementation iterates any agent that has one. Confirm the watcher globs cover the right paths when subagents start populating them.
