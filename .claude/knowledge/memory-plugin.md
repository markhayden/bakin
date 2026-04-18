# Memory plugin

_Living doc — grows commit by commit during the memory plugin rebuild. Final polish lands in C11._

## What it is

A read-only observability dashboard over every OpenClaw memory tier plus Bakin's own audit log. All 7 tiers land in a single Antfly table (`bakin_memory`) with a `tier` facet discriminator so the whole memory system is semantically and globally searchable through one registration.

## Tiers

| tier | source | status |
|---|---|---|
| `session` | OpenClaw gateway `sessions.list` + `agents/*/sessions/sessions.json` fallback | ✅ C6 |
| `turn` | `agents/*/sessions/<sessionId>.jsonl` | ✅ C6 |
| `checkpoint` | `agents/*/sessions/*.checkpoint.*.jsonl` | ✅ C7 |
| `daily_note` | `workspace/memory/*.md` | ✅ C5 |
| `dream` | `workspace/memory/dreaming/**/*.md`, `workspace/memory/.dreams/**/*` | ✅ C8 |
| `durable` | `workspace/*.md` (MEMORY.md, SOUL.md, etc. — canonical bootstrap files) | ✅ C4 |
| `audit` | `~/.bakin/audit.jsonl` | ✅ C3 |

## Module layout

```
plugins/memory/
  index.ts              ─ Plugin shell: content-type registration, indexer
                          wiring, watcher declarations. Intentionally thin.
  types.ts              ─ Re-exports from lib/types.ts for @bakin/memory/types.
  client.tsx            ─ Nav item export.
  bakin-plugin.json     ─ Manifest + settings schema.
  components/
    memory-shell.tsx    ─ Layout frame for /memory (tier tabs fill in per-commit).
  lib/
    types.ts            ─ MemoryTier, MemoryRow, per-tier meta schemas (Zod).
    indexer.ts          ─ MemoryIndexer: backfill, indexTier, handleWatcherEvent.
                          Currently a skeleton; per-tier logic lands in C3–C8.
    offsets.ts          ─ Incremental JSONL byte-offset tracking (atomic rename).
    openclaw-adapter.ts ─ Sole module that reads ~/.openclaw/ for the memory plugin.
    openclaw-gateway.ts ─ Native WebSocket RPC client — gatewayCall + gatewaySubscribe.
    openclaw-cli.ts     ─ `openclaw memory status/search --json` wrapper. Nothing else.
    tier-parsers/
      audit-parser.ts     ─ Pure line → MemoryRow parser for ~/.bakin/audit.jsonl.
      durable-parser.ts   ─ H1/H2 chunker for canonical bootstrap files;
                            one MemoryRow per heading chunk.
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
                            `tokensAfter` always null (real OpenClaw files never
                            carry it). Also exports `matchCheckpointFilename`.
      dream-parser.ts     ─ Five artifact types from DreamArtifactTypeSchema
                            (phase_doc, short_term_recall, phase_signals,
                            events_log, session_corpus). `parsePhaseDoc` requires
                            YYYY-MM-DD filename; `parseDreamSignal` classifies via
                            `classifyDreamSignal(relPath)`. Dormant (empty) bodies
                            still emit rows so the UI can show friendly copy
                            instead of a mysterious absence. 2 KB snippet cap.
    routes/
      audit.ts        ─ GET /audit — tier='audit' facet query + agent/event filters.
      durable.ts      ─ GET /durable?agent=<id> (list), GET /durable/:agent/:basename (render).
      daily-notes.ts  ─ GET /daily-notes?agent=<id> (sorted by date desc),
                        GET /daily-notes/:agent/:filename (render),
                        POST /daily-notes/compare-search (Antfly vs LanceDB side-by-side).
      sessions.ts     ─ GET /sessions?agent=<id>[&kind] (gateway-first, FS fallback),
                        GET /sessions/:agent/:sessionKey (detail, live re-fetch),
                        GET /sessions/:agent/:sessionKey/turns (Antfly query, tier=turn),
                        GET /turns?agent=<id>&sessionId=<id> (by id form).
      checkpoints.ts  ─ GET /checkpoints?agent=<id>[&sessionId=<id>] (Antfly, tier=checkpoint),
                        GET /checkpoints/:agent/:sessionId/:checkpointId (detail via
                        meta scan — routes never re-parse files).
      dreams.ts       ─ GET /dreams?agent=<id>[&phase=&date=&artifactType=] (Antfly,
                        tier=dream, post-filters by phase/date/artifactType),
                        GET /dreams/:agent/:artifactType[?phase=&date=] (detail via
                        meta scan — phase_doc needs phase+date, session_corpus
                        needs date, others identified by artifactType alone).
```

