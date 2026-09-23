# Form components overhaul — implementation plan

Status: C0–C13 complete on `codex/form-components-overhaul`; full conformance passed.
Date: 2026-09-22.
Inputs: [approved spec](form-components-overhaul.md),
[audit](form-components-overhaul-audit.md).

## Outcome and scope

Deliver the approved text/selection foundation in public Storybook, including
sizes and appearances, bounded Textarea growth, InputGroup recipes, Select
multiple-value summaries, and a dedicated Combobox. Align large buttons at
44px. Audit findings for other controls remain a follow-up backlog. Product
pages and domain pickers are regression consumers, not migration targets.

Work through the tasks sequentially. Each task changes at most five named
source/test/docs files; a commit may group dependent tasks to preserve a
working public contract. Do not publish exports without their stories or
commit failing behavioral tests. Failing tests belong to the local red/green
cycle, not a checkpoint. No subagents are needed for this plan.

The existing unrelated modification to
`packages/host/src/api/_embedded-assets-static.ts` must not be staged, reset or
overwritten. Record its starting diff before commands that may generate assets.
Do not stash unrelated work or create broad cleanup commits.

## Architecture and dependency decisions

1. Keep Base UI 1.4.1 (currently installed), React 19 and Bun 1.3.13. No new
   UI, form-state, autosize or positioning dependency is planned.
2. Add private `control-styles.ts` for the shared presentation recipe and
   `ControlSize`/`ControlVariant` types. Export only the two types publicly;
   recipe details remain private. Use existing semantic tokens.
3. Input and default FieldControl consume the same recipe. InputGroup owns its
   shell and child appearance through a small private group context; avoid
   provider defaults on Form or Field. ComboboxControl reuses the recipe and
   composition rules with Base UI InputGroup behavior.
4. Manual Textarea is a native rows-based control. Auto mode uses a private
   measurement hook if native CSS cannot satisfy the cross-browser contract.
   Prove width/font/reset behavior before extending group composition.
5. Select retains its current root behavior; the trigger gets the approved
   presentation props. Summary rendering uses the existing SelectValue render
   callback; no extra selected-value state store.
6. Combobox is a styled Base UI composition. Reuse option-list styling and
   PluginPortalBoundary; never reconstruct keyboard, chip or selection state.
7. Storybook contracts and failing interaction expectations lead each slice;
   implementation follows within that slice. Public exports, stories, docs,
   API registration and tests ship together at their commit checkpoint.
8. Application TypeScript includes Storybook and tests. The public API checker
   inventories exports, while story compliance checks visual test references.
   Therefore a new Combobox can have its visual test registered before approved
   PNGs exist, without adding a coverage exemption.

Dependency order:

```text
Baseline / browser risk probes
  -> shared presentation + Input/FieldControl + public types
     -> aligned Button
     -> Textarea manual + auto sizing
        -> InputGroup appearance + child ownership
           -> InputGroup recipes
     -> Select variants + multiple summary
     -> Combobox primitive + publication
        -> multiple/chip/compact behavior
        -> async/rich option behavior
  -> form/overlay integration + docs
  -> visual approval and baseline update
  -> full conformance and handoff
```

Independent families could be developed in parallel after the shared contract,
but source barrels, stories and ledgers overlap. Sequential execution is the
default and avoids coordination overhead.

## Verification commands

Run from repository root. Replace no scripts or CI settings to make failures
pass. For focused commands below, execute only after the named new file exists.

**Q — quick checkpoint**

```sh
bun run ui:conformance --quick
```

**U — existing focused behavior**

```sh
bun test --isolate tests/ui/primitives/text-field-primitives.test.tsx tests/ui/primitives/selection-primitives.test.tsx tests/ui/forms/form-composition.test.tsx
```

Additional focused commands as the relevant tasks land (use only the files
whose behavior changed, not this whole set on every iteration):

```sh
bun test --isolate tests/ui/primitives/textarea-sizing.test.tsx
bun test --isolate tests/ui/primitives/combobox.test.tsx tests/ui/primitives/plugin-portal-containment.test.tsx
bun test --isolate tests/ui/patterns/search-input.test.tsx
bun test --isolate tests/ui/primitives/action-status-primitives.test.tsx tests/ui/primitives/button-busy.test.tsx
bun run docs:check
```

