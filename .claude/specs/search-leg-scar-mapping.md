# Spec: Scarred-but-Converged Leg Mapping (#845)

W2 of the antfly/search follow-up arc. Priority: reduce tech debt; no
backwards compatibility.

## Objective

A search-index leg whose enrichment recorded a fatal error long ago but is
now fully converged (pending 0, worker healthy, not retrying) must stop
reading as a permanently unhealthy table. The incident: `bakin_assets` sat
"unhealthy" for weeks off `enrichment_runtime.fatal_error_count = 1` from one
bad media doc, with a blue/green rebuild as the only path to green. 0.2.2
sharpened the need: `backfill_state: "degraded"` is now a NORMAL state for
partial-coverage media legs (fresh rebuilds wear it), so cumulative-counter
strictness is wrong-by-design.

## Design (decided in kickoff interview)

- **Predicate** in `mapIndexStatuses` (`packages/adapter-antfly/src/translate.ts`):
  - live failure (→ `state: 'error'`, unchanged): `worker_failed` (leg or
    runtime), `backfill_state === 'failed'`, or fatal count > 0 WITH live
    distress (`pending_sequence_count > 0` that isn't draining is unknowable
    statelessly — use `retrying === true` or `stalled === true` as the live
    signals; plain pending>0 alone is normal queue depth).
  - **scar** (→ `state: 'ready'` + annotation): fatal count > 0 AND none of
    the live signals. `degraded` without fatal stays plain ready (0.2.2
    partial coverage), as today.
- **Contract**: `TableLegHealth` gains OPTIONAL `scar?: { fatalCount: number;
  note: string }` (annotation, NOT a fourth state — Mark's decision). No
  state consumers change; blue/green convergence unaffected.
- **Surface**: `getSearchHealth` passes the annotation through; the
  `health.search` check emits an ADVISORY-class observation per scarred
  table ("historical enrichment failure recorded; leg fully converged and
  serving") with the existing blue/green rebuild repair as the resolution
  affordance. `unhealthyTables` no longer includes scarred-only tables.
  Quiet sensitivity mode (Mark's) hides it entirely by disposition.

## Commands

- `bun test tests/adapter-antfly/engine-status.test.ts tests/plugins/health --isolate`
- `bun run typecheck` · `bun run lint`

## Project Structure

- `packages/adapter-antfly/src/translate.ts` — predicate + annotation
- `packages/core/src/adapters/search/index.ts` — `TableLegHealth.scar`
- `src/core/search-reindex.ts` — pass-through on `getSearchHealth`
- `plugins/health/lib/system-checks/search.ts` — advisory observation +
  rebuild resolution
- Tests colocated with existing ones for each file
- `.claude/knowledge/search-system.md` + `doctor-and-health-checks.md` notes

## Testing Strategy

Unit: mapIndexStatuses matrix — {fatal>0, converged} → ready+scar;
{fatal>0, retrying|stalled|worker_failed} → error; {degraded, fatal 0} →
ready no scar; {failed state} → error. Health check: scarred table → advisory
observation with rebuild resolution, NOT in unhealthyTables; live-failure
table still warning. Live verification: current box has zero scarred legs
post-rebuild — verify no behavior change on the healthy board; simulate via
unit tests only.

## Boundaries

- Always: type-based classification (never message text); Unknown-never-
  healthy doctrine untouched.
- Ask first: any change to convergence/flip logic (out of scope by design).
- Never: parse engine log text; demote a live failure to advisory.

## Commit Strategy

Branch `fix/search-scar-mapping-845`, two commits, PR closes #845:
1. `fix(search): map scarred-but-converged legs ready with a scar annotation`
   (translate + contract + reindex pass-through + tests)
2. `feat(health): scarred search legs surface as advisory with the rebuild
   affordance` (health check + tests + knowledge notes)

## Success Criteria

- The assets-incident shape (fatal 1, converged) reads: table healthy, one
  advisory observation, rebuild affordance present.
- A live failure (retrying/stalled/worker_failed/failed) still reads error.
- Full targeted suites, typecheck, lint green.

## Open Questions

None.
