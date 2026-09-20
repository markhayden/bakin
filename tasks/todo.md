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
- [x] T4: pattern removal guards and preservation checks.
- [x] T5: facade and exact public API/coverage contraction.
- [x] T6: package contract, public guidance, story evidence.
- [x] Checkpoint B passes; commit C2 (this checkpoint).
- [x] T7: hook removal guards and implementation deletion.
- [x] T8: comments/guidance and package declaration checks.
- [x] T9: documentation reconciliation and Bits follow-up record.
- [x] Checkpoint C passes; commit C3 (this checkpoint).
- [x] T10: full conformance and scoped code review.
- [x] Record evidence and handoff; commit C4 (final verification record).

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

C1: `0b3de8905`. Phase B: 6 pass / 2 intended export failures before removal;
159 focused/package tests pass after removal. Added behavioral proof that the
assigned option still emits `$assigned` and compact-header overflow still opens.
Quick conformance, lint (same five warnings), and docs validation pass. Six public
Storybook files / 16 Chromium interaction tests pass; report:
`test-results/ui-stories/junit.xml`. API delta is exactly two values and one type;
kit-coverage allowance tightens from 28 to 27. No story visual or behavior change.

C2: `b1f67757f`. Phase C: 9 pass / 6 intended failures (exports plus files)
before deletion. After removal: 166 focused/package tests pass, 679 assertions.
Quick conformance, docs validation, and lint pass (same five existing warnings).
Only the three approved unused hook implementations were deleted; Git history
retains them. Existing navigation, shared resize code, and internal helpers remain.
SDK README and root README have no affected public-import recommendations.

C3: `2e4a4936e`. Independent read-only review: no actionable findings; reviewer
also ran 59 focused SDK tests successfully and rechecked first-party imports.
Full conformance passed quick/typecheck/lint, CSS build, all repository tests
(9,412 pass, 15 existing skips, zero failures), and vendor/core-plugin/host builds.
The first payload check stopped because the pinned Bits archive lacked its
dependencies. Installed its frozen lockfile in that temporary copy, then resumed
the unchanged full-conformance command list at the payload checkpoint.
Docker Desktop was installed but stopped; started it for canonical container
visual/browser checks. No visual baseline or performance ceiling was changed.

Resumed full checks: payload ratchet passed (15 plugin clients, 37 vendor chunks,
one system stylesheet). Consecutive public Storybook builds were deterministic.
All 331 Storybook tests passed (112 files; five files skipped by existing suite
configuration). Canonical Linux Chromium desktop/mobile visuals: 274 passed,
unchanged baselines; report `playwright-report/ui/index.html`.

Canonical Linux cross-browser behavior: 93 passed across Chromium, Firefox, and
WebKit; report `playwright-report/ui-browser/index.html`. Plugin UI conformance
teeth passed. Published docs validation, route checks, site build, and public
Storybook integration passed (443 public stories published to local docs output).
All configured full-conformance steps completed successfully across the initial
run and the documented resume. No new skips, suppressions, baseline changes,
allowance increases, or budget increases were introduced.

Raw local logs: `/tmp/bakin-804-full.log` and
`/tmp/bakin-804-full-resume.log`. Unrelated generated-doc refreshes were restored
after verification; the SDK reference and intended author guidance remain updated.
No release, deployment, remote push, PR, or GitHub ticket mutation was performed.

### UI conformance

- Patterns: existing public agent-avatar, agent-status, agent-select, color-picker,
  workspace-page, and copy-button stories listed in the spec.
- Contracts: narrowed SDK `/patterns`, `/hooks`, `/utils`, `/slots`; existing
  `/navigation` dirty-exit and all package subpaths preserved.
- Guidance: current UI overview, SDK reference, and knowledge recommendations updated.
- Deviation: none; internal UI implementations and visual baselines unchanged.
- Verification: focused tests, real packaged JS/declarations, quick and full
  conformance, independent review; see counts and report paths above.

## Separate follow-ups

- #805: metadata entrypoint retirement, separate PR.
- #806: full list/table usage audit before deciding/documenting the ruling.
- Official Bits: remove retired public names from ambient declarations and test
  doubles; preserve its private overflow helper. No product consumer was found.
  This is recorded follow-up scope, not authorization to edit that repository.
