# Memory plugin

_Living doc for the completed memory plugin rebuild (C1–C11)._

## What it is

A read-only observability dashboard over every runtime memory tier plus Bakin's own audit log. All 7 tiers land in a single Bakin search table (`bakin_memory`) with a `tier` facet discriminator so the whole memory system is semantically and globally searchable through one registration.

## Tiers

| tier | source | status |
|---|---|---|
| `session` | runtime session listing + file-backed fallback | ✅ C6 |
| `turn` | `agents/*/sessions/<sessionId>.jsonl` | ✅ C6 |
| `checkpoint` | `agents/*/sessions/*.checkpoint.*.jsonl` | ✅ C7 |
| `daily_note` | `workspace/memory/*.md` | ✅ C5 |
| `dream` | `workspace/memory/dreaming/**/*.md`, `workspace/memory/.dreams/**/*` | ✅ C8 |
| `durable` | `workspace/*.md` (MEMORY.md, SOUL.md, etc. — canonical bootstrap files) + `workspace/skills/*/SKILL.md` (agent skills). Rows carry a `kind` facet: `soul | rules | tools | identity | heartbeat | memory | memory-log | dreams | user | bootstrap | skill` so the UI can filter by flavor. | ✅ C4 (+ skills v2) |
| `audit` | `~/.bakin/audit.jsonl` | ✅ C3 |

## Module layout