## Invariants

- **Bakin reads, never writes.** No mutations to any `~/.openclaw/` path.
- **One content type, one table.** `bakin_memory`. The contract test (`getTableForPlugin`) enforces this.
- **The adapter is the only ~/.openclaw reader.** All other modules (indexer, parsers, routes) must go through `plugins/memory/lib/openclaw-adapter.ts`.
- **Path resolution goes through `getOpenClawPath()` always.** No hardcoded `~/.openclaw/` strings.
- **Offsets are atomic.** `writeFileSync(tmp)` → `renameSync(tmp, file)` — never truncate-in-place.
- **Tests mock everything.** `getContentDir`, logger, watcher, `openclaw-home`, `main-agent`, `vault`, `settings`, `child_process`, global `WebSocket`.

## Settings

Lives at `~/.bakin/plugin-settings/memory.json`. Fields:

| key | default | meaning |
|---|---|---|
| `backfillDays` | `30` | On first activation, index this many days of history across all tiers. |
| `skipSessionOverBytes` | `10485760` | Transcripts larger than this are skipped. |
| `skipResetBackups` | `true` | Skip `*.reset.*.jsonl` historical backups. |
| `lanceDbComparisonEnabled` | `true` | Show OpenClaw daily-note vector recall alongside Antfly results. |

## Commit history (this rebuild)

- C1 — `feat(memory): foundational modules (types, adapter, gateway, cli, offsets)`
- C2 — `refactor(memory): rewrite plugin shell, drop bakin_audit, register bakin_memory`
- C3 — `feat(memory): audit tier indexed into bakin_memory` ✅
  - Pure watcher pattern: `appendAudit` writes disk + broadcasts SSE, memory plugin's indexer picks up audit.jsonl changes and indexes them incrementally using persisted byte offsets. No cross-module hook between core audit and the memory plugin.
  - Legacy `bakin_audit` table, `TABLES.audit`, and `indexAuditEvent` removed from `src/core/antfly.ts` with no shim.
  - Stable row IDs: `audit:<16-char-sha256-of-ts|event|agent>` — re-indexing produces no duplicates.
  - Truncation handled: `stats.size < persistedOffset` → restart from offset 0.
  - Trailing incomplete lines (no newline yet) are preserved until the next watcher event.
