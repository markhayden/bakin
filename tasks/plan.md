# Implementation plan: SDK surface cleanup (#804)

Status: approved by the user ("do it"); implementation in progress.

Spec: [.claude/specs/sdk-surface-cleanup/SPEC.md](../.claude/specs/sdk-surface-cleanup/SPEC.md)
Checklist: [todo.md](todo.md).

## Outcome and fixed boundaries

Remove the nine agreed public value exports and three orphan public types.
Preserve AgentDot, AgentStatus, ColorPicker, all required internal helpers, and
all SDK package subpaths. Only useFormGuard, useFileDrop, and useVerticalResize
lose their implementations. No visible app changes, shims, dependency changes,
metadata retirement, Bits edits, release, or deployment.

Follow the existing Bun/React/TypeScript architecture. Do not turn this cleanup
into a new API framework. Existing tests, compiler facilities, and the SDK build
consumer fixture are sufficient. Keep #806's audit-first direction recorded in
the spec; do not perform that separate audit or edit GitHub tickets here.

## Dependency order and verification design

Work sequentially: preflight → runtime helpers → pattern facade → dead hooks →
final review. Runtime helpers come first because slot teardown is the highest
behavioral risk. Each phase includes tests, source changes, documentation, and
built-package verification before its commit. Shared fixtures and generated
docs make parallel edits unhelpful.

For each phase, first add only that phase's negative assertions and see them fail
for the expected exported names. Then remove the exports and verify positive
behavior. Do not add all future negative assertions at once or commit red tests.

Source guards must inspect actual module exports (using existing compiler/build
facilities), not merely check whether names appear anywhere in a file. Internal
imports legitimately retain some names. Built-package runtime namespace checks
must assert removed names are absent and retained APIs are functions/components.
Use isolated browser setup where needed; do not initialize live app services.

Extend `tests/fixtures/sdk-focused-consumer/index.ts` with positive imports and
precise `@ts-expect-error` negative imports/types. The existing package-build test
type-checks this fixture against emitted declarations without workspace aliases;
an accidentally restored export must produce an unused-expect-error failure.
Assert `/metadata` still resolves and the set of package subpaths is unchanged.

## Task 0 — preflight and planning checkpoint

Dependencies: plan approval. Files: planning documents only.

- Confirm worktree status; preserve the approved spec/plan/checklist and unrelated
  user changes. Create `refactor/sdk-surface-cleanup-804` from current main.
- Recheck the nine names across host, core, examples, tests, SDK, Storybook, and
  official Bits product source. An unexpected product consumer is a scope stop.
- Record Bun version, main revision, and baseline quick-conformance/package-test
  outcomes. Verify browser tooling and pinned Bits source availability before
  interpreting later conformance failures.

Acceptance: branch and baseline are recorded; no source has changed; any existing
failure is distinguished from a regression. Commit C0 contains planning only.

## Phase A — runtime helper facades

### Task 1 — preserve behavior and expose public-removal failures

Dependencies: 0. Likely files (4): new
`tests/sdk/public-surface.test.ts`, `tests/sdk/plugin-fetch.test.ts`,
`tests/sdk/slots.test.tsx`, `tests/sdk/register.test.ts`.

- Add negative public-export checks for pluginApiUrl, copyToClipboard,
  getSlotEntries, and clearSlotsOwnedBy; preserve positive checks for pluginFetch,
  Slot, and registerSlot.
- Move helper-level test imports to implementation modules. Keep public
  register/unregister and Slot-rendering tests public, preserving owner isolation
  and cleanup assertions rather than deleting them.

Acceptance/verify: existing behavior tests still pass; new absence checks fail
only because the four names are still publicly exported.

### Task 2 — remove four facade exports

Dependencies: 1. Files (2): SDK `utils/index.ts`, `slots/index.tsx`.

Remove only the four public exports and associated misleading facade comments.
Keep pluginFetch URL construction, clipboard fallback, registry internals, and
server-safe register imports untouched. Preserve getSlotNamesOwnedBy.

Acceptance/verify: Task 1 tests and clipboard tests pass; no implementation helper
is deleted and no React dependency enters the server-side registry path.

### Task 3 — lock the built package and docs to Phase A

