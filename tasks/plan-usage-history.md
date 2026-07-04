# Plan: Health Usage History Beyond Latest Session (#359)

**Spec:** `.claude/specs/health-usage-history.md`
**Branch:** `feat/usage-history` (off `main`)
**Backbone:** the spec's §9 six-commit strategy, sliced vertically — every task is code + its
proving tests, builds green, and is an independent rollback checkpoint.

---

## Dependency graph

```
        ┌────────────────────────────────────────────────────┐
        │ reuse: openNamedDb (packages/core/src/storage/db)  │
        │   — search-outbox precedent, test-remappable path  │
        │ reuse: runtime.memory.{listTiers,listEntries,      │
        │   getEntry,statEntry} — NO new capability          │
        │ reuse: tests/plugins/test-helpers (callRoute)      │
        └──────────────┬─────────────────────────────────────┘
                       │
         T1 store (C1)   T2 parser extraction (C2)   ← independent of each other
                │                 │
                └───────┬─────────┘
                        ▼
              T3 scanner (C3)                        ← needs store verbs + shared parser
                        │  **CP-A: core pipeline complete, no consumers**
                        ▼
              T4 route + timer + settings (C4)       ← health plugin server surface
                        │
                        ▼
              T5 UI (C5)                             ← needs T4 response shape
                        │  **CP-B: feature complete end-to-end**
                        ▼
              T6 docs + spec relocation (C6)         ← describes shipped behavior
```

T1 and T2 touch disjoint files and can be built back-to-back but are committed separately.

---

## Vertical slices

### T1 — Usage-history store (C1)
`feat(core): usage-history store — usage.db schema + verbs`

**Build:**
- `packages/core/src/usage-history/store.ts`:
  - `const store = openNamedDb('usage', () => join(getContentDir(), 'usage.db'))`
  - Migration module `'usage-history'` v1: `session_usage_days` (PK `(session_id, day, model)`,
    five token columns, `cost_usd_micros INTEGER NULL`, `costed_messages`, `message_count`,
    `first_ts`, `last_ts`, indexes by day and by (agent, day)) + `session_scan_state`
    (PK `session_id`, `agent`, `mtime_ms`, `size`, `scanned_at`). Exact DDL in SPEC §4.
  - Verbs (guarded — log, never throw into callers; migrations applied lazily on first verb):
    - `replaceSessionUsage(sessionId, agent, rows: SessionDayUsage[], stat: {mtimeMs, size})` —
      one `store.withTx`: `DELETE FROM session_usage_days WHERE session_id = ?`, insert fresh
      rows, upsert scan state. Absolute replace — the dedup guarantee lives here.
    - `getScanState(sessionId) → {mtimeMs, size} | null`
    - `usageByAgentSince(sinceMs) → per-agent sums` (five token fields + cost sum with
      NULL-honesty: `SUM` over all-NULL group → null, plus `costedMessages`/`messageCount`)
    - `usageByDaySince(sinceMs) → per-day sums` (window filter on `last_ts >= sinceMs` for
      agent/day rollups; day rows carry `day` string)
  - Exported row/rollup types (`SessionDayUsage`, `AgentUsageRollup`, `DayUsageRollup`).

**Acceptance:**
- N repeated `replaceSessionUsage` calls with identical input → totals identical (no double count).
- Replace with fewer rows (shrunk/compacted file) → stale day rows for that session gone.
- Cost NULL semantics: group with zero costed messages sums to `null`, never `0`.
- Migration idempotent across reopen (`closeAllDbs()` then re-verb).

**Verify:** `bun test tests/core/usage-history-store.test.ts --isolate` green.
Test hygiene: temp `BAKIN_HOME` env set before imports, both content-dir mocks, logger mock,
`closeAllDbs()` before `rmSync` (SQLITE_IOERR_VNODE hazard), `afterAll` cleanup.

**Commit:** checkpoint; revert = drop the store, nothing consumes it.

---

### T2 — Shared per-message parser (C2)
`refactor(core): extract shared per-message session usage parser`

