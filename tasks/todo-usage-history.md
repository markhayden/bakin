# TODO: Health Usage History (#359)

Plan: `tasks/plan-usage-history.md` · Spec: `.claude/specs/health-usage-history.md`
Branch: `feat/usage-history`

## T0 — Branch
- [x] `git checkout -b feat/usage-history` off clean `main`

## T1 — Store (C1) `feat(core): usage-history store — usage.db schema + verbs`
- [x] `packages/core/src/usage-history/store.ts`: `openNamedDb('usage', …)`, migration v1
      (`session_usage_days` PK `(session_id, day, model)` + `session_scan_state`, indexes)
- [x] Verbs: `replaceSessionUsage` (tx: delete-by-session + insert + scan-state upsert),
      `getScanState`, `usageByAgentSince`, `usageByDaySince` — guarded, lazy migrations
- [x] Types: `SessionDayUsage`, `AgentUsageRollup`, `DayUsageRollup`
- [x] `tests/core/usage-history-store.test.ts` — rescan idempotence, shrink-replace,
      cost NULL honesty, migration reopen; BAKIN_HOME-before-imports, both content-dir mocks,
      logger mock, `closeAllDbs()` before `rmSync`
- [x] Verify: `bun test tests/core/usage-history-store.test.ts --isolate`
- [x] **Commit CP** ①

## T2 — Parser extraction (C2) `refactor(core): extract shared per-message session usage parser`
- [x] `parseSessionUsageMessages(content)` in `src/core/agent-usage.ts` (per-message tsMs/model/tokens/cost)
- [x] `parseSessionUsageContent` rebuilt on top — output byte-identical (behavior pin)
- [x] Export `getSessionJsonlTierId`
- [x] New helper tests (malformed lines, ts/model surfacing, cost null/present)
- [x] Verify: `tests/core/agent-usage.test.ts` passes UNCHANGED + new cases green
- [x] **Commit CP** ②

## T3 — Scanner (C3) `feat(core): session usage scanner — per-day recompute with stat skip`
- [x] `src/core/usage-history.ts`: `scanUsageHistory(runtime)` — tier discover → agents →
      entries (skip `.deleted`) → statEntry skip vs scan-state → parse → (localDay, model)
      buckets → cost micros → `replaceSessionUsage`; per-entry try/catch → `failed`
- [x] `toLocalDayKey(tsMs)` pure + exported
- [x] `tests/core/usage-history.test.ts` (fake adapter): multi-agent/session aggregation,
      midnight span, model switch, stat-skip proof (no getEntry), deleted-entry persistence,
      rewrite/truncate recompute, missing tier no-op
- [x] Verify: file green + full `bun run test` green — **CP-A (core complete)**
- [x] **Commit CP** ③

## T4 — Route + timer + settings (C4) `feat(health): usage-history route, scan timer, settings`
- [x] `GET /usage-history` defineRoute — zod window enum (default 24h) →
      `{ window, since, scannedAt, byAgent, byDay }`
- [x] `activate`: interval from `usageHistoryScanMinutes` setting (default 5, floor 1),
      no immediate scan; `onShutdown` clears (hot-reload safe)
- [x] Settings field + `plugins/health/types.ts` wire type
- [x] `bakin-plugin.json` 1.0.0 → 1.1.0
- [x] Route tests via `callRoute`: 3 windows, bad window 400, empty store honest shape;
      arm/disarm helper unit test
- [x] Verify: `bun test tests/plugins/health/ --isolate` + `bun run build`
- [x] **Commit CP** ④

## T5 — UI (C5) `feat(health): usage history UI — window selector, table, daily chart; rename latest-session card`
- [x] Read dataviz skill BEFORE chart code
- [x] `components/usage-history-section.tsx`: `useQueryState('uw','24h')` selector,
      per-agent table (5 token cols + cost w/ partial indicator + em-dash), daily bar chart,
      honest empty state
- [x] Mount in `health-page.tsx`; rename card → "Latest Session Context" + scope subtitle
- [x] Verify: `bun run test` (preload!), `bun run build`, dev-server manual check — **CP-B**
- [x] **Commit CP** ⑤

## T6 — Docs (C6) `docs(knowledge): usage-recording — durable usage history pipeline`
- [x] `.claude/knowledge/usage-recording.md`: retire "follow-up work" note, document pipeline
- [x] `CLAUDE.md`: add `usage.db` to Runtime Data Directory map
- [x] `git mv` spec content → `.claude/specs/health-usage-history.md`; delete root `SPEC.md`
- [x] Sweep: doctor-and-health-checks.md (n/a expected), repo-architecture.md, README (n/a verified)
- [x] **Commit CP** ⑥

## Final gate
- [ ] Full `bun run test` + `bun run build` green (don't commit generated-version.ts)
- [ ] `/verify` end-to-end: scan fires → usage.db rows → route returns → UI renders
- [ ] No stray dev instance on :3737
- [ ] PR → #359 with SPEC §10 acceptance mapping