Dependencies: 2. Likely files (3–5): `tests/scripts/build-sdk-package.test.ts`,
`tests/fixtures/sdk-focused-consumer/index.ts`, generated SDK reference; update
SDK README or dev-loop guidance only if current claims need correction.

Extend the existing package build test/consumer with runtime and declaration
assertions for this phase. Regenerate SDK docs and review the exact delta.
Internal slot-cleanup documentation remains legitimate and must not be removed.

Acceptance/verify: source and built-package contracts agree; existing slot,
register, fetch, and clipboard behavior passes; docs no longer advertise these
four public helpers. Run checkpoint A and commit C1.

## Phase B — pattern facade

### Task 4 — guard supported composition and component retention

Dependencies: checkpoint A. Likely files (up to 4): source public-surface test,
page-header, workspace-page, and agent-identity-patterns tests.

Add negative checks for PageHeaderOverflowMenu, PageHeaderOverflowMenuProps, and
ASSIGNED_AGENT_VALUE; positive checks retain AgentDot, AgentStatus, ColorPicker.
Use existing overflow and assigned-selection behavior tests; strengthen only
missing assertions. Preserve the assigned value and emitted selection behavior.

Acceptance/verify: behavioral coverage passes while new absence assertions fail
for the intended facade names. Existing picker and agent-status tests also pass.

### Task 5 — contract removal and tightly bounded inventory delta

Dependencies: 4. Files (3): SDK `patterns/index.ts`, public-api.json,
kit-coverage.json.

Remove the two value exports and overflow props type from the public facade.
Keep internal AgentSelect and header implementations untouched. Use the existing
generators for the approved API contraction, then inspect their diffs: exactly
two pattern values, one pattern type, corresponding summary counts, and the one
PageHeaderOverflowMenu undemonstrated allowance may disappear. No other allowance
or supported API may change.

Acceptance/verify: public API/coverage checks and Task 4 guards pass with precisely
that delta; preserved components still have their public stories.

### Task 6 — package, public guidance, and Storybook contract evidence

Dependencies: 5. Likely files (4–5): package-build test, external consumer fixture,
generated SDK reference, UI overview, and an affected existing story if its
documentation needs updating.

Extend runtime/declaration checks to Phase B. Change UI overview guidance from
direct PageHeaderOverflowMenu use to the supported header overflowActions props.
Review the existing stories listed in the spec; update affected guidance without
adding a new component story or changing markup solely to create a diff.

Acceptance/verify: package types reject the removed value/type imports; retained
components compile; overflow/assignment behavior and corresponding Storybook
interactions pass. Run checkpoint B and commit C2.

## Phase C — three dead hooks

### Task 7 — test and remove the unused implementations

Dependencies: checkpoint B. Files (5): public-surface test, hooks/index.ts,
use-form-guard.ts, use-file-drop.ts, use-vertical-resize.ts.

Add failing checks for the three absent value exports, the two file-drop types,
and the three deleted implementation files. Then remove those exports and files.
Keep horizontal resizing, shared pane resizing, navigation dirty-exit guards,
and all existing upload implementations intact.

Acceptance/verify: new checks fail before removal and pass afterward; retained
hook/navigation imports compile; no live product caller required migration.

### Task 8 — remove stale recommendations and verify declarations

Dependencies: 7. Likely files (5): use-horizontal-resize.ts and
use-resizable-pane.ts comments; `.claude/knowledge/ui-patterns.md`; package-build
test and consumer fixture.

Remove stale vertical-wrapper references without changing shared resize code.
Extend runtime/declaration assertions to Phase C; verify navigation's current
dirty-exit contract instead of treating the removed form hook as its replacement.

Acceptance/verify: all nine removed runtime names and three types are rejected;
live shared hooks remain available; relevant navigation tests and typecheck pass.

### Task 9 — final documentation reconciliation

Dependencies: 8. Files: generated SDK reference and only current documentation
with verified affected claims (at most five files; split further if needed).

Regenerate the reference; inspect SDK README, root README, current knowledge
docs, and SDK JSDoc. Preserve historical specs. Record the separate Bits fixture
follow-up in the evidence checklist, not an unrequested sibling change.

Acceptance/verify: no current recommendation uses deleted APIs; no unrelated
generated churn. Run checkpoint C and commit C3.

