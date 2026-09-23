# Form component overhaul — execution evidence

Approved spec and plan: `.claude/specs/form-components-overhaul{,-plan}.md`.
Starting commit: `1ecbc0b90`; branch: `codex/form-components-overhaul`.

## Ownership and approvals

- User approved implementation and local checkpoint commits.
- Visual baseline replacement remains unapproved; all candidate renders use
  `--update-snapshots=none`.
- Pre-existing dirty file: `packages/host/src/api/_embedded-assets-static.ts`.
  Its starting patch is saved at
  `/private/tmp/bakin-form-overhaul-manifest-before.patch`; never stage it.
- In-app browser tools are unavailable in this session. Repository Storybook
  and canonical Playwright runners provide browser verification instead.
- Sandbox access to local ports/Docker required execution escalation; granted.

## Initial evidence

- Unchanged baseline receipts: 18 focused tests, 75 assertions; quick
  conformance including 228 architecture tests and TypeScript passed.
- Affected Storybook baseline: **21 tests across 6 files passed**. Input,
  Textarea, InputGroup, Select, Button, Field/Form composition.
  Log: `/private/tmp/bakin-form-baseline-stories.log`.
- Public Storybook build passed. Canonical image is already available:
  `mcr.microsoft.com/playwright:v1.60.0-noble`, amd64.
- Canonical affected visual baseline: **10/10 passed**, desktop and mobile;
  no baseline files written. `/private/tmp/bakin-form-baseline-visual.log`.
- The full three-engine browser baseline passed: **93/93 tests** against the
  frozen baseline public Storybook build. `/private/tmp/bakin-form-baseline-browser.log`.
- Native textarea sizing probe results:
  `/private/tmp/bakin-form-textarea-probe.log`. The canonical engines determine
  whether auto mode needs the private measurement hook. Combobox overlay
  feasibility is verified before publishing that family, independently of Input.

## Checkpoint receipts

- C1 work: Input htmlSize/ref regression failed before implementation, then
  17 focused tests passed. Input Storybook matrix: **3/3 stories passed**.
  Initial min-height-only sizing measured 34px due to native input intrinsic
  sizing; explicit token-backed height plus a text-relative minimum fixes it
  while preserving enlargement. Shared typography keeps the existing mobile
  text-size utility at its current owner; no legacy allowance change.

- C1 committed as `90f21c551`; C2 large button alignment as `f85615a79`.
  C2 seven Storybook tests and existing button behavior tests passed. The
  button browser geometry proof is committed alongside the C3 field tests.
- C3: native `field-sizing: content` worked in canonical Chromium and WebKit,
  but Firefox did not support it (height stayed 68px with overflowing text).
  Chose a private row measurement hook with resize/reset/font cleanup.
  Textarea manual defaults to 3 rows; auto defaults to 3–10, controlled values
  grow/shrink and scroll after the cap. Readonly retains normal text contrast.
- C3 focused text tests, four Textarea stories, quick conformance, and all
  **6/6 canonical browser checks** passed (two checks in each engine: field/
  button geometry and Textarea growth/reset/320px containment). Logs:
  `/private/tmp/bakin-form-{text-tests,group-green,text-browser,quick}.log`.
  Generated CSS includes the current shared group selectors; it will be
  regenerated at the adjacent C4 checkpoint. No PNGs changed.

- C3 committed `1f216bd3d`. C4 group presentation and recipes: **5/5**
  Storybook tests, focused text/form/SearchInput tests, quick conformance and
  **3/3 canonical addon containment checks** passed (320px and 200% text).
  A new grouped-textarea association test exposed FieldControl forwarding an
  undefined native size through custom render; it now forwards that attribute
  only for the default input, and grouped children enforce their owner's size.
  Logs: `/private/tmp/bakin-form-{group-form,group-browser,selection-stories}.log`.
  C4 adds a dedicated group browser file to keep its rollback separate from C3.