```
plugins/memory/
  index.ts              ─ Plugin shell: content-type registration, indexer
                          wiring, watcher declarations. Intentionally thin.
  types.ts              ─ Re-exports from lib/types.ts for @bakin/memory/types.
  client.tsx            ─ Client entry — calls registerPlugin({ id: 'memory', navItems, slots: { 'page:/memory': MemoryShell } }).
  bakin-plugin.json     ─ Manifest + settings schema.
  components/
    memory-shell.tsx          ─ Landing layout: overview cards + search input +
                                tier/agent facet filters + cross-tier results +
                                detail drawer + "System Logs" toggle.
                                Filters persisted in the URL via useQueryState /
                                useQueryArrayState so the page is bookmarkable.
                                Shows `/recent` when no query, search results when
                                one is active.
    memory-search-results.tsx ─ Cross-tier result list — one card per hit,
                                tier badge + agent badge + score + snippet.
                                Left-edge accent + hover tint from tier-colors.ts.
                                When the global `useDebug()` flag is on AND a
                                query is active, each row renders RRF/BM25/SEM
                                score breakdown (same pattern as messaging
                                session list + asset cards).
                                Handles loading / error / empty-state itself,
                                with a targeted "debug-only matches" CTA when
                                every hit got stripped by the System Logs toggle.
    memory-detail-drawer.tsx  ─ Shared Drawer slideover for a clicked row.
                                Header shows tier badge + agent badge + title.
                                Body: row id, created/updated timestamps,
                                backend + source path, score, then the full
                                content routed through MemoryContentRenderer.
                                Forces JSON rendering for `turn` rows with
                                `meta.eventType='tool_call'` (their content is
                                a JSON toolCall block that the heuristic would
                                mis-classify when argument payloads contain
                                markdown), and forces markdown for daily_note,
                                durable, and dream tiers.
    memory-content-renderer.tsx ─ Auto-detects JSON / Markdown / plain text.
                                JSON requires full parse of the complete body
                                (no partial-prefix matching); markdown requires
                                an explicit marker (fence, heading, list, link).
                                Conservative on purpose — misclassifying a
                                long plain-text body as markdown strips line
                                breaks, misclassifying JSON strips indentation.
                                Callers can pass `format` to override.
    tier-colors.ts            ─ Per-tier visual identity map. Full Tailwind
                                class strings (JIT-safe) for `accent` (4 px
                                left-edge border), `badge` (tier pill),
                                `bg` (hover tint), `dot` (solid-fill swatch
                                for the overview cards), and `label`. One
                                source of truth — change a tier color here.
    tier-overview-cards.tsx   ─ Seven cards on the landing page, one per tier,
                                live counts from /api/plugins/memory/status.
                                Tier order: Sessions, Daily Notes, Dreams,
                                Durable, Checkpoints, Audit, Turns. Audit +
                                Turns render a Microscope glyph — the same
                                icon next to the header "System Logs" toggle
                                — so users can see at a glance that those two
                                counts belong to the opt-in group.
                                Stable geometry even on partial responses.
  lib/
    types.ts            ─ MemoryTier, MemoryRow, per-tier meta schemas (Zod).
    indexer.ts          ─ MemoryIndexer: indexTier, handleWatcherEvent, and the
                          side-effect-free enumerateAll() generator (the blue/
                          green backfill source; throws when the runtime is
                          unavailable so migrations PARK instead of flipping
                          thin). All writes flow through ctx.search → the
                          durable outbox (its acked-hash IS the change
                          detection — no plugin dedupe caches).
    offsets.ts          ─ Incremental JSONL byte-offset tracking (atomic rename).
    runtime-memory.ts   ─ Thin helpers over ctx.runtime.memory for tier
                          discovery, list, and detail reads.
    tier-parsers/
      audit-parser.ts     ─ Pure line → MemoryRow parser for ~/.bakin/audit.jsonl.
      durable-parser.ts   ─ H1/H2 chunker for canonical bootstrap files;
                            one MemoryRow per heading chunk. Populates
                            `kind` via `durableKindForBasename()`. Exports
                            `chunkByHeadingExported` so the skill parser
                            can reuse the same chunker without copy/paste.
      skill-parser.ts     ─ Per-skill SKILL.md file → rows with
                            `tier='durable', kind='skill'`. Row id
                            `skill:<sha256(agent|skill|skillName|chunkIndex)>`.
                            Title composed as `<skillName> — <heading>`
                            for headed chunks, plain `<skillName>` for
                            level-0 pre-heading chunks.
      daily-note-parser.ts ─ Whole-file → MemoryRow; filename must match
                            /^(\d{4}-\d{2}-\d{2})([-.].*)?\.md$/ — invalid names return null.
      session-parser.ts   ─ (agent, sessionKey, raw) → MemoryRow. Kind extracted
                            from the key (`main|openai|discord|…`); fields that
                            the FS `sessions.json` omits (status, startedAt,
                            runtimeMs, systemSent, estimatedCostUsd) nullable.
      turn-parser.ts      ─ (agent, sessionId, sessionKey, line, offset) → MemoryRow | null.
                            Skips non-message envelopes (session header,
                            model_change, thinking_level_change, custom*).
                            Classifies assistant messages with toolCall blocks
                            as `tool_call` rows, text-only as `message`.
                            32 KB byte-aware truncation; `rawByteOffset`
                            always populated so the UI can jump back to the
                            source line regardless of truncation.
      checkpoint-parser.ts ─ (agent, sessionId, checkpointId, filename, body)
                            → MemoryRow | null. First `type=compaction` event
                            wins; summary becomes content; trigger derives from
                            `fromHook` (true→auto, false→manual, absent→unknown);
                            `tokensAfter` stays null when the runtime does not
                            expose it. Also exports `matchCheckpointFilename`.
      dream-parser.ts     ─ Five artifact types from DreamArtifactTypeSchema
                            (phase_doc, short_term_recall, phase_signals,
                            events_log, session_corpus). `parsePhaseDoc` requires
                            YYYY-MM-DD filename; `parseDreamSignal` classifies via
                            `classifyDreamSignal(relPath)`. Dormant (empty) bodies
                            still emit rows so the UI can show friendly copy
                            instead of a mysterious absence. 2 KB snippet cap.
    ttl-prune.ts        ─ Daily sweep for turn/audit rows past the retention
                          window. One-shot at boot, then `setInterval(DAY_MS)`.
                          `scanTable` + `batchRemove(100)` — safe on tables
                          with ≤100k rows (actual size ~20k with debug data).

    routes/
      audit.ts        ─ GET /audit — tier='audit' facet query + agent/event filters.
      durable.ts      ─ GET /durable?agent=<id> (list), GET /durable/:agent/:basename (render).
      daily-notes.ts  ─ GET /daily-notes?agent=<id> (sorted by date desc),
                        GET /daily-notes/:agent/:filename (render),
                        POST /daily-notes/compare-search (Bakin search vs runtime memory search).
      sessions.ts     ─ GET /sessions?agent=<id>[&kind] (gateway-first, FS fallback),
                        GET /sessions/:agent/:sessionKey (detail, live re-fetch),
                        GET /sessions/:agent/:sessionKey/turns (search query, tier=turn),
                        GET /turns?agent=<id>&sessionId=<id> (by id form).
      checkpoints.ts  ─ GET /checkpoints?agent=<id>[&sessionId=<id>] (search, tier=checkpoint),
                        GET /checkpoints/:agent/:sessionId/:checkpointId (detail via
                        meta scan — routes never re-parse files).
      dreams.ts       ─ GET /dreams?agent=<id>[&phase=&date=&artifactType=] (Antfly,
                        tier=dream, post-filters by phase/date/artifactType),
                        GET /dreams/:agent/:artifactType[?phase=&date=] (detail via
                        meta scan — phase_doc needs phase+date, session_corpus
                        needs date, others identified by artifactType alone).
      status.ts       ─ GET /status — one Antfly count per tier (`limit: 0`),
                        returns `{ countsByTier, totalRows, offsetsTracked, lastUpdated }`.
                        Tolerant of per-tier failures (→ 0 for that tier).
                        Forces `strategy: 'full_text_only'` — semantic search
                        rejects `limit: 0` with "topk must be positive".
      recent.ts       ─ GET /recent?limit=&tier=&agent=&debug= — cross-tier
                        activity feed for the landing page when no query is
                        active. Fans out per (tier, agent) with match-all
                        (`q='*'`, `strategy='full_text_only'`, overshoot=100),
                        merges, sorts by `updated_at` desc, trims to limit.
                        Turn + audit excluded by default; `?debug=1` or an
                        explicit `?tier=turn|audit` chip opts them back in.
  mcp/
    search.ts       ─ bakin_exec_memory_search — hybrid query over bakin_memory,
                      optional tier/agent filters, limit default 20 / max 100.
    get-session.ts  ─ bakin_exec_memory_get_session — session row + recent turns
                      matched by parsed meta.sessionKey.
    get-turn.ts     ─ bakin_exec_memory_get_turn — fetch a single turn by id,
                      returns full (non-truncated) content + parsed meta.
    list-agents.ts  ─ bakin_exec_memory_list_agents — per-agent per-tier counts
                      via Antfly aggregations. Sorted by total desc.
    status.ts       ─ bakin_exec_memory_status — counts + offsetsTracked +
                      lastUpdated, same shape as GET /status.
```