**Build:**
- In `src/core/agent-usage.ts`: extract the per-line JSONL walk into
  `parseSessionUsageMessages(content) → { sessionId, sessionStarted, messages: Array<{ tsMs, model, tokens: {input,output,cacheRead,cacheWrite,total}, cost: SessionUsageCost | null }> }`
  (skip malformed lines; only `type:'message'` + `role:'assistant'` + `usage`).
- Reimplement `parseSessionUsageContent` ON TOP of it — identical output as today (behavior pin).
- Export `getSessionJsonlTierId` (currently module-private) for the scanner.

**Acceptance:**
- Existing `tests/core/agent-usage.test.ts` passes UNCHANGED — that is the pin.
- New helper tests: malformed lines skipped; per-message ts/model surfaced; cost null vs present.

**Verify:** `bun test tests/core/agent-usage.test.ts --isolate` (unchanged) + new cases green.

**Commit:** pure refactor checkpoint; revert = inline the helper again.

---

### T3 — Scanner (C3)
`feat(core): session usage scanner — per-day recompute with stat skip`

**Build:**
- `src/core/usage-history.ts`: `scanUsageHistory(runtime) → { scanned, skipped, failed }`:
  1. `getSessionJsonlTierId(runtime)` — absent tier → no-op `{0,0,0}`.
  2. `runtime.agents.list()`; per agent `memory.listEntries(tierId, { agentId })`, skip `.deleted`.
  3. Per entry: `statEntry` → equal `mtimeMs`+`size` vs `getScanState` → skip.
  4. Changed: `getEntry` → `parseSessionUsageMessages` → bucket messages by
     (local `YYYY-MM-DD` from `tsMs`, model ?? '') → `SessionDayUsage[]` rows
     (cost summed to micros: `Math.round(x * 1e6)`, `costed_messages` counted) →
     `replaceSessionUsage`.
  5. Per-entry try/catch: one bad file logs + counts `failed`, never aborts the sweep.
- Local-day helper is a pure exported function (`toLocalDayKey(tsMs)`) for direct testing.

**Acceptance (fake runtime adapter from `packages/core/src/adapters/runtime/testing.ts`):**
- Multi-agent multi-session fixture aggregates correctly via store rollup verbs.
- Session spanning midnight lands in two day rows with per-day-correct sums.
- Model switch mid-session → separate (day, model) rows.
- Unchanged mtime+size → `getEntry` NOT called (skip proven), `skipped` counted.
- Entry deleted between scans → prior rows still present in rollups.
- Rescan after file rewrite/truncation → totals match new content exactly (no residue).
- No session tier → no-op, no throw.

**Verify:** `bun test tests/core/usage-history.test.ts --isolate` green; full
`bun run test` green. **CP-A** — core pipeline done end-to-end, zero UI/plugin surface.

---

### T4 — Health plugin: route, timer, settings (C4)
`feat(health): usage-history route, scan timer, settings`

**Build:**
- `plugins/health/index.ts`:
  - `defineRoute` `GET /usage-history` — zod query `window ∈ {'24h','7d','30d'}` (default `'24h'`);
    computes `since = now - windowMs`, returns
    `{ window, since, scannedAt, byAgent: AgentUsageRollup[], byDay: DayUsageRollup[] }`.
  - `activate(ctx)`: arm `setInterval(scan, minutes * 60_000)` from
    `ctx.getSettings().usageHistoryScanMinutes` (default 5, floor 1). No immediate scan
    (boot does zero work). Store the handle module-level.
  - `onShutdown`: clear the interval — required so linked-plugin hot reload can't leak timers.
  - Settings field: `{ key: 'usageHistoryScanMinutes', type: 'number', label: 'Usage history scan interval (minutes)', default: 5 }`.
- `plugins/health/types.ts`: `UsageHistoryData` wire type (mirrors rollup types).
- `plugins/health/bakin-plugin.json`: version `1.0.0` → `1.1.0` (minor — new surface).

