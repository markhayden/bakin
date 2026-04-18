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
| `daily_note` | `workspace/memory/*.md` | pending (C5) |
| `dream` | `workspace/memory/dreaming/**/*.md`, `workspace/memory/.dreams/**/*` | pending (C8) |
| `durable` | `workspace/*.md` (MEMORY.md, SOUL.md, etc. — canonical bootstrap files) | pending (C4) |
| `audit` | `~/.bakin/audit.jsonl` | pending (C3) |

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
- C3 — `feat(memory): audit tier indexed into bakin_memory` (pending)
- C4 — `feat(memory): durable tier` (pending)
- C5 — `feat(memory): daily-notes tier` (pending)
- C6 — `feat(memory): session + turn tiers` (pending)
- C7 — `feat(memory): checkpoint tier` (pending)
- C8 — `feat(memory): dream tier` (pending)
- C9 — `feat(memory): global search + facets UX` (pending)
- C10 — `feat(memory): MCP exec tools` (pending)
- C11 — `docs(memory): final knowledge pass + CLAUDE/README` (pending)

See `.claude/specs/memory-plugin-rebuild-PLAN.md` for the full plan.