- C4 committed `63ffa2508`. C5 Select: **5/5** stories, focused selection
  tests, quick conformance and **3/3 canonical browser checks** passed.
  Browser checks cover repeated native form values, controlled reset, summary,
  keyboard open/Escape/focus and 320px popup containment. Replaced an obsolete
  min-height class assertion with DOM prop checks plus real matrix geometry.
  No consumers used the removed `default` size outside the repaired public story.
  Logs: `/private/tmp/bakin-form-{select-unit,select-browser,selection-stories}.log`.

- C5 committed `1edf08289`. C6 adds the approved 16 Combobox values and 16
  Props types (public inventory now 316 values/423 types). Basic filtering,
  grouping, chip removal and matrix stories passed, along with 8 unit/portal
  tests and quick conformance. Added the second visual spec to the architecture
  harness's explicit filename contract; no ratchet allowances were changed.
- Canonical Dialog feasibility and group-padding regression: **9/9 passed**
  across all engines at 320px. Search/select/remove/Escape and final focus
  return work inside Dialog. Unit tests distinguish queries from submitted
  object IDs and preserve plugin ownership.
- Shared shell repair: `p-0` did not override token-specific px/py CSS utilities;
  inspected padding was `4px 8px`. Shells now request no size padding from the
  private recipe; children/addons own inset. Browser regression asserts zero
  shell padding and all nominal sizes. Log: `/private/tmp/bakin-form-combo-browser.log`.
- C6 payload check is **pending approval**, not passing: a matched in-memory
  production build attributes 47,109 bytes to Combobox. Six reviewed totals
  need the explicitly proposed adjustment in `tasks/form-components-payload-review.md`.
  Source/API checkpoint commits do not claim full conformance while this and
  exact PNG approvals remain outstanding.


## Completion checks in progress

- C6 committed `508bef215`. Payload review is now **approved and applied**:
  checkpoint `73a72a4c1` changes the six documented JavaScript totals only.
  Matched attribution is 47,109 bytes. Shared grouped-focus selectors reduce
  generated CSS from 196,968 to 191,561 bytes, below its original 192,625 ceiling.
  Vendors/plugins/host builds and the performance check passed.
- C7/C8 are combined because the compact and async recipes share the story and
  helper. Nine Combobox stories pass, including object identity, wrapping/compact
  selection, explicit unavailable recovery and readonly/disabled states. The
  replacement recovery check failed before its fix; replacement and clear now
  both remove the old invalid state. No public source state machine was added.
- Async stale-response and keyboard retry checks pass in Chromium, Firefox and
  WebKit. Controlled browser clocks establish response ordering without real
  timing races. Retry is outside the popup, reachable after Tab closes the list.
- Mixed native FormData uses repeated Select IDs and serialized Combobox object
  IDs. A genuine browser failure showed native reset does not restore upstream
  Combobox state; the recipe now explicitly controls/restores selection. Native
  Textarea remains uncontrolled. This behavior is documented, not shimmed.
- Full repository suite after sandbox correction: 9,660 passed, 18 skipped,
  one failure from an obsolete task-board CSS assertion. The corrected owner
  assertion and Combobox tests passed (11/11); clean full rerun in progress.
  Initial sandbox-only socket/temp failures are not counted as product defects.
  Full test runs use a temporary OPENCLAW_MOCK_HOME, never the live mock home.
- Docs check passed, including site build and 468 published public stories.
  Generated unrelated dates/catalog versions were restored; SDK additions kept.
  Public Storybook determinism check passed across consecutive builds.
- Plugin conformance passed, including focus teeth. Inspected the reference
  plugin HTML report: status passed, zero findings, desktop/mobile captures.
- Final canonical comparisons run with `--update-snapshots=none`; no PNG
  baseline has been created or replaced. Full visual/browser and final code
  review receipts will be appended after completion.


- C7+C8 committed `63d143732`, including a focused Combobox alignment repair:
  a Field sharing a grid row with an error could stretch its shell to 48px.
  The new ControlStates geometry assertion failed before adding self-start,
  then all nine states retain 36px while multi-chip shells still grow.