**Acceptance:**
- Route tests via `tests/plugins/test-helpers` `callRoute`: window math for all three values,
  bad window → 400 (zod), empty store → empty arrays + honest `scannedAt: null`.
- Timer: unit-test the extracted arm/disarm helper (interval cleared on shutdown); do not
  test wall-clock waiting.

**Verify:** `bun test tests/plugins/health/ --isolate` green; `bun run build` green.

---

### T5 — Health UI (C5)
`feat(health): usage history UI — window selector, table, daily chart; rename latest-session card`

**Build:**
- Read the **dataviz skill before writing any chart code** (bar chart styling/theme rules).
- `plugins/health/components/usage-history-section.tsx` (new file — follow the per-section
  component pattern from `4df83bd5`, independent fetch):
  - `useQueryState('uw', '24h')` window selector (URL-backed, omitted at default) — 24h / 7d / 30d.
  - Per-agent table: Agent | In | Out | Cache R | Cache W | Total | Est. cost.
    Cost cell: value + "partial" indicator when `costedMessages < messageCount`
    (tooltip "runtime-reported cost on N of M messages"); em-dash when null.
  - Daily-totals bar chart over `byDay` (theme-aware, honest empty state).
- `health-page.tsx`: mount the new section; existing token card title
  "Estimated Token Usage" → **"Latest Session Context"** + scope subtitle
  (in `health-sections.tsx`).
- Types from `plugins/health/types.ts`; shared UI only from `@makinbakin/sdk/components`.

**Acceptance:**
- Window param round-trips through the URL; default omitted.
- Empty store renders an honest empty state (no zeros pretending to be data).
- Latest-session card renamed; the two sections visually distinct in scope labeling.

**Verify:** component tests green (`bun run test` — preload required per memory);
`bun run build` green; manual check via dev server (`/run` skill) — both sections render,
window switch updates table+chart. **CP-B** — feature complete.

---

### T6 — Docs (C6)
`docs(knowledge): usage-recording — durable usage history pipeline`

**Build:**
- `.claude/knowledge/usage-recording.md`: replace the "historical aggregation is separate
  follow-up work" note with the shipped pipeline — usage.db, (session, day, model) replace
  semantics, scan cadence, honest-cost rules, route.
- `CLAUDE.md`: add `usage.db` to the Runtime Data Directory map (alongside `bakin.db`).
- Move root `SPEC.md` → `.claude/specs/health-usage-history.md` (status: SHIPPED); root
  `SPEC.md` deleted (stale June audit spec superseded — recoverable from git history).
- Sweep: `.claude/knowledge/doctor-and-health-checks.md` (no change expected — no new health
  check), `repo-architecture.md` if it maps `~/.bakin` files, README (verified unaffected).

**Verify:** `grep -r "follow-up work" .claude/knowledge/usage-recording.md` empty;
knowledge doc statements match shipped code (file paths, route, defaults).

---

## Final gate (after T6, before PR)

- `bun run test` full suite green.
- `bun run build` green (do NOT commit `generated-version.ts` if build mutates it — memory).
- `/verify`: drive the real flow — dev server up, wait/trigger a scan, confirm rows in
  `usage.db`, confirm `/usage-history` returns them, confirm UI renders them.
- No background dev instances left on :3737 (memory).
- PR references #359 with the acceptance-criteria mapping from SPEC §10.

## Risks & mitigations

- **Transcript format drift** (fields observed on this machine: per-message `timestamp`,
  `model`, full `usage` + `cost`): parser treats every field as optional; missing ts falls
  back to session start date; missing model → `''` bucket. Never throws on a line.
- **Large first scan** (every historical session parsed once): per-entry try/catch + stat
  state means one pass, incremental forever after; scan runs off the request path.
- **Hot-reload timer leak**: `onShutdown` clears interval (T4 acceptance).
- **DST/local-day edges**: `toLocalDayKey` is pure + unit-tested; worst case a message near
  a DST shift lands on the adjacent day — accepted (single-user, trend-level data).
