# Plan: Search migration recovery

Spec: [search-migration-recovery.md](search-migration-recovery.md).
The user authorized implementing the recorded follow-up. Execute the two
related recovery slices sequentially, then independently review before PR.

## 1. Park and resume interrupted backfills

Files: table registry, app registry, and their existing two test files.

- Write failing tests for partial batch/enumerator/create failures and verify
  safe continuation with the same target and every source document present.
- Park failed staging under its existing serialization boundary; clear partial
  completion evidence. Restrict the skip-backfill optimization to completed
  phases, including interrupted older rows still marked backfilling.
- Continue other parked tables after a recorded staging failure, preserve pump
  attempt accounting, and report resumed parked outcomes accurately.
- Keep active queries, dual writes, nonce identity, and completed-backfill fast
  paths covered. Run table/registry tests and typecheck before committing.

Commit: `fix(search): resume interrupted backfills without skipping content`.
Rollback is a code revert; no storage migration or data rewrite is introduced.

## 2. Require evidence before rebuilding or replacing indexes

Depends on slice 1's recovery state. Same four code/test files.

- Reproduce stats exceptions, null status with a listed table, and failed list
  reads on repair, target creation, and dominance promotion.
- Propagate uncertainty; only successful absence evidence authorizes automatic
  regeneration. Preserve explicit force and known-empty/missing recovery.
- Assert no create/drop/backfill/registry mutation on refused repair, and keep
  the old query pointer on failed convergence evidence.
- Run focused tests/typecheck/lint, then commit the verified slice.

Commit: `fix(search): require confirmed absence before index recovery`.

## 3. Review, document, and deliver

- Update search-system knowledge and any inaccurate operating guidance.
- Run the full repository suite, typecheck, lint, and binary build. Browser
  conformance is unnecessary unless the final change touches browser contracts.
- Request independent code review under the code-review skill. Reproduce and
  fix actionable findings before pushing and opening a focused follow-up PR.
- Record evidence and leave production rollout to the existing release process.

Commit: `docs(search): document migration failure recovery`.

## Evidence

Baseline: 93 tests passed, 0 failed, 267 assertions across table and registry
suites on Bun 1.3.13. Baseline success does not prove the missing failure cases.
