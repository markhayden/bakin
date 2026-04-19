# PLAN: Memory Plugin Rebuild

_Companion to [memory-plugin-rebuild.md](./memory-plugin-rebuild.md). Created 2026-04-17._

## Intent

Execute the spec as **11 vertically-sliced commits**, each a rollback checkpoint. Every commit leaves `main` in a shippable state — either the new plugin isn't live yet (commits 1–2 wire infra before the UI consumes it), or a tier is fully delivered end-to-end (parse → index → route → UI → test).

No feature flags. No backwards-compat shims. `bakin_audit` table is deleted outright in commit 2 — if you need to roll back past that, revert to commit 1.

## Ground rules

- **One commit = one PR-ready atomic change.** Passing tests, typecheck clean, lint clean, conventional-commit scope.
- **Tests land with the code they cover.** Not a trailing "add tests" commit.
- **Docs land with the code they document.** `.claude/knowledge/memory-plugin.md` grows commit by commit; final polish in commit 11.
- **Every commit mocks `getContentDir`, logger, watcher, gateway, CLI.** No exceptions (CLAUDE.md).
- **Build via `/agent-skills:build` per commit; verify via `/agent-skills:test` before the next commit starts.**
- Each commit includes a **verification command** that must pass locally before moving on.

## Dependency graph

```
C1 (infra: types + adapter + gateway + cli + offsets)
 └─> C2 (plugin shell rewrite + delete bakin_audit + bakin_memory content type)
      ├─> C3 (audit tier)           — simplest tier, validates the pipeline
      ├─> C4 (durable tier)          — pure FS markdown, no transcript complexity
      ├─> C5 (daily-notes tier)      — adds LanceDB/Antfly toggle
      ├─> C6 (session + turn tiers)  — coupled; biggest slice; depends on WS client
      │    └─> C7 (checkpoint tier)  — depends on session rows existing
      │         └─> C8 (dream tier)  — depends on nothing else, but tested last
      └─> C9 (global search page + /memory/search + facets UX)
            └─> C10 (MCP exec tools — 5 tools)
                  └─> C11 (docs: knowledge/, CLAUDE.md, README)
```

C3–C8 are **independent after C2** and could reorder. Recommended order above is by _risk ascending_: simplest tiers first so the indexer/watcher pattern is battle-tested before session/turn's complexity hits.

---

## Commit 1 — `feat(memory): foundational modules (types, adapter, gateway, cli, offsets)`

**Scope:** Pure infrastructure. Zero UI, zero plugin behavior change. Adds new files only; existing plugin keeps running.

**Files created:**
- `plugins/memory/lib/types.ts` — `MemoryTier`, `MemoryRow`, `SourceRef`, per-tier meta shapes (Zod schemas)
- `plugins/memory/lib/openclaw-adapter.ts` — FS reads: `listAgents()`, `readSessionStore(agent)`, `readTranscript(agent, sessionId)`, `listCheckpoints(agent, sessionId)`, `listDailyNotes(agent)`, `listDreamArtifacts(agent)`, `readDurableFile(agent, basename)`. **Every `~/.openclaw/` path routes through here via `getOpenClawPath`.**
- `plugins/memory/lib/openclaw-gateway.ts` — native WS client: `gatewayCall(method, params)`, `gatewaySubscribe(method, params, onFrame)`. Auth via `vault.get('gateway-token')`. Small: ~150 lines.
- `plugins/memory/lib/openclaw-cli.ts` — wraps `openclaw memory status --json`, `openclaw memory search --json --query X`. Only `execFile`, never `exec`. Timeout 15s.
- `plugins/memory/lib/offsets.ts` — persisted byte-offset tracking. `getOffset(fileKey)`, `setOffset(fileKey, offset)`. Storage: `~/.bakin/plugin-settings/memory/offsets.json`.

**Acceptance criteria:**
1. `openclaw-adapter.ts` contains zero hardcoded strings starting with `~/.openclaw` or `/Users/` — only `getOpenClawPath(...)` calls.
2. `openclaw-gateway.ts` reuses the existing vault token pattern (grep confirms `vault.get('gateway-token')`).
3. `offsets.ts` survives concurrent reads (no torn writes; use atomic rename on write).
4. All five modules are tree-shakable: no side effects at import time, no top-level `fs` calls.

