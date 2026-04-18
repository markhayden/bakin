# Memory plugin

_Living doc — grows commit by commit during the memory plugin rebuild. Final polish lands in C11._

## What it is

A read-only observability dashboard over every OpenClaw memory tier plus Bakin's own audit log. All 7 tiers land in a single Antfly table (`bakin_memory`) with a `tier` facet discriminator so the whole memory system is semantically and globally searchable through one registration.

## Tiers

| tier | source | status |
|---|---|---|
| `session` | OpenClaw gateway `sessions.list` + `agents/*/sessions/sessions.json` fallback | pending (C6) |
| `turn` | `agents/*/sessions/<sessionId>.jsonl` | pending (C6) |
| `checkpoint` | `agents/*/sessions/*.checkpoint.*.jsonl` | pending (C7) |
| `daily_note` | `workspace/memory/*.md` | ✅ C5 |
| `dream` | `workspace/memory/dreaming/**/*.md`, `workspace/memory/.dreams/**/*` | pending (C8) |
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
    routes/
      audit.ts        ─ GET /audit — tier='audit' facet query + agent/event filters.
      durable.ts      ─ GET /durable?agent=<id> (list), GET /durable/:agent/:basename (render).
      daily-notes.ts  ─ GET /daily-notes?agent=<id> (sorted by date desc),
                        GET /daily-notes/:agent/:filename (render),
                        POST /daily-notes/compare-search (Antfly vs LanceDB side-by-side).
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
- C6 — `feat(memory): session + turn tiers` (pending)
- C7 — `feat(memory): checkpoint tier` (pending)
- C8 — `feat(memory): dream tier` (pending)
- C9 — `feat(memory): global search + facets UX` (pending)
- C10 — `feat(memory): MCP exec tools` (pending)
- C11 — `docs(memory): final knowledge pass + CLAUDE/README` (pending)

See `.claude/specs/memory-plugin-rebuild-PLAN.md` for the full plan.