**S — affected Storybook interactions and axe**

```sh
bun run ui:test:stories storybook/public/primitives/input.stories.tsx storybook/public/primitives/textarea.stories.tsx storybook/public/primitives/input-group.stories.tsx storybook/public/primitives/select.stories.tsx storybook/public/primitives/button.stories.tsx storybook/public/forms/form-composition.stories.tsx
```

Add `storybook/public/primitives/combobox.stories.tsx` to S after publication.
Vitest's file filter is supported by the script's direct `vitest --run
--project=storybook` invocation. Use a single affected story path while
iterating; the complete group is for checkpoints.

**B — canonical three-engine behavior**

```sh
bun run ui:test:browsers
```

Existing wrapper accepts no test-file/grep forwarding; do not assume flags
passed to it reach Playwright. It builds public Storybook and runs the
canonical Linux container. The new `*.browser.pw.ts` tests are discovered
automatically in all Chromium/Firefox/WebKit projects.

**P — payload and deterministic publication**

```sh
bun run build:vendors
bun run ui:performance
bun run ui:build:public:verify
```

**F — final aggregate**

```sh
bun run ui:conformance --full
```

F includes Q, lint, tests, builds, payload validation, deterministic Storybook,
story tests, visuals, browsers, plugin conformance and docs. Once F passes,
do not rerun its constituents without a new change or unresolved failure.

**A — deliberate API registration**

```sh
bun run ui:public-api:generate
bun run ui:public-api:check
bun run ui:story-compliance:check
bun run ui:kit-coverage:check
```

Run A only for the approved export additions. Inspect the inventory diff;
never refresh story/kit/legacy allowances. Preserve existing test isolation,
React act/cleanup rules, temporary storage and no-live-data boundaries.

## Phase 0 — baseline and browser feasibility

### T01 — Record baseline and resolve browser risks

- **Files:** audit document; new
  `tasks/evidence-form-components-overhaul.md`.
- **Dependencies:** plan approval.
- **Acceptance:** record HEAD, dirty-file ownership, existing story IDs and
  before images; distinguish pre-existing failures. Verify canonical container
  and browser availability. In disposable local probes, evaluate textarea
  content sizing/rows and Base UI Combobox chips/focus in Dialog at 320px.
- **Verify:** reuse the recorded passing U/Q receipts if the relevant source
  and checkout are unchanged; otherwise refresh them. Run affected existing S
  stories, B and canonical visual render
  with snapshot writes disabled (protocol below). Probe results decide native
  CSS versus a private autosize hook. Preserve evidence, not experimental code.
- **Stop condition:** missing browser/runtime prerequisites or an upstream
  limitation that changes the approved behavior must be reported before its
  dependent task. Continue independent read-only planning/evidence work.

**Checkpoint C0:** approved spec/plan and baseline evidence committed. Baseline
browser runs have not been performed during planning; they are an execution
prerequisite and not claimed as passing here.

## Phase 1 — shared presentation and text entry

### T02 — Define and implement Input/FieldControl presentation

- **Files:** `packages/ui/src/primitives/control-styles.ts` (new),
  `packages/ui/src/primitives/input.tsx`, `packages/ui/src/forms/field.tsx`,
  `storybook/public/primitives/input.stories.tsx`,
  `tests/ui/primitives/text-field-primitives.test.tsx`.
- **Dependencies:** T01.
- **Acceptance:** public story defines the 3×3 matrix first; Input and default
  FieldControl implement it and htmlSize without leaking presentation props
  into DOM. Preserve native props, refs and Base UI className callbacks.
  Custom-render FieldControl does not add a second shell.
- **Verify:** focused text-field tests, affected story plays and computed
  geometry; existing field association tests stay green. Move brittle class
  assertions only when replaced with meaningful behavior/browser evidence.

### T03a — Publish shared presentation types

- **Files:** `packages/ui/src/index.ts`, `packages/sdk/src/ui/index.ts`,
  `design-system/public-api.json`.
- **Dependencies:** T02.
- **Acceptance:** only ControlSize/ControlVariant are added to public type
  exports; private recipe stays private; inventory contains no unrelated drift.