**Tests (must land in this commit):**
- `tests/plugins/memory/openclaw-adapter.test.ts` — fixture filesystem, asserts each list/read returns shapes matching `types.ts` Zod schemas.
- `tests/plugins/memory/openclaw-gateway.test.ts` — mock WS server, asserts envelope, auth header, error paths.
- `tests/plugins/memory/openclaw-cli.test.ts` — mocks `execFile`, asserts JSON output parsed, timeout rejection works.
- `tests/plugins/memory/offsets.test.ts` — initial read returns 0, set/get round-trips, missing file returns 0, atomic rename verified.

**Verification:**
```bash
pnpm typecheck && pnpm test tests/plugins/memory/
```

**Docs impact:** None yet.

**Rollback meaning:** Reverts back to pre-rebuild state with zero plugin disruption.

---

## Commit 2 — `refactor(memory): rewrite plugin shell, drop bakin_audit, register bakin_memory`

**Scope:** The breaking change. Old plugin goes away; new shell comes in. After this commit the UI is partly broken (no tier tabs wired yet) but the plugin activates cleanly and `bakin_memory` exists.

**Files replaced:**
- `plugins/memory/index.ts` — new shell. Removes `registerContentType` for `audit` table. Registers single `bakin_memory` content type (plain, not file-backed — indexer handles sync). Registers watchers for all paths listed in spec "Watcher paths". No REST routes yet (per-tier commits add them).
- `plugins/memory/client.tsx` — nav item unchanged (`/memory`).
- `plugins/memory/types.ts` — re-exports from `lib/types.ts`.
- `plugins/memory/bakin-plugin.json` — updated `settingsSchema`: `{ backfillDays: 30, skipSessionOverBytes: 10485760, skipResetBackups: true, lanceDbComparisonEnabled: true }`; permissions: `storage.read`, `events.emit`, `openclaw.read`.

**Files deleted:**
- `plugins/memory/components/memory-tabs.tsx`
- `plugins/memory/components/memory-log.tsx`
- `plugins/memory/components/audit-timeline.tsx`
- `plugins/memory/components/agent-browser.tsx`
- `plugins/memory/components/gateway-viewer.tsx`
- `plugins/memory/lib/audit-parser.ts` (moves to `lib/tier-parsers/audit-parser.ts` in C3)
- `plugins/memory/lib/gateway-parser.ts` (removed outright — gateway-log viewer is out of scope)

**Files created (stubs — filled in by later commits):**
- `plugins/memory/lib/indexer.ts` — `MemoryIndexer` class skeleton with `backfill(tiers)`, `indexTier(tier, agent?)`, `handleWatcherEvent(path, kind)`. Methods return no-ops but are wired. Per-tier logic lands in C3–C8.
- `plugins/memory/components/memory-shell.tsx` — layout shell: agent picker + tier tab bar + empty content area.
- `src/app/memory/page.tsx` — rewrite of `/memory`. Shows `memory-shell.tsx` with empty content area.

**Breaking changes (no shims, per kickoff directive):**
- `bakin_audit` table — **deleted**. Any Antfly rows under that table become orphaned. If Antfly is running at deploy, operator must manually drop the table (or let TTL expire). Plan: document in commit message, add warning to startup log in `indexer.ts` if `bakin_audit` exists (informational only, not a shim).
- `GET /api/plugins/memory/audit` — removed. Re-added in C3 with new shape.
- `GET /api/plugins/memory/workspace` — removed. Functionality replaced by C4 (durable) and C5 (daily-notes).
- `GET /api/plugins/memory/gateway` — removed outright. Gateway log viewer is out of scope.

**Acceptance criteria:**
1. `pnpm dev` starts with the new plugin activated, no errors in `server.log`.
2. `/memory` renders the empty shell (agent picker + empty tab bar, no error boundary).
3. `ctx.search.registerContentType({ table: 'bakin_memory', ... })` visible in Antfly table list.
4. Watcher logs show all spec-listed paths being watched (grep `server.log` for `memory:watcher`).
5. `getTableForPlugin('memory')` returns `bakin_memory`.

