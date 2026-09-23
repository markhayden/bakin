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