- **Verify:** A and Input story; retain locally for the complete C1 checkpoint.

### T03b — Preserve consumer boundaries and document presentation

- **Files:** `packages/ui/src/patterns/search-input.tsx`,
  `.claude/knowledge/style-guide.md`,
  `docs/src/content/docs/extending/ui/overview.md`.
- **Dependencies:** T03a.
- **Acceptance:** explicitly omit the new visual variant prop from
  SearchInput's inherited Input prop surface before C1; no new SearchInput
  feature or product migration. Document approved sizes/appearances, htmlSize,
  label/focus behavior and existing full-width Input behavior.
- **Verify:** SearchInput tests, A, U, Q and Input story. Commit T02–T03b as C1.

### T04 — Align large buttons

- **Files:** `packages/ui/src/primitives/button.tsx`,
  `storybook/public/primitives/button.stories.tsx`,
  `tests/ui/browser/form-controls.browser.pw.ts` (new),
  `docs/src/content/docs/extending/ui/overview.md`.
- **Dependencies:** T03b.
- **Acceptance:** lg and icon-lg measure 44px at standard text size; sm/md
  remain 32/36px; a peer-alignment story checks field/button geometry and
  enlarged text does not clip. No unrelated button variant/alias cleanup.
- **Verify:** Button story tests, existing action-status and button-busy unit
  tests, Q; browser geometry assertions run through B. Commit as C2.

### T05 — Implement Textarea manual sizing and presentation

- **Files:** `packages/ui/src/primitives/textarea.tsx`,
  `storybook/public/primitives/textarea.stories.tsx`,
  `tests/ui/primitives/text-field-primitives.test.tsx`,
  `tests/ui/browser/form-controls.browser.pw.ts`.
- **Dependencies:** T03b.
- **Acceptance:** manual mode defaults to three rows, honors explicit rows,
  retains vertical resizing and all sizes/appearances. Remove unconditional
  content sizing/minimum height that defeats native rows. Field association,
  readonly copyability and disabled semantics remain intact.
- **Verify:** focused tests and Textarea plays; browser asserts three-row
  geometry, long-line containment and manual resize. Keep local until T06/T07.

### T06 — Add bounded Textarea auto mode

- **Files:** `packages/ui/src/primitives/textarea.tsx`, optional private
  `packages/ui/src/primitives/use-textarea-autosize.ts`,
  `tests/ui/primitives/textarea-sizing.test.tsx` (new),
  `storybook/public/primitives/textarea.stories.tsx`,
  `tests/ui/browser/form-controls.browser.pw.ts`.
- **Dependencies:** T01 probe, T05.
- **Acceptance:** discriminated manual/auto props; default auto bounds 3–10
  rows; expand/shrink/scroll behavior survives paste, controlled value changes,
  reset, resize and font scaling without changing selection. Clean up
  observers/listeners; invalid bounds produce a useful development error.
- **Verify:** sizing logic tests, Textarea story plays and B in all engines.
  A CSS-only solution must pass the same browser requirements as a hook.

### T07 — Document text height and shared visual direction

- **Files:** `.claude/knowledge/style-guide.md`,
  `.claude/knowledge/design-system.md`,
  `docs/src/content/docs/extending/ui/overview.md`.
- **Dependencies:** T04, T06.
- **Acceptance:** explicit rows/autoSize/minRows/maxRows examples; manual
  versus auto behavior and revised default documented; contextual size does
  not become a density/theme switch.
- **Verify:** Q and affected S stories; inspect doc examples for type/API
  consistency. Commit T05–T07 as C3; C2 remains separately revertible.

**Checkpoint:** C1–C3 compile and pass focused behavior; record candidate
visual changes. No PNG baseline updates or product migration yet.

## Phase 2 — grouped entry and its recipes

### T08 — Give InputGroup sole visual ownership

- **Files:** `packages/ui/src/primitives/input-group.tsx`,
  `packages/ui/src/primitives/control-styles.ts`,
  `storybook/public/primitives/input-group.stories.tsx`,
  `tests/ui/primitives/text-field-primitives.test.tsx`.
