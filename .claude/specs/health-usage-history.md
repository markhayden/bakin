# SPEC — Health Usage History Beyond Latest Session (#359)

Status: SHIPPED (feat/usage-history)
Issue: https://github.com/markhayden/bakin/issues/359
Predecessor: #358 (cost-accuracy audit, closed) — established that Health's token card is
JSONL-derived and honest-cost-only; this spec builds durable history on the same source.

## 1. Objective

Give the Health dashboard reliable **historical** agent token usage (24h / 7d / 30d) alongside
the existing latest-session view, without conflating the two. Tokens are the primary metric;
runtime-reported cost is preserved when available and never fabricated. History survives
session deletion, rotation, and transcript rewrites, and can never double-count.

Target user: the single operator of this machine. No backwards-compat constraints.

## 2. Current state (verified)

- **Latest-session card** (`SpendTokenSection` in `plugins/health/components/health-sections.tsx`):
  `GET /api/plugins/health/usage` → `getAllAgentUsage()` in `src/core/agent-usage.ts` scans the
  *newest* session JSONL per agent via the adapter-neutral `runtime.memory` capability
  (`listTiers`/`listEntries`/`getEntry`/`statEntry`). Tokens summed per assistant message; cost
  only when runtime-reported. No history.
- **Metered spend card**: models plugin `/spend` → ledger `run_costs` (durable, Bakin-initiated
  turns only). Untouched by this work.
- `.claude/knowledge/usage-recording.md` explicitly marks multi-session aggregation as unbuilt
  follow-up work — that note is retired by this spec.

## 3. Decisions (interview-resolved)

| # | Decision | Choice |
|---|----------|--------|
| 1 | History source | **Ingest session JSONL** (superset source: includes OpenClaw-native activity Bakin never dispatched; same source as the latest-session card) |
| 2 | Store shape | **Per-session absolute upserts** — full-file recompute, replace-not-accumulate ⇒ double-counting structurally impossible |
| 3 | Day attribution | **(session, day) rows** — messages bucketed by their own timestamps, so long-lived main sessions don't dump weeks of tokens on one day |
| 4 | Scan trigger | **Background interval** in the health plugin (default 5 min, settings-configurable); statEntry mtime/size skip for unchanged files |
| 5 | Retention | **Keep forever, no tombstones** — ingested rows are permanent history; source deletion just stops updates |
| 6 | UI | **Window selector (URL-backed, default 24h) + per-agent table + daily-totals bar chart**; existing card renamed to "Latest Session Context" |
| 7 | Cost | **Show with coverage honesty** — runtime-reported sums + costed/total message counts; "partial" indicator under 100 % coverage; em-dash at zero; Bakin never prices |

### Refinements within approved decisions (flagged for review)

- **Key includes model:** `(session_id, day, model)` instead of `(session_id, day)`. Real
  transcripts switch models mid-session (verified); the extra key column preserves fidelity at
  negligible cost and matches `run_costs`. UI aggregates over it; no per-model UI ships now.
- **Replace semantics:** rescan = `DELETE FROM rows WHERE session_id = ?` + insert fresh set,
  in one transaction. Handles shrunk/rewritten/compacted files with zero bookkeeping.
- **Units:** cost stored as `cost_usd_micros INTEGER` (rounded at ingest) — matches the ledger
  convention; no float accumulation.
- **Timezone:** day keys (`YYYY-MM-DD`) in the machine's local timezone. Single-user machine;
  local days are what the operator means by "today."

## 4. Data model

New named SQLite DB `~/.bakin/usage.db` via `openNamedDb` in
`packages/core/src/storage/db.ts` (the sole `bun:sqlite` importer — architecture-enforced;
follow the search-outbox precedent). **Not** the coordination ledger — that DB is coordination
facts only.

```sql
-- migration v1
CREATE TABLE session_usage_days (
  session_id        TEXT NOT NULL,
  day               TEXT NOT NULL,            -- YYYY-MM-DD, local tz
  model             TEXT NOT NULL DEFAULT '', -- '' = message had no model field
  agent             TEXT NOT NULL,
  input_tokens      INTEGER NOT NULL DEFAULT 0,
  output_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  cost_usd_micros   INTEGER,                  -- NULL = no runtime-reported cost that day
  costed_messages   INTEGER NOT NULL DEFAULT 0,
  message_count     INTEGER NOT NULL DEFAULT 0,
  first_ts          INTEGER NOT NULL,         -- epoch ms of first/last message in bucket
  last_ts           INTEGER NOT NULL,
  PRIMARY KEY (session_id, day, model)
);
CREATE INDEX session_usage_days_by_day   ON session_usage_days(day);
CREATE INDEX session_usage_days_by_agent ON session_usage_days(agent, day);

CREATE TABLE session_scan_state (
  session_id  TEXT PRIMARY KEY,               -- memory-entry id
  agent       TEXT NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  size        INTEGER NOT NULL,
  scanned_at  INTEGER NOT NULL
);
```

