# Implementation Plan: Scarred-Leg Mapping (#845)

Spec: `.claude/specs/search-leg-scar-mapping.md` · Branch
`fix/search-scar-mapping-845` · Two commits · Live pass = no behavior change
on the currently-healthy board.

## Grounding facts

- `TableLegHealth` (`packages/core/src/adapters/search/concepts.ts:79`) —
  add optional `scar?: { fatalCount: number; note: string }`.
- Predicate site: `mapIndexStatuses` (`translate.ts:398-425`); current
  `failed` = worker_failed (leg|runtime) || fatal>0 (leg|runtime) ||
  backfill_state==='failed'. Live signals available in the same status:
  `retrying`, `stalled` (runtime), `worker_failed`, `backfill_state`.
- `getSearchHealth` (`src/core/search-reindex.ts:81-92`) computes
  `healthy = every(leg.state !== 'error')` — untouched; annotation flows
  through legHealth.
- Health check consumer: `plugins/health/lib/system-checks/search.ts:321-345`
  (`unhealthyTables` from `!table.healthy`). Add scar collection + advisory
  observation; resolution reuses repair `actionId: 'search-spin-rebuild'`
  (`search-spin.ts:172`, plans via `repairTargetSelection(target)` — verify it
  accepts a foreign incident's `search_table` resources during build; if not,
  register a sibling id backed by the same rebuild path).
- Tests: `tests/adapter-antfly/engine-status.test.ts` (mapIndexStatuses
  matrix lives here — extend), `tests/plugins/health/system-checks.test.ts`.

## Tasks

- [ ] **T1 (S, commit 1): predicate + contract + pass-through**
  - concepts.ts scar field; translate.ts: liveFailure = worker_failed(leg|rt)
    || state==='failed' || (fatal>0 && (rt.retrying || rt.stalled)); scar =
    fatal>0 && !liveFailure → state 'ready' + scar {fatalCount, note}.
  - RED: matrix tests incl. the assets-incident shape and degraded-no-fatal.
  - Verify: engine-status suite + typecheck.
- [ ] **T2 (S, commit 2): health advisory + docs**
  - search.ts check: scarredTables (healthy but any leg.scar) → advisory
    observation + incident (class `usage_anomaly`? no — use disposition
    'advisory' directly, class 'cleanup_backlog') with rebuild resolution;
    scarred-only tables OUT of unhealthyTables (they never enter — healthy
    flag true — assert it).
  - RED: health-check test with a scarred-leg fixture.
  - Knowledge notes (search-system.md scar paragraph, doctor doc one-liner).
  - Verify: health suite; broad sweep; lint.

## Checkpoint
- Suites + typecheck + lint green per commit; PR; live pass = board stays
  green (no scarred legs exist post-0.2.2-rebuild), advisory verified by test
  fixture only.

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| spin repair rejects foreign target | Low | sibling action id, same rebuild engine |
| a real live failure hides behind scar | Med | live signals (retrying/stalled/worker_failed/failed) checked FIRST; matrix test locks ordering |