## Checkpoint commands

At A, B, and C, run the phase's focused tests plus:

```sh
bun test --isolate tests/sdk tests/lib/copy-to-clipboard.test.tsx
bun test --isolate tests/scripts/build-sdk-package.test.ts tests/scripts/sdk-vendor-bundles.test.ts tests/architecture/release-sdk-smoke.test.ts tests/docs/sdk-reference.test.ts
bun run scripts/docs/generate.ts
bun run docs:validate
bun run ui:conformance --quick
bun run lint
git diff --check
```

At B and C also run:

```sh
bun test --isolate tests/ui/patterns/page-header.test.tsx tests/ui/patterns/workspace-page.test.tsx tests/ui/patterns/agent-identity-patterns.test.tsx tests/ui/patterns/picker-patterns.test.tsx tests/components/agent-status.test.tsx
bun test --isolate tests/ui/architecture/navigation-entrypoint.test.ts tests/ui/patterns/destructive-dirty-patterns.test.tsx
```

These are local save-point checkpoints, not declarations of merge readiness.
Run full conformance before a merge-ready handoff or separately shipped migration.
No test is claimed executed merely because its command appears in this plan.

## Task 10 — final conformance, review, and handoff

Dependencies: checkpoint C. Files: evidence/checklist, plus scoped fixes if found.

Run `bun run ui:conformance --full`. This covers repository tests, canonical CSS,
vendor/core/host builds, payload checks, deterministic Storybook, interaction and
accessibility tests, Chromium visuals, cross-browser tests, fixture teeth, and
published docs. It is broader than quick conformance; do not claim its coverage
from quick results. Record command outcomes and browser evidence paths.

Compare against the preflight baseline. Inspect every generated tracked change;
do not widen perf budgets or refresh visual baselines. Use compatibility-pinned
Bits revision `a3cfa639ea7e5557acef974dd89dd3367e7e4929` where the existing tooling
requires it, without checking out/resetting the user's sibling main. If a pinned
fixture or canonical stylesheet prerequisite blocks testing, report it and use
the established isolated workflow; never hide it with a ledger regeneration.

Review all changes against the nine-name allowlist, preserve-function list, and
spec success criteria. Include UI evidence for the existing stories, focused
entrypoints, guidance delta, no deviations, and actual tests run. No plugin UI
was intended to change, so no new plugin fixture is required. Unexpected visual
or product-surface work is a scope stop.

Acceptance: every spec criterion has evidence or an explicit unresolved blocker;
no unexplained diff. Hand off for PR direction; do not release or deploy.

## Atomic commit and rollback strategy

| Commit | Contents | Required checkpoint |
| --- | --- | --- |
| C0 `docs: specify SDK surface cleanup for #804` | Approved spec, plan, checklist | Scope/path review, whitespace check |
| C1 `refactor(sdk)!: internalize runtime helper exports` | Tasks 1–3, tests and matching docs | A |
| C2 `refactor(sdk)!: narrow pattern helper exports` | Tasks 4–6, tests/docs and exact API ledger contraction | B |
| C3 `refactor(sdk)!: remove unused hooks` | Tasks 7–9, tests and matching docs | C |
| C4 `docs: record SDK cleanup verification` | Final evidence; fixes stay separate logical commits | Full conformance and review |

Use explicit file staging and inspect staged diffs. Tests written red during a
task become green within the same implementation commit. Do not separate an API
removal from its declaration guards, current docs, or required inventory update.
Record actual commit hashes in the checklist as work lands.

Each checkpoint is a recoverable save point. If the latest implementation slice
regresses, `git revert <its-recorded-hash>` restores that whole slice. To roll back
an earlier slice after later work, revert dependent implementation/fix commits
newest-first (C3, C2, C1 as necessary), because fixtures/docs are shared. Rerun
focused and quick checks after reverting; run full before shipping a rollback.
Keep C0 as decision history and annotate the evidence if work is reverted. Never
hard-reset, discard unrelated changes, or alter published release tags.

## Approval needed

Approve this plan to begin implementation and its local checkpoint commits.
Public API changes are limited to the already-approved spec. No additional
product or visual decisions are required unless implementation finds conflicting
evidence. #805 and #806 remain separate follow-up work.
