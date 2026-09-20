# SDK surface cleanup (#804) checklist

Spec: [approved scope](../.claude/specs/sdk-surface-cleanup/SPEC.md).
Plan: [implementation and rollback](plan.md).

- [x] Audit original ticket against Storybook and first-party consumers.
- [x] User approves preserving AgentDot, AgentStatus, and ColorPicker.
- [x] User approves #805 remaining a separate PR.
- [x] User approves written specification.
- [x] Draft implementation plan and checkpoint strategy.
- [x] User approves implementation plan ("do it").
- [x] T0: branch, baseline, consumer recheck; commit C0 (`32b7d866d`).
- [x] T1: runtime helper removal guards fail for the expected reason.
- [x] T2: facade removal; live behavior remains green.
- [x] T3: package JS/declarations and docs agree.
- [x] Checkpoint A passes; commit C1 (this checkpoint).
- [ ] T4: pattern removal guards and preservation checks.
- [ ] T5: facade and exact public API/coverage contraction.
- [ ] T6: package contract, public guidance, story evidence.
- [ ] Checkpoint B passes; commit C2.
- [ ] T7: hook removal guards and implementation deletion.
- [ ] T8: comments/guidance and package declaration checks.
- [ ] T9: documentation reconciliation and Bits follow-up record.
- [ ] Checkpoint C passes; commit C3.
- [ ] T10: full conformance and scoped code review.
- [ ] Record evidence and handoff; commit C4 if evidence changes.

## Execution evidence

Baseline: main `e630fbb5d05d63fb849f9e4d004d5ea033e91b70`, Bun 1.3.13.
Branch: `refactor/sdk-surface-cleanup-804`. Product consumer recheck found no
imports requiring migration. Package-build baseline: 6 pass, 0 fail.

Default quick conformance failed before implementation because the sibling Bits
checkout is newer than the compatibility pin. Use the existing
`BAKIN_DOCS_EXTERNAL_SOURCES=/private/tmp/bakin-804-bits.IDXEin/plugins` override,
an isolated archive of the exact pinned Bits revision, for census/docs/performance
checks. The sibling checkout and compatibility ledger remain unchanged.

Pinned baseline quick conformance passed (228 architecture tests and typecheck).
Phase A: red run 45 pass / 4 intended public-export failures. Final focused
tests and package tests pass; package build: 6 pass / 149 assertions. Quick
conformance and docs validation pass; lint has zero errors (five existing
warnings). The broad test run reported only the new package peer-resolution
failure, subsequently fixed and verified in the package rerun. Peers must be
linked before the first package import because Bun caches module resolution.
Final full-suite verification follows all three slices.

Generated SDK reference refreshed with the canonical renderer; unrelated outputs
from the broad docs generator were restored to their pre-task contents. Subsequent
slice refreshes use the existing SDK renderer and stable writer directly.

## Separate follow-ups

- #805: metadata entrypoint retirement, separate PR.
- #806: full list/table usage audit before deciding/documenting the ruling.
- Official Bits: remove retired public names from ambient declarations and test
  doubles; preserve its private overflow helper. No product consumer was found.
  This is recorded follow-up scope, not authorization to edit that repository.