- **Dependencies:** T06.
- **Acceptance:** group owns size/variant; children cannot independently
  restyle the shell; input and textarea align with addons. Disabled opacity
  applies once; an independently disabled action leaves typing usable.
  Preserve the existing SearchInput behavior when it consumes the group.
- **Verify:** text-field and SearchInput unit tests, InputGroup plays, Q.
  Characterize readonly focus/copy and invalid/disabled addon interactions.

### T09 — Build working text-entry recipes

- **Files:** `storybook/public/primitives/input-group.stories.tsx`,
  `storybook/support/form-input-recipes.tsx` (new if helpers are needed),
  `tests/ui/browser/form-controls.browser.pw.ts`,
  `docs/src/content/docs/extending/ui/overview.md`.
- **Dependencies:** T08.
- **Acceptance:** all seven approved recipes work. Clear/reveal preserve
  focus/value; count agrees with native maxLength; copy reports real outcome;
  submit prevents duplicates. CanonicalUsage imports only public SDK controls;
  support helpers belong solely to non-canonical showcases.
- **Verify:** recipe plays, browser keyboard/focus/geometry, Q. Test readonly,
  disabled and loading separately. Use existing CopyButton/Spinner/Form
  contracts rather than adding competing convenience components.

### T10 — Prove group behavior and document constraints

- **Files:** `tests/ui/forms/form-composition.test.tsx`,
  `storybook/public/forms/form-composition.stories.tsx`,
  `.claude/knowledge/style-guide.md`,
  `tasks/evidence-form-components-overhaul.md`.
- **Dependencies:** T09.
- **Acceptance:** grouped textarea respects both height modes; help/errors
  identify the real control; addon tab order and local submission work inside
  a form. Evidence records all sizes with addons at 320px and 200% text.
- **Verify:** U, S, B; Q. Commit T08–T10 as C4.

## Phase 3 — bounded selection

### T11 — Extend Select presentation and document multiple values

- **Files:** `packages/ui/src/primitives/select.tsx`,
  `storybook/public/primitives/select.stories.tsx`,
  `tests/ui/primitives/selection-primitives.test.tsx`,
  `tests/ui/browser/form-selection.browser.pw.ts` (new),
  `docs/src/content/docs/extending/ui/overview.md`.
- **Dependencies:** T03b.
- **Acceptance:** size/variant plus full/auto width; sm/md/lg replace
  sm/default in stories; single/multiple summary, placeholder/none and
  grouped/rich/disabled cases are explicit. Use existing SelectValue render
  callback and provide textual typeahead for rich items.
- **Verify:** selection tests, Select story, browser keyboard/typeahead/reset
  and 320px popup containment, Q. Search typed consumers before removal of
  `default`; current source audit found it in the Select stories. Any new
  mechanical repair stays in this commit, not a shim. Commit as C5.

## Phase 4 — searchable selection

### T12 — Implement the Base UI Combobox composition

- **Files:** `packages/ui/src/primitives/combobox.tsx` (new),
  `packages/ui/src/primitives/option-list.ts`,
  `packages/ui/src/primitives/control-styles.ts`,
  `tests/ui/primitives/combobox.test.tsx` (new),
  `tests/ui/primitives/plugin-portal-containment.test.tsx`.
- **Dependencies:** T01 dialog probe, T08, T11.
- **Acceptance:** implement the spec's 16 parts with typed Base UI contracts,
  shared shell/option styling and portal ownership. Include basic chip/clear
  parts; use Base UI state/refs/callbacks without a parallel state machine.
- **Verify:** focused Combobox and portal tests using internal imports until
  T13 publishes; prove label association, single/multiple values and named
  form serialization. T12 is not a standalone public checkpoint.

### T13 — Publish Combobox with its first working stories

- **Files:** `packages/ui/src/index.ts`, `packages/sdk/src/ui/index.ts`,
  `design-system/public-api.json`,
  `storybook/public/primitives/combobox.stories.tsx` (new),
  `tests/ui/visual/form-controls.visual.ts` (new).
- **Dependencies:** T12.
- **Acceptance:** publish exactly the approved 16 values and their Props
  types; demonstrate every exported component. CanonicalUsage first, SDK-only,
  interactive args, play assertions, coverage axes and a real visual test
  reference. Include single choice, basic chips, grouping and empty/status.