- C4 — `feat(memory): durable tier indexed by heading chunk` ✅
  - Canonical bootstrap files (`SOUL.md`, `MEMORY.md`, `IDENTITY.md`, `USER.md`, `AGENTS.md`, `TOOLS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `DREAMS.md`, `MEMORY-LOG.md`) chunked on H1/H2 boundaries — one row per chunk. H3+ headings stay inside the enclosing H2 body. Files with no headings → single chunk (`headingLevel=0`, `chunkIndex=0`).
  - Stable row ids: `durable:<16-char-sha256(agent|basename|chunkIndex)>` — chunk count is tracked per file so shrinking a file (e.g. deleting an H1) removes the now-orphan chunk keys on reindex.
  - Adapter exposes `durableFilePath`, `durableFileMtime`, and `matchDurablePath(path)` so the watcher can map a fs path back to an `(agent, basename)` pair without re-listing agents everywhere.
  - Routes: `GET /api/plugins/memory/durable?agent=<id>` lists canonical files present for that agent; `GET /api/plugins/memory/durable/:agent/:basename` returns `{ agent, file, content }`. Both delegate to the adapter — no direct `~/.openclaw/` reads in route code.
- C5 — `feat(memory): daily-notes tier with LanceDB/Antfly comparison toggle` ✅
  - One row per `workspace/memory/YYYY-MM-DD*.md` file — no chunking. OpenClaw's own LanceDB index already treats daily notes as whole documents, and they tend to be short-form; splitting them would just fragment recall.
  - Stable row ids: `daily_note:<16-char-sha256(agent|filename)>`. Filename validation via `/^(\d{4}-\d{2}-\d{2})([-.].*)?\.md$/` — `random.md` or `notes.md` return null from the parser and are skipped.
  - Adapter extended with `dailyNotePath`, `dailyNoteMtime`, `dailyNoteSize`, and `matchDailyNotePath(path)`. The matcher handles both `workspaces/<agent>/memory/` and the main-agent collapsed `workspace/memory/` layout, and excludes subdirectories like `memory/.dreams/` and `memory/dreaming/`.
  - `POST /daily-notes/compare-search` is the whole point of this tier: it runs the same query against both substrates in parallel and returns `{ antfly, lancedb, lancedbStatus, lancedbError? }` so the UI (lands in C9) can show a diff. `lancedbStatus` is `'ok' | 'no_index_or_no_match' | 'error'` — the UI treats the last two as non-fatal since OpenClaw's index may not be populated.
  - LanceDB side shells out via `openclaw memory search --json` through `openclaw-cli.ts`; Antfly side reuses the plugin's unified `bakin_memory` query with `{ tier: 'daily_note' }` filter.
- C6 — `feat(memory): session + turn tiers with WS-driven live updates` ✅
  - **Session tier.** Data source is primary/fallback: try `gatewayCall('sessions.list', { agentId })` on the native WS client; on any error, fall back to `agents/<id>/sessions/sessions.json` via the adapter. Accepts both `{ sessions: {…} }` and bare `{ 'agent:…': {…} }` shapes — OpenClaw's gateway and FS disagree on the wrapper, so the extractor tolerates both without any adapter-specific branching.
  - Row ids: `session:<16-char-sha256(agent|sessionKey)>`. Orphan removal runs on every re-index — the indexer tracks `lastSessionKeys: Map<agent, Set<sessionKey>>` and `ctx.search.remove()`s any key that disappeared between runs. Session keys are never rewritten, so this is safe.
  - 30-day backfill window enforced via `opts.backfillDays` — sessions with `updatedAt < now - backfillDays*86_400_000` are skipped. Sessions with missing `updatedAt` pass through (we've got nothing to compare against).
  - Parser defaults fill the gaps between gateway-rich data and FS-sparse data: `status: 'unknown'`, `endedAt: updatedAt`, `origin: null` when unavailable. The row is still useful for row-count and token-rollup surfaces without them.
  - **Turn tier.** One row per useful JSONL event. Skipped types: `session` header (surfaced via the session tier instead), `model_change`, `thinking_level_change`, any `custom` / `custom_message`, and unknown types. The real OpenClaw JSONL doesn't emit `tool_call` as a discrete event type — it's an assistant `message` with one or more `toolCall` content blocks, so the parser classifies by inspecting the content blocks: any `toolCall` present → `tool_call` row; otherwise `message`. `toolResult` rows surface `toolName` and `toolCallId` from the envelope.
  - Row ids: `turn:<16-char-sha256(agent|sessionId|eventId)>`. Content is byte-sliced at 32 KB with `truncated: true` and `rawByteOffset` set to the line's byte offset in the source file — the UI can always jump back to the original line regardless of truncation.
  - **Oversize handling.** Files whose reported size exceeds `skipSessionOverBytes` (default 10 MB) go through a head-only chunker: the first 4 MB are read, parsed, and capped at 2000 rows; no offset is persisted so a later resize doesn't skip the (still-unseen) middle. Full tail-chunking is a follow-up. The reported size comes from `listSessionJsonlFiles(agent).size` (gateway or `statSync`); actual byte reads use `statSync(path).size` so the mocked-size test still exercises the head-path while reading the real tempfile's bytes.
  - **Incremental offsets.** Normal-sized files use the same `openSync + readSync(offset, length)` pattern as the audit tier. Persisted offsets live in `~/.bakin/plugin-settings/memory/offsets.json`; a second call on an unchanged file reads zero bytes and emits zero rows. If the file shrinks (e.g., OpenClaw swapped it out), offset resets to 0 and the next call re-indexes from the start.
  - **Watcher routing.** Chokidar `file.change` on `agents/*/sessions/sessions.json` → `matchSessionStorePath` → re-index that agent's sessions. `file.change` on `agents/*/sessions/<id>.jsonl` → `matchSessionJsonlPath` → turn re-index for that session, skipping `*.reset.*.jsonl` backups. `unlink` on a session JSONL resets the offset so a later recreate starts fresh; `unlink` on `sessions.json` is a no-op (the next gateway call will reflect reality).
  - **WS live updates.** `gatewaySubscribe('sessions.subscribe', {})` runs best-effort at activation — each frame kicks off a session re-index. If the WS dial fails, chokidar on `sessions.json` is the safety net (see the three-consistency-paths architecture in `search-system.md`), so a dead gateway just means slightly higher latency, not broken correctness.
  - **Routes.** `GET /sessions[?agent=&kind=]` (gateway-first list, sorted by `updatedAt` desc), `GET /sessions/:agent/:sessionKey` (detail, re-fetches at request time so a freshly-connected UI doesn't lag the roster), `GET /sessions/:agent/:sessionKey/turns` (Antfly query with `tier=turn, agent=…` filters plus the sessionKey as the q-string — `meta` is indexed as text so the query narrows to the session without a dedicated facet), `GET /turns?agent=&sessionId=` (convenience form for callers that only know the session id). `limit` is clamped to `[1, 500]` with default 100.
- C7 — `feat(memory): checkpoint tier` ✅
  - **Source.** One `<sessionId>.checkpoint.<checkpointId>.jsonl` sibling of a session transcript → one row. The file replays the session header + messages up to the compaction point and ends with one `type=compaction` event. The parser scans lines for the first compaction, ignores the replayed transcript (those rows belong to the turn tier), and treats additional compactions in the same file (rare) as duplicates the first one wins.
  - **Field surfacing.** `summary` becomes `content` / `snippet` (2 KB cap). `tokensBefore` carried through unchanged; `tokensAfter` always `null` — real OpenClaw files never emit it. `trigger` derives from `fromHook`: `true → 'auto'`, `false → 'manual'`, absent → `'unknown'`. `createdAt` is ISO-parsed from the compaction's `timestamp`, falling back to file mtime if missing or unparseable.
  - Row ids: `checkpoint:<16-char-sha256(agent|sessionId|checkpointId)>`. Stable across re-indexing; unlink removes the row.
  - **Adapter additions.** `listCheckpointJsonlFiles(agent)` returns `{agent, sessionId, checkpointId, filename, path, size, mtimeMs}[]`; `checkpointJsonlPath`, `checkpointJsonlStat`, and `matchCheckpointJsonlPath(path)` round out the watcher surface. The existing `listSessionJsonlFiles` already excludes `*.checkpoint.*.jsonl` so session + checkpoint backfills don't double-index the same files.
  - **Watcher routing.** `file.add` and `file.change` on `agents/*/sessions/*.checkpoint.*.jsonl` route through `matchCheckpointJsonlPath` → `indexCheckpointFile`. `unlink` removes the derived row id directly (no per-file state to forget beyond Antfly's own row). The top-level watch glob (`agents/*/sessions/*.jsonl`) already covers checkpoint files — no new path added.
  - **Routes.** `GET /checkpoints?agent=<id>[&sessionId=<id>&limit=&offset=]` runs an Antfly query with `{tier: 'checkpoint', agent}` filters and the optional `sessionId` as the q-string (meta is indexed as text, so the query narrows without needing a dedicated facet). `GET /checkpoints/:agent/:sessionId/:checkpointId` does the same query with `q=sessionId checkpointId`, then filters the first 20 results by JSON-parsing each row's `meta` field and matching both ids exactly — malformed meta is tolerated and treated as a non-match. Routes never touch the filesystem; the indexer is the single source of truth.
- C8 — `feat(memory): dream tier` ✅
  - **Source.** Five artifact types (`DreamArtifactTypeSchema`): `phase_doc` (one per `workspace/memory/dreaming/<phase>/<YYYY-MM-DD>.md`), `short_term_recall` (`.dreams/short-term-recall.json`), `phase_signals` (`.dreams/phase-signals.json`), `events_log` (`.dreams/events.jsonl`), `session_corpus` (`.dreams/session-corpus/<YYYY-MM-DD>.{md,txt}`). One `MemoryRow` per file — no chunking.
  - **Dormant state is real.** On a fresh OpenClaw install `short-term-recall.json` and `events.jsonl` exist but are empty. The parser still emits rows with empty content so the UI can show "dormant" copy rather than a mysterious absence. Phase docs whose filename lacks a YYYY-MM-DD prefix are rejected (not dormant — they're just bad names).
  - Row ids: `dream:<16-char-sha256(agent|artifactType|key)>` where `key` is `<phase>|<date>` for `phase_doc`, the date for `session_corpus`, and the `artifactType` itself for the three no-key signals. Unlink derives the same id and removes it.
  - **Adapter additions.** `listPhaseDocs(agent)` walks `workspace/memory/dreaming/<phase>/*.md`; `listDreamSignalFiles(agent)` enumerates `.dreams/` flat files plus a single-level `session-corpus/` subdir (no deeper recursion). `readPhaseDoc(agent, phase, filename)` and `readDreamSignal(agent, relPath)` both block path traversal. `matchPhaseDocPath(path)` and `matchDreamSignalPath(path)` round-trip filesystem paths back to `(agent, phase, filename)` or `(agent, relPath)` for watcher routing, handling both the collapsed main-agent workspace and per-agent `workspaces/<id>/` layouts.
  - **Watcher routing.** `file.add` / `file.change` on a phase doc path → `indexPhaseDoc`; on a signal file path → `indexDreamSignal`. `unlink` derives the row id from the filename (for phase docs, the `YYYY-MM-DD` prefix) or from `classifyDreamSignal(relPath)` and removes it. The existing watch glob (`workspace/memory/**/*`, `workspaces/*/memory/**/*`) already covers both path shapes.
  - **Routes.** `GET /dreams?agent=<id>[&phase=&date=&artifactType=]` runs an Antfly query with `{tier: 'dream', agent}` filters, passes the phase/date/artifactType terms as the q-string for BM25 scoring, then post-filters the results by JSON-parsing each row's `meta`. `GET /dreams/:agent/:artifactType[?phase=&date=]` does the same query narrowed by the artifactType term and finds the first row whose meta matches all provided fields. Malformed meta is tolerated as a non-match. Routes never touch the filesystem; the indexer is the single source of truth.
- C9 — `feat(memory): global search + facets UX` (pending)
- C10 — `feat(memory): MCP exec tools` (pending)
- C11 — `docs(memory): final knowledge pass + CLAUDE/README` (pending)

See `.claude/specs/memory-plugin-rebuild-PLAN.md` for the full plan.