- Rich Select descriptions retain a separate primary label for selected display
  and typeahead. Checkpoint `c52e1b6b0` also repairs two inherited search tests
  to measure the actual shell, not its borderless inner input. No product code
  changed. The list-header geometry story passes with the original tolerance.
- Full repository rerun **PASS: 9,661 tests, 18 skipped, zero failures** across
  1,016 files. Log: `/private/tmp/bakin-form-repaired-all-tests.log`.
- Full Storybook run completed 354 checks: 348 passed; five retained trace
  files collided with an overlapping focused runner, and one list-header check
  still measured the inner input. Reran all affected files with only one runner:
  **45/45 passed** in ten files, including the final form/selection recipes.
  Logs: `/private/tmp/bakin-form-{all-stories,stories-repaired}.log`. Trace-only
  collisions required no production or test-runner changes.
- Quick conformance passed after the recipe additions. Generated CSS remains
  191,561 bytes after the alignment fix (self-start already existed).


- C9 committed `1f08814e2`. Final isolated canonical rerun **18/18 passed**:
  mixed submit/reset/IME, Drawer retry, field/button heights, bounded Textarea
  at 200% text, forced-color focus/error treatment, and inherited list/header
  geometry in all three engines. Log: `/private/tmp/bakin-form-final-browser.log`.
- Final 18 new visual candidates captured completely at desktop/320px. Their
  only comparison failures are the intentionally absent, unapproved PNGs.
  No story, overflow or pageerror assertions failed. Final capture source:
  `/private/tmp/bakin-form-final-storybook`; artifacts `test-results/form-final-visual`.
- Canonical contrast measurements are saved in `test-results/form-contrast.json`.
  Text/focus/errors pass their targets; the existing subtle resting border is
  1.90–2.10:1. A precise public-token proposal with untouched before/after
  preview artifacts is pending in `tasks/form-components-border-review.md`.
- Final production vendor/plugin/host builds, approved performance check and
  lint passed (lint has six pre-existing warnings). Unrelated asset manifest
  hash remains unchanged. No generated token, allowance or baseline changed.


## Review checkpoint before control-border approval

- Broad canonical browser sweep completed: **120/123 passed**; all three
  failures were the frozen old list-header inner-input assertion. Its repaired
  version passed in every engine in the final 18-check rerun. No suppression,
  tolerance increase or browser exception was added.
- Stronger capture validation now listens for Storybook console failures and
  waits for interaction completion. This exposed two mobile matrix mismatches
  (Input sm 36px; Combobox sm 34px). Shared input typography now explicitly
  retains tight line height after its mobile font-size class, preserving 16px
  text and 32/36/44px geometry without clipping.
- An added no-typing text-enlargement check failed in all three browsers:
  ResizeObserver previously compared only outer width. It now compares width,
  line-height, font-size, padding and borders, excluding its own height writes
  to avoid resize loops. Minimum rows recalculate immediately at 200% text.
- These repairs are checkpoint `d29fd2db5`. **24/24 final canonical browser
  checks passed** (sizes at desktop/320px, immediate 200% growth, forced colors,
  group addons, Select and Combobox/async behavior). Ten focused units and quick
  conformance passed; rebuilt vendors stay inside approved performance ceilings.
  Logs: `/private/tmp/bakin-form-{font-green,font-fix-unit,font-fix-quick,font-performance}.log`.
- Full visual comparison: **262 unchanged**, 18 inherited replacements and 18
  new files proposed. No baseline writes. The 18 final new candidates were
  recaptured after the typography/settling fixes; all interaction, console and
  overflow checks pass, with only missing-baseline comparison failures.
  Existing comparison captures predate those final typography repairs and must
  be refreshed with any approved border change before the final exact allowlist.