- **Verify:** A, Combobox story tests, Q and canonical candidate visuals with
  `--update-snapshots=none`. Missing PNGs remain explicit pending approval.

### T14 — Document and measure the new public primitive

- **Files:** `docs/src/content/docs/extending/ui/overview.md`,
  `.claude/knowledge/style-guide.md`,
  `tests/ui/architecture/selection-primitives.test.ts`,
  `tasks/evidence-form-components-overhaul.md`.
- **Dependencies:** T13.
- **Acceptance:** Select-versus-Combobox guidance and basic API examples;
  one implementation is exported through the SDK; private style/portal
  internals stay private. Record actual payload delta.
- **Verify:** A, Q, P and focused behavior. If growth exceeds the existing
  budget, investigate exports/dependency sharing before proposing any budget
  increase. Commit T12–T14 as C6.

### T15 — Complete multi-value and compact selection behavior

- **Files:** `storybook/public/primitives/combobox.stories.tsx`,
  optional `storybook/support/combobox-examples.tsx`,
  `tests/ui/primitives/combobox.test.tsx`,
  `tests/ui/browser/form-selection.browser.pw.ts`,
  `docs/src/content/docs/extending/ui/overview.md`.
- **Dependencies:** T14.
- **Acceptance:** wrapping chips plus editable query, compact summary recipe,
  accessible full selection, clear/remove actions and object-value identity.
  Preserve values across presentation changes; do not nest interactive items.
- **Verify:** story plays and browser keyboard/chip removal/long-content
  checks, serialization tests, Q. Commit as C7 when green.

### T16 — Complete async, rich and unavailable-option recipes

- **Files:** `storybook/public/primitives/combobox.stories.tsx`,
  `storybook/support/combobox-examples.tsx`,
  `tests/ui/browser/form-selection.browser.pw.ts`,
  `docs/src/content/docs/extending/ui/overview.md`,
  `.claude/knowledge/style-guide.md`.
- **Dependencies:** T15.
- **Acceptance:** deterministic caller-owned async results; stale responses
  ignored; loading/no-match/failed/retry distinguished. Preserve selected
  labels absent from filtered results, and label confirmed unavailable values.
  Rich items remain noninteractive, with stable text labels. No live requests.
- **Verify:** play assertions for state transitions, browser retry focus and
  status announcements/association, Q. Commit as C8. If a primitive defect is
  discovered, add a separate focused source/test repair task before committing;
  do not silently expand this five-file recipe task.

## Phase 5 — whole-form proofs and documentation

### T17 — Prove submission, reset and overlay composition

- **Files:** `storybook/public/forms/form-composition.stories.tsx`,
  `storybook/public/recipes/form-in-drawer.stories.tsx`,
  `tests/ui/forms/form-composition.test.tsx`,
  `tests/ui/browser/form-selection.browser.pw.ts`,
  `tests/ui/browser/form-controls.browser.pw.ts`.
- **Dependencies:** T10, T11, T16.
- **Acceptance:** mixed controls submit actual named scalar/array/object
  values; controlled/uncontrolled resets are deliberate; failed submission
  retains the draft. Select/Combobox work in Dialog/Drawer with focus return,
  Escape and nontrapped retry actions. IME Enter does not prematurely submit.
- **Verify:** U, focused new unit files, S, B and Q. Commit as C9.

### T18 — Complete public guidance and deferred-family audit

- **Files:** `.claude/knowledge/style-guide.md`,
  `.claude/knowledge/design-system.md`,
  `docs/src/content/docs/extending/ui/overview.md`,
  `.claude/specs/form-components-overhaul-audit.md`,
  `tasks/evidence-form-components-overhaul.md`.
- **Dependencies:** T17.
- **Acceptance:** reconcile every spec requirement to a story/test/evidence
  reference. Review checkbox/radio/switch/file/color/date/numeric/domain picker
  findings against existing stories and record a prioritized follow-up. Review
  README and ui-patterns impact; no edits if their guidance remains accurate.
- **Verify:** docs check and Q; source/API examples match implementation.
  Record exact mechanical repairs if any; confirm no product-page migration.
  Commit as C10.