**Tests:**
- `tests/plugins/memory/plugin-activation.test.ts` — activates plugin in isolation, asserts single content type registered, asserts routes list empty, asserts watchers queued.

**Verification:**
```bash
pnpm typecheck && pnpm test tests/plugins/memory/ && pnpm dev  # manual: visit /memory
```

**Docs impact:**
- `CLAUDE.md` — update Search Indexing section: `bakin_memory` replaces `bakin_audit` (one-line tweak).
- Create `.claude/knowledge/memory-plugin.md` with outline + commit-by-commit growth plan.

**Rollback meaning:** Reverting this commit restores the old plugin (C1 foundation modules survive — they're unused but harmless).

---

## Commit 3 — `feat(memory): audit tier indexed into bakin_memory`

**Scope:** First tier end-to-end. Validates the whole pipeline before the complex tiers.

**Files created:**
- `plugins/memory/lib/tier-parsers/audit-parser.ts` — `parseAuditLine(line): MemoryRow | null`. Line → `{ id, tier:'audit', agent, title, snippet, content, sourceRef, updatedAt, meta }`.
- `plugins/memory/lib/routes/audit.ts` — `GET /audit` with URL query (`agent`, `event`, `limit`, `cursor`). Reads from `bakin_memory` via `ctx.search.query({ tier: 'audit', ... })`.
- `plugins/memory/components/audit-feed.tsx` — filter UI + result list + SSE merge for new entries.

**Files modified:**
- `plugins/memory/lib/indexer.ts` — fill in `indexTier('audit')`: streams `~/.bakin/audit.jsonl`, parses each line, upserts rows. Incremental via `offsets.ts`.
- `plugins/memory/index.ts` — register audit route, wire watcher for `~/.bakin/audit.jsonl` to `indexer.handleWatcherEvent`.
- `plugins/memory/components/memory-shell.tsx` — audit tab rendered when `?tier=audit`.

**Acceptance criteria:**
1. `/memory?tier=audit` shows audit events with filter for agent + event type. URL state backed via `useQueryState`.
2. Appending a line to `~/.bakin/audit.jsonl` causes a new row in `bakin_memory` (tier=audit) within ~1s.
3. Offset file at `~/.bakin/plugin-settings/memory/offsets.json` grows as lines are indexed.
4. Searching via `/api/search?q=<term>` returns matching audit rows with `tier: 'audit'` badge.
5. First-activate backfill caps at 30 days (configurable via settings).

**Tests:**
- `tests/plugins/memory/tier-parsers/audit-parser.test.ts` — fixture lines → expected rows.
- `tests/plugins/memory/routes/audit.test.ts` — round-trip: seed rows, call route, assert response.
- `tests/plugins/memory/indexer-audit.test.ts` — incremental append: index 3 lines, append 2 more, assert only 2 new rows indexed.

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev
# manual: visit /memory?tier=audit, append to ~/.bakin/audit.jsonl, see row appear
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — add audit tier section.

---

## Commit 4 — `feat(memory): durable tier indexed by heading chunk`

**Scope:** Canonical bootstrap files (`SOUL.md`, `MEMORY.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, `HEARTBEAT.md`, `BOOTSTRAP.md`, `DREAMS.md`, `MEMORY-LOG.md`). H1/H2 boundary chunking → one row per chunk.

**Files created:**
- `plugins/memory/lib/tier-parsers/durable-parser.ts` — `parseDurableFile(agent, basename, content): MemoryRow[]`. H1/H2 splitter; files without headings → single row chunkIndex=0.
- `plugins/memory/lib/routes/durable.ts` — `GET /durable?agent=<id>` (file list), `GET /durable/:agent/:basename` (rendered content).
- `plugins/memory/components/durable-browser.tsx` — file list per agent.
- `plugins/memory/components/durable-viewer.tsx` — markdown renderer using existing markdown component.

**Files modified:**
- `plugins/memory/lib/indexer.ts` — fill in `indexTier('durable')`: iterate agents, iterate canonical file list, reindex per-file.
- `plugins/memory/index.ts` — register `/durable` + `/durable/:agent/:basename` routes; wire watcher for `workspace/*.md` + `workspaces/*/*.md`.
- `plugins/memory/components/memory-shell.tsx` — durable tab.

**Acceptance criteria:**
1. `/memory?tier=durable&agent=main` lists 10 canonical files.
2. Clicking a file opens rendered markdown.
3. Editing `SOUL.md` in place (via direct file write) triggers reindex; new content visible in search within ~1s.
4. A file with 5 H1 headings produces 5 rows in `bakin_memory`.
5. Search for text inside a specific heading returns the chunk row, not the whole file.

**Tests:**
- `tests/plugins/memory/tier-parsers/durable-parser.test.ts` — multi-heading fixture, no-heading fixture, nested headings.
- `tests/plugins/memory/routes/durable.test.ts` — list + detail route round-trip.

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev
# manual: edit ~/.openclaw/workspace/SOUL.md, confirm live reindex
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — add durable tier + chunking pattern.

---

## Commit 5 — `feat(memory): daily-notes tier with LanceDB/Antfly comparison toggle`

**Scope:** `workspace/memory/YYYY-MM-DD*.md` files. Both Antfly-indexed AND the UI surfaces OpenClaw's native LanceDB search via CLI shell-out.

**Files created:**
- `plugins/memory/lib/tier-parsers/daily-note-parser.ts` — file → `MemoryRow` with `meta.date`, `meta.file`, `meta.openclawIndexed: true`.
- `plugins/memory/lib/routes/daily-notes.ts` — `GET /daily-notes?agent=<id>` (list), `GET /daily-notes/:agent/:filename` (render), `POST /daily-notes/compare-search` (body: `{ query, agent }` → `{ antfly: [...], lancedb: [...] }`).
- `plugins/memory/components/daily-notes-browser.tsx` — file list + selected note renderer.
- `plugins/memory/components/search-substrate-toggle.tsx` — Antfly | LanceDB | Both segmented control.

**Files modified:**
- `plugins/memory/lib/indexer.ts` — fill in `indexTier('daily_note')`.
- `plugins/memory/lib/openclaw-cli.ts` — add `searchMemory(query): Promise<LanceDbHit[]>` wrapping `openclaw memory search --query <q> --json`.
- `plugins/memory/index.ts` — register routes; wire watcher for `workspace/memory/*.md` + `workspaces/*/memory/*.md`.
- `plugins/memory/components/memory-shell.tsx` — daily-notes tab.

**Acceptance criteria:**
1. `/memory?tier=daily_note&agent=main` lists all daily notes sorted by date desc.
2. Typing in the search box with **Antfly** mode hits Bakin's index; with **LanceDB** mode, shell-outs to `openclaw memory search`; with **Both**, two parallel columns render.
3. Every result shows score, snippet, source file, and click-through to rendered view.
4. LanceDB shell-out timeout at 15s returns a visible UI error (no silent failure).
5. Empty LanceDB response (OpenClaw has no index for this agent) shows explicit "no LanceDB index" banner, not "no results".

**Tests:**
- `tests/plugins/memory/tier-parsers/daily-note-parser.test.ts` — fixture files, date extraction.
- `tests/plugins/memory/routes/daily-notes.test.ts` — list route + compare-search route (mocked CLI + mocked Antfly).
- `tests/plugins/memory/openclaw-cli-search.test.ts` — search command mocking `execFile`, stable JSON + error paths.

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev
# manual: /memory?tier=daily_note, switch substrate toggle, confirm both result sets
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — add LanceDB vs Antfly comparison architecture.

---

## Commit 6 — `feat(memory): session + turn tiers with WS-driven live updates`

**Scope:** Biggest commit. Session metadata from `sessions.list`, transcript events parsed from `<sessionId>.jsonl`, live updates via `sessions.subscribe`. Session deep view with turn feed.

**Files created:**
- `plugins/memory/lib/tier-parsers/session-parser.ts` — `sessions.list` result → `MemoryRow[]`.
- `plugins/memory/lib/tier-parsers/turn-parser.ts` — JSONL lines → `MemoryRow[]`. Skips `thinking_level_change`, `model_change`, non-model-snapshot `custom`. Indexes `message` / `tool_call` / `tool_result`. Truncates content at 32KB; sets `truncated=true` + `rawByteOffset`.
- `plugins/memory/lib/routes/sessions.ts` — `GET /sessions?agent=<id>`, `GET /sessions/:sessionKey`, `GET /sessions/:sessionKey/turns?limit=&cursor=`.
- `plugins/memory/lib/routes/turns.ts` — `GET /turns?agent=<id>&eventType=&dateFrom=&dateTo=` (cross-session feed).
- `plugins/memory/components/session-list.tsx` — table per agent.
- `plugins/memory/components/session-row.tsx`
- `plugins/memory/components/session-detail.tsx`
- `plugins/memory/components/turn-feed.tsx` — paginated turn list with SSE merge for live events.
- `plugins/memory/components/turn-card.tsx` — tool-call collapsible renderer.
- `plugins/memory/components/transcript-feed.tsx` — cross-session tier=turn view.
- `src/app/memory/session/[sessionKey]/page.tsx` — session deep view.

**Files modified:**
- `plugins/memory/lib/indexer.ts` — fill in `indexTier('session')` (via `gatewayCall('sessions.list')`) and `indexTier('turn')` (stream JSONL with offset tracking). Add backfill window (30 days) + 10MB skip with head+tail chunking (2000 lines each). Skip `.reset.*.jsonl`.
- `plugins/memory/index.ts` — register routes, wire watcher for session JSONL files + `sessions.json` store. Subscribe to `sessions.subscribe` for live frames → indexer.
- `plugins/memory/components/memory-shell.tsx` — session tab + transcript tab.
- `dev/imitation-crab/gateway.ts` — add `sessions.list`, `sessions.get`, `sessions.subscribe` WS handlers (mock protocol envelope).
- `dev/imitation-crab/seed.ts` — seed fixture session JSONL (30 turns, mix of message/tool_call/tool_result), session store entry, one with `.checkpoint.*.jsonl` reference.

**Acceptance criteria:**
1. `/memory?tier=session&agent=main` lists all sessions from `sessions.list` with metadata (tokens, cost, model).
2. Clicking a session opens `/memory/session/<key>` with turn-by-turn feed.
3. Starting a new agent turn (in dev against imitation-crab) causes a new turn card to appear within ~1s via WS subscription.
4. Cross-session `/memory?tier=turn` search returns scored results with session context.
5. Backfill skips `*.jsonl.reset.*` files (verified via indexer logs).
6. A session file >10MB is chunked (head 2000 lines + tail 2000 lines), logged at INFO.
7. WS client gracefully falls back to FS read of `sessions.json` when gateway unreachable.

**Tests:**
- `tests/plugins/memory/tier-parsers/session-parser.test.ts`
- `tests/plugins/memory/tier-parsers/turn-parser.test.ts` — includes fixture with all event types + skip list + 32KB truncation + tool-call shapes.
- `tests/plugins/memory/routes/sessions.test.ts`
- `tests/plugins/memory/routes/turns.test.ts`
- `tests/plugins/memory/indexer-sessions.test.ts` — 10MB skip, reset skip, head+tail chunking, 30d backfill window.
- `tests/plugins/memory/openclaw-gateway-subscribe.test.ts` — subscribe frame routing into indexer.

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev:mock
# manual: /memory?tier=session, click session, confirm turns appear live
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — add session/turn architecture, WS subscribe flow, chunking strategy.

---

## Commit 7 — `feat(memory): checkpoint tier with session back-links`

**Scope:** `.checkpoint.*.jsonl` files per session. Inline markers in session detail + dedicated tab.

**Files created:**
- `plugins/memory/lib/tier-parsers/checkpoint-parser.ts` — `.checkpoint.*.jsonl` header+body → `MemoryRow`. Extracts `trigger`, `tokensBefore`, `tokensAfter`, `summary`.
- `plugins/memory/lib/routes/checkpoints.ts` — `GET /checkpoints?agent=<id>&sessionId=<id>`, `GET /checkpoints/:checkpointId`.
- `plugins/memory/components/checkpoint-table.tsx` — table view.
- `plugins/memory/components/checkpoint-detail.tsx` — summary + back-link to session.

**Files modified:**
- `plugins/memory/lib/indexer.ts` — fill in `indexTier('checkpoint')`.
- `plugins/memory/index.ts` — register routes, wire watcher for `*.checkpoint.*.jsonl`.
- `plugins/memory/components/memory-shell.tsx` — checkpoint tab.
- `plugins/memory/components/session-detail.tsx` — inline checkpoint markers chronologically within turn feed.
- `dev/imitation-crab/seed.ts` — seed one checkpoint file linked to seeded session.

**Acceptance criteria:**
1. `/memory?tier=checkpoint&agent=main` table shows seeded checkpoints.
2. Clicking a row navigates to checkpoint detail with summary + `View owning session` link.
3. Session detail page shows checkpoint markers inline at correct chronological position.
4. Writing a new `.checkpoint.*.jsonl` triggers indexer + appears in UI within ~1s.

**Tests:**
- `tests/plugins/memory/tier-parsers/checkpoint-parser.test.ts` — fixtures for trigger=overflow, trigger=manual.
- `tests/plugins/memory/routes/checkpoints.test.ts`

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev:mock
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — checkpoint parsing notes.

---

## Commit 8 — `feat(memory): dream tier with phase timeline and short-term recall inspector`

**Scope:** `workspace/memory/.dreams/*`, `workspace/memory/dreaming/<phase>/*.md`. Complex because the surface is five artifact types (phase_doc, short_term_recall, phase_signals, events_log, session_corpus).

**Files created:**
- `plugins/memory/lib/tier-parsers/dream-parser.ts` — per-artifact-type parsers → `MemoryRow`. Handles empty `short-term-recall.json` cleanly (common state).
- `plugins/memory/lib/routes/dreams.ts` — `GET /dreams?agent=<id>&phase=&date=`, `GET /dreams/:artifactId`.
- `plugins/memory/components/dream-timeline.tsx` — chronological across phases.
- `plugins/memory/components/dream-artifact-viewer.tsx` — renders markdown for phase docs, JSON for signal files.
- `plugins/memory/components/short-term-recall-table.tsx` — dedicated ranker-signals table for `short-term-recall.json`.

**Files modified:**
- `plugins/memory/lib/indexer.ts` — fill in `indexTier('dream')`.
- `plugins/memory/index.ts` — register routes, wire watcher for `.dreams/**` + `dreaming/**`.
- `plugins/memory/components/memory-shell.tsx` — dream tab with prominent empty-state copy for dormant state.
- `dev/imitation-crab/seed.ts` — seed one phase doc + a dormant `short-term-recall.json` (empty `recalls` array).

**Acceptance criteria:**
1. `/memory?tier=dream&agent=main` renders timeline with seeded phase doc.
2. Empty `short-term-recall.json` shows "No recall traces yet — dreaming is dormant. Details in `memory-plugin.md`." (not a 500 error, not "no results").
3. Writing a new `memory/dreaming/light/2026-04-18.md` triggers reindex + shows in timeline within ~1s.
4. Short-term-recall table shows ranking signals (frequency, relevance, diversity, recency, consolidation, tags) when populated.

**Tests:**
- `tests/plugins/memory/tier-parsers/dream-parser.test.ts` — all 5 artifact types, including dormant cases.
- `tests/plugins/memory/routes/dreams.test.ts`

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev:mock
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — dream artifact taxonomy + dormancy UX.

---

## Commit 9 — `feat(memory): global cross-tier search page + facets UX`

**Scope:** `/memory/search` page + global `useSearch({ plugin: 'memory' })` routing via the auto-wired `/search` route. Tier badge, agent badge, cross-tier result rendering.

**Files created:**
- `src/app/memory/search/page.tsx` — wraps `memory-search-results.tsx` in Suspense.
- `plugins/memory/components/memory-search-results.tsx` — renders cross-tier results with tier+agent badges, timestamp, score, click-through.
- `plugins/memory/components/tier-overview-cards.tsx` — 7 cards on `/memory` overview.

**Files modified:**
- `plugins/memory/components/memory-shell.tsx` — global search bar with `FacetFilter` for tier + agent.
- `src/app/memory/page.tsx` — overview renders tier cards + search bar.
- `src/core/api-search-handler.ts` — verify `bakin_memory` is listed; remove any lingering `bakin_audit` reference.

**Acceptance criteria:**
1. `/memory/search?q=embedding` returns mixed-tier results ranked by semantic score.
2. `/memory` overview shows 7 tier cards with live counts from `bakin_memory`.
3. Tier + agent facet chips filter results via `useQueryArrayState`.
4. Global search endpoint `/api/search?q=X` returns memory results alongside results from other plugins.
5. Clicking a result navigates to the correct tier-scoped detail view.

**Tests:**
- `tests/plugins/memory/routes/status.test.ts` — `GET /status` with indexer health, per-tier counts, watcher state, offset snapshot.
- `tests/plugins/memory/global-search-integration.test.ts` — end-to-end: seed rows in 3 tiers, query via plugin search route, assert mixed results.

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev:mock
# manual: /memory/search?q=<term>, confirm scored cross-tier results
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — facets pattern; `.claude/knowledge/url-state-deep-linking.md` — add `/memory` + `/memory/search` URL params.

---

## Commit 10 — `feat(memory): MCP exec tools (5 tools)`

**Scope:** All 5 tools registered, schema-validated, round-tripped through the MCP server.

**Files created:**
- `plugins/memory/mcp/search.ts` — `bakin_exec_memory_search`
- `plugins/memory/mcp/get-session.ts` — `bakin_exec_memory_get_session`
- `plugins/memory/mcp/get-turn.ts` — `bakin_exec_memory_get_turn`
- `plugins/memory/mcp/list-agents.ts` — `bakin_exec_memory_list_agents`
- `plugins/memory/mcp/status.ts` — `bakin_exec_memory_status`

**Files modified:**
- `plugins/memory/index.ts` — import and `ctx.registerExecTool(...)` all 5.

**Acceptance criteria:**
1. `GET /mcp/tools` lists all 5 new tools with valid schemas.
2. Each tool round-trips via `tests/plugins/test-helpers.ts::callTool`.
3. Args validated via Zod; bad input returns structured error.
4. `bakin_exec_memory_status` returns `{ watcher, offsets, lastIndexedByTier }` with real values.
5. `recordUsage` entries appear for each tool call (already auto-wired in `src/core/mcp-server.ts`).

**Tests:**
- `tests/plugins/memory/mcp/search.test.ts`
- `tests/plugins/memory/mcp/get-session.test.ts`
- `tests/plugins/memory/mcp/get-turn.test.ts`
- `tests/plugins/memory/mcp/list-agents.test.ts`
- `tests/plugins/memory/mcp/status.test.ts`

**Verification:**
```bash
pnpm test tests/plugins/memory/ && pnpm dev:mock
# manual: curl http://localhost:3737/mcp/tools | jq '.tools[] | select(.name | startswith("bakin_exec_memory"))'
```

**Docs impact:** `.claude/knowledge/memory-plugin.md` — MCP tool inventory + args/returns table.

---

## Commit 11 — `docs(memory): knowledge dive, CLAUDE.md, README` ✅

**Status:** Complete. The knowledge-file C11 entry (in `.claude/knowledge/memory-plugin.md`) is the canonical record of what actually landed — including the post-plan additions (retention + TTL prune, schema-version migration, detail drawer, tier colors, System Logs toggle, score breakdown, `/recent` route, dual-debug model). The plan items below match the shipped work.

**Scope:** Final documentation pass. Every change in commits 1–10 that touched knowledge got an incremental note; this commit is the consolidation pass.

**Files created:**
- `.claude/knowledge/memory-plugin.md` — consolidated deep dive. Sections:
  - Overview (what we observe, what we don't)
  - Tier taxonomy + row shapes
  - Access surface matrix
  - Indexer + offsets pattern
  - WS gateway client + subscribe flow
  - CLI wrapper + LanceDB comparison pattern
  - Watcher wiring + incremental JSONL indexing
  - Decision log (why single table + tier facet, per spec decision + GH #104)
  - Nice-to-haves for OpenClaw (reference spec section)

**Files modified:**
- `CLAUDE.md`:
  - `### Directory Map` — update `plugins/memory/` to reflect new structure (tier-parsers, routes, mcp, lib sections)
  - `### Search Indexing` — confirm `bakin_memory` replaces `bakin_audit`
  - New subsection under `### Key Patterns`: `### Memory Observability` — 3-4 lines summarizing the architecture and pointing to the knowledge file
- `README.md` — if it references audit as a separate surface (scan in this commit), update to reference `/memory` instead.
- `.claude/knowledge/search-plugin-guide.md` — add a one-line note about single-table-with-tier-facet pattern.
- `.claude/knowledge/search-system.md` — table inventory updated to reflect `bakin_memory` swap.

**Acceptance criteria:**
1. `.claude/knowledge/memory-plugin.md` exists, covers all 9 sections, and references the spec + plan.
2. `CLAUDE.md` search for "bakin_audit" returns zero matches.
3. `README.md` scan for "audit" (and any misdirected reference to memory/audit as separate surfaces) returns only updated references.
4. All cross-links between spec, plan, and knowledge file resolve.

**Tests:** No code changes → no new tests. Typecheck + existing test suite must still pass.

**Verification:**
```bash
pnpm typecheck && pnpm test
# manual: read .claude/knowledge/memory-plugin.md end-to-end
```

**Docs impact:** This is the docs commit.

---

## Cross-cutting test coverage summary

| Layer | Files | Coverage target |
|---|---|---|
| Tier parsers | 7 parsers × 1 test file each | 100% of edge cases in spec |
| Routes | 8 route files × 1 test file each | Happy path + invalid input + not found |
| MCP tools | 5 tools × 1 test file each | Args validation + success path |
| Indexer | 4+ test files (general + per-tier) | Backfill window, incremental append, size caps, reset-skip |
| Offsets | 1 test file | Concurrent safety |
| Gateway | 2 test files (call + subscribe) | Auth + envelope + error + reconnect |
| CLI | 1 test file | Timeout + JSON parsing + error |
| Plugin activation | 1 test file | Content type registered, watchers wired |
| Global search | 1 test file | Cross-tier query end-to-end |

All tests mock `getContentDir`, logger, watcher, `openclaw-gateway`, `openclaw-cli`, and (where the test is at the indexer layer) `openclaw-adapter`. No test touches `~/.bakin/` or the real gateway.

## Documentation impact summary

| Commit | Doc touched | Change |
|---|---|---|
| C2 | `CLAUDE.md` | `bakin_memory` replaces `bakin_audit` (one line) |
| C2 | `.claude/knowledge/memory-plugin.md` | Create with outline |
| C3 | `memory-plugin.md` | Add audit tier section |
| C4 | `memory-plugin.md` | Add durable tier + chunking |
| C5 | `memory-plugin.md` | Add daily-notes + LanceDB comparison |
| C6 | `memory-plugin.md` | Add session/turn + WS subscribe |
| C7 | `memory-plugin.md` | Add checkpoint tier |
| C8 | `memory-plugin.md` | Add dream tier + dormancy UX |
| C9 | `memory-plugin.md` + `url-state-deep-linking.md` | Facets + URL params |
| C10 | `memory-plugin.md` | MCP tool inventory |
| C11 | `CLAUDE.md`, `README.md`, `search-plugin-guide.md`, `search-system.md` | Consolidation pass |

## Rollback scenarios

| If broken at… | Revert to | Impact |
|---|---|---|
| C11 | C10 | Lose docs polish; plugin is fully functional |
| C10 | C9 | Lose MCP tools; UI still works |
| C9 | C8 | Lose `/memory/search` global page + overview cards; per-tier search still works |
| C8 | C7 | Lose dream tier; other tiers intact |
| C7 | C6 | Lose checkpoint tier; session/turn intact |
| C6 | C5 | Lose session/turn — major regression; daily notes + durable + audit still work |
| C5 | C4 | Lose daily notes; durable + audit still work |
| C4 | C3 | Lose durable; audit still works |
| C3 | C2 | Empty shell only, no working tiers |
| C2 | C1 | Old plugin restored; foundation modules unused but present |
| C1 | pre-rebuild | Back to original state |

## Open items before starting C1

- [ ] Confirm with Mark that commit 2's `bakin_audit` table drop is acceptable with zero shim (spec already approves this, but it's the hard cut-point).
- [ ] Confirm `.claude/specs/memory-plugin-rebuild-PLAN.md` location is correct (per Bakin convention; the skill default would be `tasks/plan.md`).

When the two confirmations land, invoke `/agent-skills:build` with commit 1 as the first slice.