- Draft inventory: `tasks/form-components-visual-review.md`; stable copied
  artifacts and hashes: `test-results/form-components-review/manifest.json`.
  Checked desktop/mobile matrices, chips, group addons and representative
  Drawer/Select/settings/conversation inherited diffs. Textarea capture now
  waits for its play to finish; the screenshot shows its empty three-row end
  state, not an intermediate typing frame.
- Pending required decisions: the measured control-border token extension in
  `tasks/form-components-border-review.md`, followed by exact final PNG review.
  C12 baseline changes and C13 full aggregate verification have not been run.
  This is an implementation/review checkpoint, not a merge-ready handoff.


## Approved control-border implementation

The user explicitly approved the control-border proposal. Added internal
warm.400 (#716c6c), public semantic.color.border.control, and the field alias;
the shared outlined/filled recipe consumes it. The generated property is
`--bakin-color-border-control`, correcting the proposal's abbreviated name to
the repository's existing convention. No separator/focus/error color changed.
The public semantic inventory is now 66 tokens (139 total including internals).

The new token assertion failed before implementation, then **17/17 token tests
passed**. Generator contrast is 3.39:1 against elevated surface and uses the
existing non-text gate. **33/33 focused canonical browser checks passed** in
all three engines, including rendered contrast across the three parent surfaces,
geometry, enlargement, readonly/disabled/error, submission/reset/IME, async retry
and overlay selection. Actual values are saved in
`test-results/form-contrast-approved.json`: border 3.39–3.73:1, primary text
17.50–19.28:1, focus 8.46:1 and invalid border 4.65–5.12:1.

Quick conformance, docs check/validation, consecutive public build determinism,
plugin conformance, production builds and performance pass. CSS is 191,737
bytes, still below its original 192,625 ceiling; no extra payload adjustment.
The complete repository suite passed: **9,662 passed, 18 skipped, zero failed**
across 1,016 files. The complete Storybook suite passed: **354 tests in 114
files**, with five internal zero-test files skipped. The final visual sweep
completed with baseline writes disabled.
Exact new/changed PNG approval remains pending; captures use writes disabled.
Logs: `/private/tmp/bakin-form-approved-border-{quick,browser,contrast,docs,doc-validation,determinism,plugin,performance}.log`.


## Final canonical PNG review — awaiting exact approval

C11 review is complete against source checkpoint `3fa5b8648`. The final
canonical desktop/mobile sweep ran all **298 checks**: **232 unchanged**, **48
existing screenshot differences**, and **18 new missing baselines**. Every
failure is a screenshot comparison or missing baseline; there are no other
errors. No baseline PNG has been written or altered.

The exact 66 paths, actions, reasons and before/after/diff links are in
`tasks/form-components-visual-review.md`. Copied review artifacts and SHA-256
hashes are in `test-results/form-components-review/manifest.json`. Reviewed
mobile/desktop control matrices, wrapping chips, group addons/error messages,
Select typography, parent surfaces, settings/schema fields, pickers, search,
Drawer/Sheet, conversation and token specimens. Existing compositions inherit
the shared appearance; product-page migration remains deferred.

Final logs:
- `/private/tmp/bakin-form-approved-border-tests.log` — 9,662 passed; 18 skipped.
- `/private/tmp/bakin-form-approved-border-stories.log` — 354 passed; 114 files.
- `/private/tmp/bakin-form-approved-border-browser.log` — 33 passed, three engines.
- `/private/tmp/bakin-form-approved-border-visual.log` — 232 unchanged + 66 reviewed.
- `/private/tmp/bakin-form-approved-border-lint.log` — no errors; six existing warnings.

Quick conformance, token tests, docs check/validation, deterministic public
Storybook builds, plugin conformance, production builds and performance are
also green. Full aggregate conformance is deferred until exact PNG approval,
since its standard visual runner can create missing snapshots. C12 and C13
remain pending; this is not a merge-ready claim. The unrelated embedded asset
manifest diff remains unchanged (SHA-256
`f761346b71c4693015c1c94aca52cb90c9a8580048cd3763c1c5525d5f3958ee`).