## Phase 6 — visual review and completion

### T19 — Capture a reviewable visual change set

- **Files:** `tests/ui/visual/form-controls.visual.ts`,
  `tests/ui/visual/foundation.visual.ts` if an existing anchor needs adjustment,
  `tasks/evidence-form-components-overhaul.md`.
- **Dependencies:** T18.
- **Acceptance:** 3×3 matrices and focus/invalid/readonly/disabled states have
  candidate visual evidence at desktop and 320px. Show appearances on canvas,
  default and elevated surfaces, plus grouped controls and popup/chips. Inspect
  existing AgentSelect/ModelSelect/SearchInput/settings/drawer screenshots for
  inherited regressions. List every changed/new PNG path and its rationale.
- **Verify:** canonical visual protocol with writes disabled; inspect reports,
  computed contrast/geometry and forced-colors/reduced-motion browser results.
  Fix unexpected changes before requesting approval. Commit visual test code
  and evidence as C11; approved baseline PNGs are a later commit.

### T20 — Update only explicitly approved baselines

- **Files:** only the exact PNG allowlist approved after T19, plus evidence.
  Divide allowlist into batches of at most four PNGs plus the evidence file;
  each batch is a small subtask, all grouped in C12.
- **Dependencies:** explicit visual-baseline approval, T19.
- **Acceptance:** canonical rendering; each file has matching reviewed
  candidate evidence. No unrelated baseline, threshold, mask or allowance
  changes. This task may wait for approval while other authorized repairs or
  docs work continue.
- **Verify:** review actual changed-path list against approval, canonical
  visual comparison passes afterward. Commit as C12 only when complete.

### T21 — Final verification and handoff

- **Files:** `tasks/evidence-form-components-overhaul.md`, spec and plan
  status, audit status (four documents).
- **Dependencies:** T20.
- **Acceptance:** F passes; every acceptance item links to evidence; exact
  public API delta and deferred migration work are recorded. Browser review
  includes the maintained Storybook session for user inspection. No live data
  touched, no unpublished contract drift and no unrelated edits staged.
- **Verify:** F, `git diff --check`, final diff/code-quality review. A fix after
  F gets its relevant checks rerun, then the affected aggregate gate. Commit
  evidence as C13. Do not claim merge-ready if any required check is blocked.

## Visual approval protocol

The current `ui:snapshots:update` invokes `--update-snapshots=all` without
filtering, so do not use it indiscriminately. Candidate rendering must also
disable Playwright's automatic creation of missing baselines.

Use the existing pinned image
`mcr.microsoft.com/playwright:v1.60.0-noble`, linux/amd64, prebuilt public
Storybook, `/work` mount and cache setup from
`scripts/ui/playwright-container.ts`. Inside that container, run the existing
canonical-environment validation before the Playwright invocation. Use
`validateCanonicalEnvironment(currentCanonicalEnvironment(), 'render')` for
candidates and `'update'` for approved baseline updates. Reject seed-diff mode
and CI for updates as the existing runner does.

Candidate invocation inside the validated canonical container:

```sh
node node_modules/playwright/cli.js test --config=playwright.ui.config.ts --update-snapshots=none
```

Approved update invocation inside that validated container (one test/file
group at a time, exact titles chosen from the reviewed allowlist):

```sh
node node_modules/playwright/cli.js test tests/ui/visual/form-controls.visual.ts --config=playwright.ui.config.ts --grep '^APPROVED_EXACT_TEST_TITLE$' --update-snapshots=all
```

`APPROVED_EXACT_TEST_TITLE` is an intentional placeholder resolved from T19's
evidence, not a command to run literally. Existing foundation tests use titles
such as `public primitives-input visual baseline`; use anchored exact titles
and the approved project (`--project=chromium-desktop` or `chromium-mobile`)
when approval covers only one image. Keep invocation details in the evidence.
No runner/CI modification is needed to target Playwright in the already
validated canonical environment.

Visual test code can precede approved PNGs in working checkpoints; quick
conformance checks the story's test reference. Those checkpoints are
compile/behavior verified, not full visual-conformance or merge-ready claims.
Provide one consolidated review set at T19 to avoid repetitive approvals.