Dedup identity = the primary key + absolute replace-on-rescan. Retries/aborted runs need no
special handling: whatever the runtime wrote to the transcript is what happened; recompute is
idempotent by construction.

## 5. Components

1. **Store** — `packages/core/src/usage-history/store.ts`: schema/migrations + verbs:
   `replaceSessionUsage(sessionId, agent, rows[])` (transactional delete+insert + scan-state
   upsert), `getScanState(sessionId)`, `usageByAgentSince(sinceMs)`, `usageByDaySince(sinceMs)`.
   Guarded like the ledger (never throws into callers; logs).
2. **Scanner** — `src/core/usage-history.ts`: `scanUsageHistory(runtime)` — discover the
   `session_jsonl` tier, list entries per agent, `statEntry` skip (mtime+size unchanged),
   `getEntry` + parse changed files into per-(day, model) buckets, call `replaceSessionUsage`.
   Per-message parsing extracted from `parseSessionUsageContent` in `src/core/agent-usage.ts`
   into a shared helper (`parseSessionUsageMessages`) so the latest-session card and history
   ingest one parser — they must never drift.
3. **Health plugin server** — `plugins/health/index.ts`: arm interval timer on `activate`
   (cleared on shutdown), first scan deferred one interval (no boot work);
   `GET /usage-history?window=24h|7d|30d` → `{ window, since, scannedAt, byAgent[], byDay[] }`.
   Settings schema: `usageHistoryScanMinutes` (number, default 5, min 1).
4. **Health plugin UI** — new `UsageHistorySection` in `plugins/health/components/`:
   `useQueryState('uw', '24h')` window selector; per-agent table (In / Out / Cache R / Cache W /
   Total / Est. cost with coverage indicator); daily-totals bar chart (dataviz-skill styling).
   Rename existing card title "Estimated Token Usage" → **"Latest Session Context"** with a
   subtitle making the scope explicit. Types local to `plugins/health/types.ts`.
   Bump `plugins/health/bakin-plugin.json` version (minor; shipped as 1.2.0 → 1.3.0).

## 6. Boundaries

**Always:** read runtime data only through `runtime.memory.*`; store absolute recomputes, never
accumulate; show runtime-reported cost only; mock both content-dir resolvers + OpenClaw home in
every test; local-tz day keys.

**Never:** write/watch runtime session files directly; import `bun:sqlite` outside
`storage/db.ts`; add a parallel in-memory stat tracker (the usage recorder is untouched); price
tokens in Bakin; touch the coordination ledger schema; auto-scan at server boot (timer only).

**Ask first:** any new runtime capability; any change to the metered-spend (`run_costs`) path.

## 7. Testing strategy

Bun tests, mandated isolation mocks (both content-dir paths, OpenClaw home, logger, watcher).
Store tests use a temp `usage.db`; scanner tests use a fake runtime adapter
(`packages/core/src/adapters/runtime/testing.ts`).

- **Parser:** day bucketing across midnight; model switch mid-session; messages without model;
  malformed lines skipped; cost coverage counts (all / some / none costed).
- **Store:** replace-on-rescan yields identical totals after N rescans (no double count);
  shrunk/rewritten file replaces rows; migration idempotence.
- **Scanner:** multi-session multi-agent aggregation; stat-skip on unchanged mtime+size;
  deleted session leaves rows intact; `.deleted` entries skipped; tier missing → no-op.
- **Route:** window math (24h/7d/30d), empty-store response shape, cost null vs partial.
- **UI:** section renders honest empty state; window param round-trips.

## 8. Documentation impact

- `.claude/knowledge/usage-recording.md` — replace the "historical aggregation is follow-up
  work" note with the new pipeline (usage.db, scanner, honest-cost rules).
- `.claude/knowledge/doctor-and-health-checks.md` — only if a health-check surface is added
  (none planned).
- README — verified no mention of usage cards; unaffected.
- SPEC.md is working material — replaced the stale June audit spec (recoverable from git).

## 9. Commit strategy (rollback checkpoints)

Each commit compiles and is test-green; revert any suffix cleanly.

1. `feat(core): usage-history store — usage.db schema + verbs` (+ store tests)
2. `refactor(core): extract shared per-message session usage parser` (agent-usage.ts refactor,
   latest-session behavior pinned by existing tests)
3. `feat(core): session usage scanner — per-day recompute with stat skip` (+ scanner tests)
4. `feat(health): usage-history route, scan timer, settings` (+ route tests, plugin version bump)
5. `feat(health): usage history UI — window selector, table, daily chart; rename latest-session card`
6. `docs(knowledge): usage-recording — durable usage history pipeline`

## 10. Acceptance criteria (from #359, mapped)

- [x] Latest-session vs historical distinction documented (§2/§8) and un-conflated in UI (§5.4)
- [x] Durable aggregation strategy + duplicate-counting rules defined (§4)
- [x] Tests for multi-session aggregation, rewrites, missing cost, deleted/rotated sessions (§7)
- [x] Health UI labels disambiguated (§5.4)
- [x] Cost shown only when runtime-reported, with coverage honesty (§3.7)
