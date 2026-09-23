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