## Commit and rollback strategy

Use a short-lived task branch if not already on an appropriate branch; inspect
the current branch/worktree first. Stage exact task paths, never `git add .`.
Record actual commit SHAs and verification receipts in the evidence document.
No push, merge or deployment is included in plan approval.

| Checkpoint | Tasks | Conventional commit | Rollback boundary |
| --- | --- | --- | --- |
| C0 | T01 plus approved documents | `docs(ui): specify form overhaul and baseline evidence` | No runtime effect |
| C1 | T02–T03b | `feat(ui): unify input sizes and appearance variants` | Includes SearchInput type boundary; revert downstream users of shared types first |
| C2 | T04 | `feat(ui): align large buttons with 44px fields` | Independent button change; revert related visual evidence if present |
| C3 | T05–T07 | `feat(ui): define textarea sizing and bounded growth` | Revert grouped textarea dependencies first |
| C4 | T08–T10 | `feat(ui): unify input group presentation and recipes` | Revert shell and child changes as one unit |
| C5 | T11 | `feat(ui): extend select variants and multiple-value presentation` | Includes all default-to-md mechanical fixes |
| C6 | T12–T14 | `feat(ui): publish the combobox foundation` | Exports, implementation, stories, docs and inventory revert together |
| C7 | T15 | `feat(ui): document chip and compact combobox selection` | Revert dependent integrated stories first |
| C8 | T16 | `feat(ui): define async combobox states and recovery` | No persistence/data rollback needed |
| C9 | T17 | `test(ui): prove form and overlay control integration` | Revert before component removals |
| C10 | T18 | `docs(ui): complete form contracts and migration backlog` | Restore guidance matching retained code |
| C11 | T19 | `test(ui): capture form control visual coverage` | Restore snapshot test registrations with their baselines |
| C12 | T20 | `test(ui): approve form overhaul visual baselines` | PNGs stay aligned with the code version they represent |
| C13 | T21 | `docs(ui): record form overhaul verification` | Evidence-only status change |

Rollback uses `git revert`, not destructive resets. For a full rollback,
revert C13 through C1 in reverse dependency order, retaining C0 as historical
intent/evidence. For a partial rollback, remove dependent stories/exports/docs
and corresponding approved baselines together. Run Q plus the affected
behavior/visual checks, and F before calling the resulting state merge-ready.
No database, runtime configuration or user-data rollback is involved.

## Risks, mitigation and approval boundaries

| Risk | Mitigation / completion condition |
| --- | --- |
| CSS content sizing differs across browsers | Early probe; native rows default; measured private hook only when required; three-engine height tests |
| Input numeric size collides with visual size | htmlSize API; DOM forwarding assertions and compiler coverage |
| InputGroup double styling or opacity | One shell owner; child prop omission; browser focus/disabled/readonly proof |
| New Input props leak into SearchInput via type inheritance | Targeted omission repair in T03b before C1, no domain redesign |
| Async option refresh loses selection or accessible label | Separate query/value, stable serialization/identity and deterministic stale-result fixtures |
| Chips, retry or clear disrupt popup keyboard behavior | Base UI ownership; no nested buttons; early Dialog probe and focus/IME tests |
| Ghost or filled disappear on surrounding surfaces | Parent-surface visual/contrast evidence before baseline approval; exact token proposal if necessary |
| New Combobox increases SDK payload | Measure at C6; optimize import/export graph; no silent ceiling increase |
| Existing picker/page visuals inherit core changes | Review representative screenshots; repair actual regressions without migrating their UI |
| Canonical updater replaces unapproved images | Candidate `--update-snapshots=none`; exact filtered updates only after path approval |
| Build generation touches unrelated dirty manifest | Record ownership/diff; omit asset-manifest generation when not needed; preserve unrelated work |

Plan approval authorizes the listed implementation, tests, docs and local
checkpoint commits. It does not authorize baseline replacement, new public
tokens/entrypoints, accessibility suppressions, payload ceiling increases,
product UI migration, or publishing. Existing approvals cover the named
component extensions; do not request them again.

## Plan review checklist