## Invariants

- **Bakin reads runtime memory + dispatches cleanup tasks; it never writes
  runtime-memory content.** Runtime memory comes through `ctx.runtime.memory`.
  The cleanup feature (below) makes content changes by dispatching a task to the
  owning agent — the agent edits its own files. The only Bakin-side write is the
  agent-package `.userEdited` projection sentinel (Bakin's own projection layer,
  not runtime-memory content).
- **One content type, one table.** `bakin_memory`. The contract test (`getTableForPlugin`) enforces this.
- **The runtime adapter is the only runtime-home reader.** All other modules
  (indexer, parsers, routes) must go through typed runtime memory surfaces.
- **Path resolution goes through adapter APIs.** No hardcoded runtime-home
  strings.
- **Offsets are atomic.** `writeFileSync(tmp)` → `renameSync(tmp, file)` — never truncate-in-place.
- **Tests mock everything.** `getContentDir`, logger, watcher, runtime adapters,
  vault/settings shims as needed, and any adapter-private home resolver touched
  by the test.

## Memory cleanup (find → dispatch → verify)

Stale content (e.g. an old product name) that lives in the **source** memory
files keeps steering agents because the harness re-reads those files every
session — and Bakin's index is just a read-only derived copy, so deleting an
index row changes nothing for the agent. The cleanup feature fixes the source
without Bakin ever writing runtime-memory content:

1. **Find** (`POST /cleanup/find` `{term, agent?}`) — queries every tier with the
   match-all/full-text strategy, then **exact-substring-filters `content`** (so
   semantic ranking can't leak false hits), groups true occurrences by agent, and
   labels each hit **actionable** (`durable`/`daily_note`/`dream` — agent-editable
   markdown) or **informational** (`session`/`turn`/`checkpoint`/`audit` —
   append-only / self-healing, left alone). Actionable durable hits whose source
   carries an `.installedBy` sidecar are flagged `managed`.
2. **Dispatch** (`POST /cleanup/dispatch` `{term, action:'replace'|'remove',
   replacement?, agents[], instruction?}`) — re-finds each agent server-side,
   composes a task from the actionable hits (`composeTask`), and creates **one task
   per agent** via `ctx.tasks.create` so the agent edits its own files. Agents with
   no actionable hits are skipped. For `managed` targets it sets the `.userEdited`
   sentinel (`@bakin/core/agent-packages/markers`) — meaningful for SKILLS
   (sync skips sentineled skills until reclaimed); workspace files ignore
   sentinels under the block model (agent content outside the managed block
   survives sync anyway). Each dispatch audits `memory.cleanup_dispatched`.
3. **Verify** (`POST /cleanup/verify` `{term, agents[]}`) — re-runs the find per
   agent; `clean` keys on actionable-remaining (informational tiers don't count).

Pure core in `lib/cleanup.ts` (`contentMatches`, `matchingSnippets`, `tierLabel`,
`groupByAgent`, `composeTask`); routes in `lib/routes/cleanup.ts`; UI in
`components/memory-cleanup.tsx` (reached via the `?mode=cleanup` header toggle).
**No `bakin_memory` schema change, no new table** — so the single-table decision
(#104) stands unchanged. No MCP tools in v1 (operator-initiated).

## Settings

Lives at `~/.bakin/plugin-settings/memory.json`. Fields:

| key | default | meaning |
|---|---|---|
| `backfillDays` | `30` | On first activation, index this many days of history across all tiers. |
| `skipSessionOverBytes` | `10485760` | Transcripts larger than this are skipped. |
| `skipResetBackups` | `true` | Skip `*.reset.*.jsonl` historical backups. |
| `runtimeComparisonEnabled` | `true` | Show runtime daily-note recall alongside Bakin search results. |
| `turnRetentionDays` | `7` | Drop turn rows older than this at write time and in the daily prune. The runtime still owns the source transcript. |
| `auditRetentionDays` | `30` | Drop audit rows older than this at write time and in the daily prune. |

## Retention + TTL prune

Two write-path + sweep-path filters keep the noisy tiers bounded:

- **Write-path filter.** `MemoryIndexer.isExpired(row)` short-circuits `writeRow` for turn/audit rows whose `updatedAt` falls outside the retention window. No DB round-trip. Live indexing from watcher events never pollutes the index with rows destined for immediate deletion.
- **Sweep-path prune.** `plugins/memory/lib/ttl-prune.ts:pruneExpired` scans `bakin_memory` via `antfly.scanTable`, collects keys whose `(tier, updated_at)` combo is past the cutoff, and batch-removes in groups of 100. Runs once at boot (catches rows indexed before the retention policy landed — the schema-version migration now handles this, but the one-shot prune is kept as a defense in depth) and then on `setInterval(DAY_MS)`.
- **Timer ordering.** `onReady` arms the daily timer *before* awaiting the one-shot prune. A slow initial prune (or a first call racing a cold Antfly) must not gate the recurring sweep.

Tiers other than turn/audit have no retention — they're bounded by their own source file count.

## Schema changes

Bump the content type's `schemaVersion` in the memory registration — the
table blue/green-migrates in the background (backfill from `enumerateAll()`,
queries pinned to the old table until convergence). There is no per-plugin
migration module, no marker file, no drop-and-backfill: the old
`memory-migration.ts` + boot backfill + persisted dedupe cache were deleted
in the 2026-07 search rebuild. Offline file growth (agents appending while
Bakin was down) is caught by the doctor's stat-level size-vs-offset check —
never a boot scan.

## Page-local debug ("System Logs") vs global debug

Two distinct toggles with different jobs:

| toggle | source | scope | shown when off |
|---|---|---|---|
| **System Logs** (Microscope icon in page header) | `?debug=1` URL param, via `useQueryState` | Page-local. Controls `/recent` tier selection + client-side post-filter on search results. | Turn + Audit tiers stripped from the feed. |
| **Global Debug** (Bug icon in app header) | `useDebug()` hook → Zustand + `localStorage.bakin-debug` | App-wide. Currently controls activity-feed duplicate visibility, asset search score overlays, and the score breakdown on `/memory` result rows. | Score breakdown collapses to the plain RRF score. |

They're intentionally separate — a user debugging a search-quality issue wants the global debug on (to see BM25 / SEM scores) without necessarily wanting the noisy tiers. Vice versa for operators reviewing audit activity.

## Commit history (this rebuild — HISTORICAL; `memory-migration.ts` and the boot backfill described below were deleted in the 2026-07 search rebuild)

- C1 — `feat(memory): foundational modules (types, adapter, gateway, cli, offsets)`
- C2 — `refactor(memory): rewrite plugin shell, drop bakin_audit, register bakin_memory`
- C3 — `feat(memory): audit tier indexed into bakin_memory` ✅
  - Pure watcher pattern: `appendAudit` writes disk + broadcasts SSE, memory plugin's indexer picks up audit.jsonl changes and indexes them incrementally using persisted byte offsets. No cross-module hook between core audit and the memory plugin.
  - Legacy `bakin_audit` table, `TABLES.audit`, and `indexAuditEvent` removed from the old core search wrapper with no shim.
  - Stable row IDs: `audit:<16-char-sha256-of-ts|event|agent>` — re-indexing produces no duplicates.
  - Truncation handled: `stats.size < persistedOffset` → restart from offset 0.
  - Trailing incomplete lines (no newline yet) are preserved until the next watcher event.
- C4 — `feat(memory): durable tier indexed by heading chunk` ✅
  - Canonical bootstrap files (`SOUL.md`, `MEMORY.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `DREAMS.md`, `MEMORY-LOG.md`) chunked on H1/H2 boundaries — one row per chunk. H3+ headings stay inside the enclosing H2 body. Files with no headings → single chunk (`headingLevel=0`, `chunkIndex=0`).
  - Stable row ids: `durable:<16-char-sha256(agent|basename|chunkIndex)>` — chunk count is tracked per file so shrinking a file (e.g. deleting an H1) removes the now-orphan chunk keys on reindex.
  - Adapter exposes `durableFilePath`, `durableFileMtime`, and `matchDurablePath(path)` so the watcher can map a fs path back to an `(agent, basename)` pair without re-listing agents everywhere.
  - Routes: `GET /api/plugins/memory/durable?agent=<id>` lists canonical files present for that agent; `GET /api/plugins/memory/durable/:agent/:basename` returns `{ agent, file, content }`. Both delegate to the runtime adapter — no direct provider-home reads in route code.
- C5 — `feat(memory): daily-notes tier with runtime/search comparison toggle` ✅
  - One row per runtime daily-note file — no chunking. Runtime memory search usually treats daily notes as whole documents, and they tend to be short-form; splitting them would just fragment recall.
  - Stable row ids: `daily_note:<16-char-sha256(agent|filename)>`. Filename validation via `/^(\d{4}-\d{2}-\d{2})([-.].*)?\.md$/` — `random.md` or `notes.md` return null from the parser and are skipped.
  - Adapter extended with `dailyNotePath`, `dailyNoteMtime`, `dailyNoteSize`, and `matchDailyNotePath(path)`. The matcher handles both `workspaces/<agent>/memory/` and the main-agent collapsed `workspace/memory/` layout, and excludes subdirectories like `memory/.dreams/` and `memory/dreaming/`.
  - `POST /daily-notes/compare-search` is the whole point of this tier: it runs the same query against both substrates in parallel and returns `{ search, runtime, runtimeStatus, runtimeError? }` so the UI can show a diff. `runtimeStatus` is `'ok' | 'no_index_or_no_match' | 'error'` — the UI treats the last two as non-fatal since runtime memory indexes may not be populated.
  - Runtime side calls `ctx.runtime.memory.search`; Bakin search side reuses the plugin's unified `bakin_memory` query with `{ tier: 'daily_note' }` filter.
- C6 — `feat(memory): session + turn tiers with WS-driven live updates` ✅
  - **Session tier.** Data source is `ctx.runtime.memory` / `ctx.runtime.sessions`; the runtime adapter owns any gateway/filesystem fallback needed by the provider. Parsers tolerate the session metadata shapes the adapter returns, but routes and indexers do not read provider files directly.
  - Row ids: `session:<16-char-sha256(agent|sessionKey)>`. Orphan removal runs on every re-index — the indexer tracks `lastSessionKeys: Map<agent, Set<sessionKey>>` and `ctx.search.remove()`s any key that disappeared between runs. Session keys are never rewritten, so this is safe.
  - 30-day backfill window enforced via `opts.backfillDays` — sessions with `updatedAt < now - backfillDays*86_400_000` are skipped. Sessions with missing `updatedAt` pass through (we've got nothing to compare against).
  - Parser defaults fill the gaps between gateway-rich data and FS-sparse data: `status: 'unknown'`, `endedAt: updatedAt`, `origin: null` when unavailable. The row is still useful for row-count and token-rollup surfaces without them.
  - **Turn tier.** One row per useful JSONL event. Skipped types: `session` header (surfaced via the session tier instead), `model_change`, `thinking_level_change`, any `custom` / `custom_message`, and unknown types. Current runtime transcripts encode tool calls as assistant `message` envelopes with `toolCall` content blocks, so the parser classifies by inspecting the content blocks: any `toolCall` present → `tool_call` row; otherwise `message`. `toolResult` rows surface `toolName` and `toolCallId` from the envelope.
  - Row ids: `turn:<16-char-sha256(agent|sessionId|eventId)>`. Content is byte-sliced at 32 KB with `truncated: true` and `rawByteOffset` set to the line's byte offset in the source file — the UI can always jump back to the original line regardless of truncation.
  - **Oversize handling.** Files whose reported size exceeds `skipSessionOverBytes` (default 10 MB) go through a head-only chunker: the first 4 MB are read, parsed, and capped at 2000 rows; no offset is persisted so a later resize doesn't skip the (still-unseen) middle. Full tail-chunking is a follow-up. The reported size comes from `listSessionJsonlFiles(agent).size` (gateway or `statSync`); actual byte reads use `statSync(path).size` so the mocked-size test still exercises the head-path while reading the real tempfile's bytes.
  - **Incremental offsets.** Normal-sized files use the same offset/range pattern as the audit tier through runtime memory reads. Persisted offsets live in `~/.bakin/plugin-settings/memory/offsets.json`; a second call on an unchanged file reads zero bytes and emits zero rows. If the runtime source shrinks, offset resets to 0 and the next call re-indexes from the start.
  - **Watcher routing.** Chokidar `file.change` on `agents/*/sessions/sessions.json` → `matchSessionStorePath` → re-index that agent's sessions. `file.change` on `agents/*/sessions/<id>.jsonl` → `matchSessionJsonlPath` → turn re-index for that session, skipping `*.reset.*.jsonl` backups. `unlink` on a session JSONL resets the offset so a later recreate starts fresh; `unlink` on `sessions.json` is a no-op (the next gateway call will reflect reality).
  - **WS live updates.** `gatewaySubscribe('sessions.subscribe', {})` runs best-effort at activation — each frame kicks off a session re-index. If the WS dial fails, chokidar on `sessions.json` is the safety net (see the three-consistency-paths architecture in `search-system.md`), so a dead gateway just means slightly higher latency, not broken correctness.
  - **Routes.** `GET /sessions[?agent=&kind=]` (gateway-first list, sorted by `updatedAt` desc), `GET /sessions/:agent/:sessionKey` (detail, re-fetches at request time so a freshly-connected UI doesn't lag the roster), `GET /sessions/:agent/:sessionKey/turns` (search query with `tier=turn, agent=…` filters plus the sessionKey as the q-string — `meta` is indexed as text so the query narrows to the session without a dedicated facet), `GET /turns?agent=&sessionId=` (convenience form for callers that only know the session id). `limit` is clamped to `[1, 500]` with default 100.
- C7 — `feat(memory): checkpoint tier` ✅
  - **Source.** One `<sessionId>.checkpoint.<checkpointId>.jsonl` sibling of a session transcript → one row. The file replays the session header + messages up to the compaction point and ends with one `type=compaction` event. The parser scans lines for the first compaction, ignores the replayed transcript (those rows belong to the turn tier), and treats additional compactions in the same file (rare) as duplicates the first one wins.
  - **Field surfacing.** `summary` becomes `content` / `snippet` (2 KB cap). `tokensBefore` carried through unchanged; `tokensAfter` stays `null` when the runtime does not emit it. `trigger` derives from `fromHook`: `true → 'auto'`, `false → 'manual'`, absent → `'unknown'`. `createdAt` is ISO-parsed from the compaction's `timestamp`, falling back to file mtime if missing or unparseable.
  - Row ids: `checkpoint:<16-char-sha256(agent|sessionId|checkpointId)>`. Stable across re-indexing; unlink removes the row.
  - **Adapter additions.** `listCheckpointJsonlFiles(agent)` returns `{agent, sessionId, checkpointId, filename, path, size, mtimeMs}[]`; `checkpointJsonlPath`, `checkpointJsonlStat`, and `matchCheckpointJsonlPath(path)` round out the watcher surface. The existing `listSessionJsonlFiles` already excludes `*.checkpoint.*.jsonl` so session + checkpoint backfills don't double-index the same files.
  - **Watcher routing.** `file.add` and `file.change` on `agents/*/sessions/*.checkpoint.*.jsonl` route through `matchCheckpointJsonlPath` → `indexCheckpointFile`. `unlink` removes the derived row id directly (no per-file state to forget beyond Antfly's own row). The top-level watch glob (`agents/*/sessions/*.jsonl`) already covers checkpoint files — no new path added.
  - **Routes.** `GET /checkpoints?agent=<id>[&sessionId=<id>&limit=&offset=]` runs a search query with `{tier: 'checkpoint', agent}` filters and the optional `sessionId` as the q-string (meta is indexed as text, so the query narrows without needing a dedicated facet). `GET /checkpoints/:agent/:sessionId/:checkpointId` does the same query with `q=sessionId checkpointId`, then filters the first 20 results by JSON-parsing each row's `meta` field and matching both ids exactly — malformed meta is tolerated and treated as a non-match. Routes never touch the filesystem; the indexer is the single source of truth.
- C8 — `feat(memory): dream tier` ✅
  - **Source.** Five artifact types (`DreamArtifactTypeSchema`): `phase_doc` (one per `workspace/memory/dreaming/<phase>/<YYYY-MM-DD>.md`), `short_term_recall` (`.dreams/short-term-recall.json`), `phase_signals` (`.dreams/phase-signals.json`), `events_log` (`.dreams/events.jsonl`), `session_corpus` (`.dreams/session-corpus/<YYYY-MM-DD>.{md,txt}`). One `MemoryRow` per file — no chunking.
  - **Dormant state is real.** Some fresh runtime installs expose dream signal files that are present but empty. The parser still emits rows with empty content so the UI can show "dormant" copy rather than a mysterious absence. Phase docs whose filename lacks a YYYY-MM-DD prefix are rejected (not dormant — they're just bad names).
  - Row ids: `dream:<16-char-sha256(agent|artifactType|key)>` where `key` is `<phase>|<date>` for `phase_doc`, the date for `session_corpus`, and the `artifactType` itself for the three no-key signals. Unlink derives the same id and removes it.
  - **Adapter additions.** `listPhaseDocs(agent)` walks `workspace/memory/dreaming/<phase>/*.md`; `listDreamSignalFiles(agent)` enumerates `.dreams/` flat files plus a single-level `session-corpus/` subdir (no deeper recursion). `readPhaseDoc(agent, phase, filename)` and `readDreamSignal(agent, relPath)` both block path traversal. `matchPhaseDocPath(path)` and `matchDreamSignalPath(path)` round-trip filesystem paths back to `(agent, phase, filename)` or `(agent, relPath)` for watcher routing, handling both the collapsed main-agent workspace and per-agent `workspaces/<id>/` layouts.
  - **Watcher routing.** `file.add` / `file.change` on a phase doc path → `indexPhaseDoc`; on a signal file path → `indexDreamSignal`. `unlink` derives the row id from the filename (for phase docs, the `YYYY-MM-DD` prefix) or from `classifyDreamSignal(relPath)` and removes it. The existing watch glob (`workspace/memory/**/*`, `workspaces/*/memory/**/*`) already covers both path shapes.
  - **Routes.** `GET /dreams?agent=<id>[&phase=&date=&artifactType=]` runs a search query with `{tier: 'dream', agent}` filters, passes the phase/date/artifactType terms as the q-string for BM25 scoring, then post-filters the results by JSON-parsing each row's `meta`. `GET /dreams/:agent/:artifactType[?phase=&date=]` does the same query narrowed by the artifactType term and finds the first row whose meta matches all provided fields. Malformed meta is tolerated as a non-match. Routes never touch the filesystem; the indexer is the single source of truth.
- C9 — `feat(memory): global search + facets UX` ✅
  - **Status route.** `GET /status` runs one search query per tier with `limit: 0` — we only need `meta.total`. A single failing tier returns 0 rather than erroring the whole response; `/memory` is a dashboard, not a source of truth. Also reports `offsetsTracked` (count of keys in `offsets.json`) and `lastUpdated` (server timestamp of the snapshot).
  - **Integration test.** `tests/plugins/memory/global-search-integration.test.ts` proves the round-trip: plugin activates, fake Antfly returns rows from three tiers (`session`, `daily_note`, `audit`), the auto-wired `/search` route preserves tier, agent, id, and meta unchanged. This is the contract for cross-plugin search — if it breaks, the unified-table story breaks.
  - **Client components.** `MemorySearchResults` renders one card per hit, tier and agent as badges, relevance score, and the snippet — handles its own loading / error / empty states so page code stays thin. `TierOverviewCards` fetches `/status` on mount, renders seven fixed cards in a stable grid, falls back to `0` for any tier missing from the response.
  - **Shell wiring.** `MemoryShell` is the whole `/memory` landing page: overview cards → search input → tier + agent facet filters → results list. Search and filter state all live in the URL (`?q=…&tier=…&agent=…`) via `useQueryState` / `useQueryArrayState`, so the page is bookmarkable and browser back/forward round-trip the view. Facet aggregations come from Antfly's `aggregations.agent` and `aggregations.tier` — the agent facet only appears once there's data to populate it, which avoids showing an empty dropdown on a fresh install.
  - **No sub-route.** The search surface is the landing page — `/memory/search` is intentionally not created. One URL, one view, no internal redirects.
  - No changes needed to `src/core/api-search-handler.ts` — the unified `bakin_memory` table flows through the existing cross-plugin pipeline. The only stale reference was a doc comment in `src/core/audit.ts`, which correctly names the new table.
- C10 — `feat(memory): MCP exec tools` ✅
  - Five agent-facing tools, one per file under `plugins/memory/mcp/`, each a factory `(ctx: PluginContext) => ExecToolDefinition`. Factory pattern (vs inline in `index.ts` like schedule) is spec-mandated and keeps per-tool tests small and focused.
  - `bakin_exec_memory_search` — thin wrapper over `ctx.search.query` with `tier` (enum-validated against `MemoryTierSchema`) and `agent` as optional filters. Limit defaults to 20, clamps to 100. Returns `{ id, tier, agent, title, snippet, score, sourceRef, updatedAt, meta }` — `meta` is JSON-parsed so the agent consumer doesn't have to.
  - `bakin_exec_memory_get_session` — two queries: session row (tier=session, sessionKey as q-string, match by parsed `meta.sessionKey` since id is a hash), then turns (tier=turn, same q-string, match by `meta.sessionKey`). Agent filter narrows both. 404s as `{ok:false, error:'session not found'}`.
  - `bakin_exec_memory_get_turn` — single lookup by `turn:<hex>` id. Validates the `turn:` prefix. Returns full `content` (not the snippet) so agents can read past the 32 KB turn truncation cap via the indexer's on-disk line offset if they want more.
  - `bakin_exec_memory_list_agents` — seven parallel Antfly queries, one per tier, each asking for `facets: ['agent']` aggregations. Pivots the per-tier agent buckets into `{agent, total, byTier}` and sorts by total desc. Per-tier failures degrade that tier's contribution to 0 rather than erroring the whole tool.
  - `bakin_exec_memory_status` — same counts-by-tier logic as the `/status` REST route, wrapped in the exec-tool envelope so agents don't need an HTTP round-trip. Per-tier failures → 0.
  - All five tools are wired via `ctx.registerExecTool()` in `plugins/memory/index.ts:activate()`; the plugin-activation test pins the exact name set so we can't silently drop one.
- C11 — `docs(memory): final knowledge pass + CLAUDE/README` ✅
  - **UX polish.** Swapped the Debug `Button` for a `Switch` in the page header, relabelled "Enhanced Debugging" → **System Logs**, moved the icon to `Microscope`, and added the same Microscope glyph to the Audit + Turns overview cards so users can see which counts belong to the opt-in group. Reordered the overview cards: Sessions, Daily Notes, Dreams, Durable, Checkpoints, Audit, Turns (usefulness descending, System Logs at the end).
  - **Per-tier colors.** New `plugins/memory/components/tier-colors.ts` — one source of truth for the 7 tier color families. Each style has `accent` (4 px left border on result cards), `badge` (tier pill), `bg` (hover tint on clickable rows), `dot` (solid-fill for overview-card swatches), and `label`. Full Tailwind class strings so the JIT compiler picks them up at build time — changing a tier color means editing one file.
  - **Detail drawer.** New `MemoryDetailDrawer` over the shared `Drawer` (storage key `"memory"`) so the slideover width persists across the app. Click any result row → drawer opens with tier/agent badges, row id, timestamps, backend, source path, score, then the full `content` and the parsed `meta`. `MemoryContentRenderer` auto-detects JSON (full-parse heuristic — no partial prefix match), markdown (requires an explicit marker: fence, heading, list, link), or plain text; the drawer forces JSON for turn `tool_call` rows and markdown for daily_note/durable/dream.
  - **Score breakdown.** When the global `useDebug()` flag is on AND a query is active, each result row renders RRF / BM25 / SEM side by side (amber / cyan / purple, same palette as messaging session list + asset cards). BM25 key is sniffed dynamically via `/bleve|full_text/.test(k)` because Bleve's index key is an absolute filesystem path — can't hard-code.
  - **Cross-tier `/recent` feed.** New `lib/routes/recent.ts` — the landing page's no-query state. Fans out match-all (`q='*'`, `strategy='full_text_only'`) per (tier, agent) pair with an overshoot of 100, merges, sorts by `updated_at` desc client-side, trims to the requested limit (default 30, max 100). Turn + audit excluded by default; `?debug=1` (from the page-local System Logs toggle) or an explicit `?tier=turn|audit` chip opts them back in. Per-tier failures degrade to `[]` without poisoning the merged response.
  - **Retention + TTL prune.** New `IndexerOptions.{turnRetentionDays, auditRetentionDays}` (defaults 7 / 30) + write-path `isExpired(row)` short-circuit in `writeRow`. New `lib/ttl-prune.ts` provides `pruneExpired(config)` (`scanTable` + `batchRemove(100)`) and `startTtlTimer(config, intervalMs=DAY_MS)` / `stopTtlTimer()` as a globalThis-backed singleton (survives Bun HMR and module re-evaluation). `onReady` arms the timer *before* awaiting the one-shot prune — a slow cold start can't block the recurring sweep.
  - **Schema-version migration.** New `lib/memory-migration.ts` with `MEMORY_SCHEMA_VERSION = 1` and a marker at `plugin-settings/memory/schema-version.json`. On version gap: drop `bakin_memory`, unlink `offsets.json` + `clearAllOffsets()`, `ensureRegisteredTables()` to recreate, bump marker. Intentionally per-plugin — bumping the global search-state version wipes every `bakin_*` table, which is the wrong hammer for "memory's retention rules changed".
  - **Lifecycle contract.** `plugins/memory/index.ts`'s module-level `ready` flag gates watcher event handlers until `onReady()` fires; `tests/plugins/memory/plugin-lifecycle.test.ts` pins this contract with both the negative case (pre-onReady events don't reach `indexer.handleWatcherEvent`) and the positive case (post-onReady events do).
  - **Docs.** `.claude/knowledge/memory-plugin.md` (this file) updated with the new modules, routes, UX, retention, migration, and dual-debug model. `CLAUDE.md §Memory Observability` gets a sentence on retention + migration. The rebuild plan marks C11 complete.

## URL state (see also `.claude/knowledge/url-state-deep-linking.md`)

- `?q=<term>` — active search query.
- `?tier=session,daily_note` — active tier filter (comma-separated, multi-select).
- `?agent=<id>` — active agent filter (single-select; `all` / omitted means no agent filter). Rendered as the shared avatar-strip `AgentFilter` component (same widget as schedule/messaging/models/tasks), with a tooltip showing the display name per avatar.
- `?kind=soul,skill` — active durable-kind filter (comma-separated, multi-select). Only rendered on `/memory` when `tier=durable` is the sole selected tier — filtering by kind outside durable silently matches nothing. A client effect auto-clears `?kind=` when the facet hides so a stale bookmark can't strip the feed invisibly.
- `?debug=1` — page-local "System Logs" toggle. Distinct from the global `useDebug()` Zustand flag.
- `?recordId=<rowId>` — exact-record deep link; opens `MemoryDetailDrawer` for that row (the ⌘K hit-renderer target). See "Exact-record deep link" below.

All are omitted when at their default (empty / `'0'`); `MemoryShell` wraps its content in `<Suspense>` per the hook contract. When a debug-only tier is currently selected via URL but the System Logs toggle is off, the tier chip stays visible so the user has a way to remove it — otherwise it would filter silently with no affordance to clear.

## Exact-record deep link (`/record` + `?recordId=`)

⌘K memory hits deep-link to the exact clicked row (`/memory?recordId=<rowId>`), not a fuzzy re-search.

- **Route** — `lib/routes/record.ts`: `GET /record?id=<rowId>` resolves a unified rowId (`<tier>:<hash>`; the `skill:` prefix maps to the **durable** tier, whose enumeration emits skill rows) by parsing the tier prefix and consuming the side-effect-free `enumerateTier()` generator until the key matches (lazy — stops at first hit). The **audit tier** goes through `MemoryIndexer.findAuditRowById()` — a line-streaming reader with early exit (audit.jsonl is append-only and unbounded; `collectAuditRows()` slurps the whole file into one Buffer, which must never happen per-request) that applies the same `isExpired()` retention filter as live indexing; I/O errors log + rethrow (500), never masked as 404. Deliberately search-engine-independent: the deep link resolves even when antfly is down. (Index-first exact-id lookup was tried and rejected — row keys are not indexed as searchable text, so `q=<rowId>` returns unrelated hits; the old `bakin_exec_search_lookup` shipped broken on the same trick before moving to `SearchAdapter.documents.get`.) 400 on malformed/unknown-prefix ids, 404 on no match. Response is SearchResult-shaped (`{ result: { id, table, fields, score } }`) for direct drawer consumption.
- **Client** — `components/use-record-deep-link.ts` (`useRecordDeepLink`): `?recordId=` drives `MemoryDetailDrawer`. Deep links ALWAYS resolve via `/record` (source-of-truth files) — never from on-screen rows, because the `&q=` href fallback fills the list with the row's stale INDEX copy and short-circuiting on it would silently reopen a pruned record. Only `open()` (an explicit list click) skips the fetch; switching records clears the stale row while the new one resolves. `open()` uses the **push-mode** setter so the back button closes the drawer (same pattern as schedule's `jobId`). A miss renders an honest "Memory record not found — it may have been pruned." notice (`data-testid="memory-record-error"`) — never a *silent* fallback; the `&q=<snippet>` in the ⌘K href means the miss lands on the notice **plus** the closest matches instead of a dead end.
- **Settings extraction** — `lib/settings.ts` holds `MemorySettings`, `DEFAULTS`, and `resolveIndexerOptions(ctx)` shared by `activate()` and the route (avoids a routes → index import cycle and keeps retention filters identical between live indexing and record resolution).
