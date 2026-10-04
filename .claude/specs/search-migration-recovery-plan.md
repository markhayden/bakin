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

Implementation checkpoints:

- `5ba478f7f`: backfill failure parking, safe source replay, per-table resume
  isolation, and honest parked job outcomes. Six initial regressions failed;
  the additional returned-item rejection test also failed before its guard.
  The resulting focused suites passed 100 tests. Typecheck and focused lint
  passed after correcting a nullable target type in a test assertion.
- `b3b243bd0`: authoritative absence checks for repair, target creation, and
  dominance promotion. Nine new evidence-failure regressions first failed;
  110 focused tests then passed. The existing convergence-outage fixture now
  injects its failure after creation, preserving what that test verifies.
- `699eed04d`: independent review identified that failed listings reached the
  dead-shard handler with an empty result, resetting its separate restart cap.
  A regression reproduced four restarts instead of three; handling only
  successful listings fixed it. The reviewer independently verified the fix
  and reported no remaining actionable findings. Final focused suites:
  111 passed, zero failed, 372 assertions.

Typecheck, focused lint, repository lint (six existing warnings, zero errors),
49-page docs validation, and `git diff --check` passed. The first full run was
blocked by sandbox localhost restrictions, confirmed with a minimal server
probe. With localhost permissions, 10,452 tests passed and one unrelated SDK
inventory test exceeded the local 15-second timeout. Final verification uses
the repository's canonical `bun run test:ci` command (existing 60-second test
timeout), rather than changing a test or timeout configuration.

Final verification passed: `bun run test:ci` completed with 10,453 passed,
19 skipped, zero failures, and 39,650 assertions across 1,090 files. `bun run
build` built macOS ARM64, Linux x64, and Linux ARM64 binaries; the macOS
binary's version command passed with isolated Bakin/engine/runtime homes.
The generated version stamp was inspected and excluded. No browser contracts
changed, and no production service was restarted or index modified.

All three plan slices are complete. Operating documentation now distinguishes
default repair from a forced source rebuild and explains incomplete recovery.
No new schema, dependencies, compatibility layer, or recovery framework was
introduced. No actionable findings remain from the independent review.