- [x] Every task has named files, dependencies, acceptance and verification.
- [x] Tasks are bounded to five files; image updates are explicitly batched.
- [x] Public exports ship with working examples and API registration.
- [x] Storybook definition leads each implementation slice.
- [x] High-risk browser behavior is evaluated before dependent implementation.
- [x] Testing avoids CSS-string-only proofs and redundant final suite runs.
- [x] Knowledge/public docs and README impact are accounted for.
- [x] Rollback order covers exports, stories, docs and baseline dependencies.
- [x] Core work is separated from product/domain migration.
- [x] User approves this plan, including local checkpoint commits.
- [x] Exact baseline changes are reviewed after implementation evidence exists.

No design question remains open before plan review. Implementation feasibility
checks may reveal a concrete issue; record it and resolve it without silently
weakening the approved contract.


## Execution refinements

- T15/T16 share both the story file and support helper; C7+C8 are combined as
  one coherent recipe checkpoint. Their separate acceptance checks remain.
- Added a focused source repair (control-styles/InputGroup/Combobox), followed
  by generated stylesheet verification: sharing the identical focus selector
  removes duplicate CSS. The six separately approved payload adjustments form
  the adjacent performance checkpoint `73a72a4c1`.
- T17 uses a dedicated `form-composition.browser.pw.ts` instead of mixing whole
  form and IME proofs into the prior geometry/selection files. The mixed recipe
  explicitly resets controlled Combobox state because installed Base UI does
  not restore it on a native form reset. Native Textarea reset remains covered.
- Full-suite review exposed one stale task-board test that checked the inner
  search input's height class. Its assertion now checks the md InputGroup owner;
  canonical browser tests continue to measure actual control geometry.
- T19 adds Input SurfaceContexts and browser checks for forced colors, reduced
  motion and enlarged textarea text. These complete the already approved
  appearance/accessibility matrix without a new public API or token.


### Approved control-border extension

The user approved `tasks/form-components-border-review.md` after measured
resting contrast of 1.90–2.10:1. Implement in bounded slices: (1) reference,
semantic and component token sources, shared control recipe and token test;
(2) generated token/CSS/story/docs artifacts; (3) rendered contrast proof,
guidance and final canonical review evidence. One coherent local checkpoint
may group the slices so generated artifacts always match their sources.
The generated property is `--bakin-color-border-control`, following existing
naming, and the shared utility is `border-bakin-border-control`. No separator,
focus/error token, public entrypoint or performance ceiling changes accompany
this extension. Exact PNG approval remains separate.


### Final visual review checkpoint

T19/C11 is complete, including the separately approved control-border token.
`tasks/form-components-visual-review.md` lists the exact 66 candidate paths
(18 new, 48 replacements), with before/after evidence and artifact hashes.
The full canonical comparison leaves 232 existing baselines unchanged. All
354 Storybook tests, 9,662 repository tests and 33 focused browser checks pass.
T20/C12 remains gated on exact PNG approval; T21/C13 full aggregate validation
follows the approved update. No product migration or baseline write occurred.


### Approved baseline and PR execution

The user approved the exact 66-path PNG inventory and requested a passing PR.
C12 (`f543b2fe3`) changes 65 PNGs: 18 new and 47 replacements; the calendar
candidate reproduced its original committed baseline and needed no change.
Token metadata now describes outlined boundaries only, matching the final
explicitly requested borderless filled treatment. No unapproved snapshot path,
mask or tolerance changed. PR #914 is open; C13 full conformance is in progress.
The latest instruction authorizes branch publication and PR creation, superseding
the original plan's no-push boundary. Merge and deployment remain unrequested.


### C13 completion

`bun run ui:conformance --full` passed against implementation/baseline checkpoint
`f543b2fe3`: 9,662 repository tests (18 skipped), 354 Storybook tests, 298 visual
comparisons and 126 browser checks. Tokens/API/governance, TypeScript, lint,
production builds, payload limits, deterministic Storybook, plugin conformance
and the published documentation/catalog all passed. No baseline was rewritten
during verification. Final code review has no unresolved implementation finding.
PR #914's initial 17 checks passed after one documented transient menu-test rerun;
the final evidence-only commit is subject to the same CI checks. Product migration
and deferred form-control families remain follow-up work, as approved.
