# Implementation Plan: Bakin Browser UI Design System and Full-Surface Revamp

**Specification:** `./SPEC.md`\
**Execution checklist:** `../../../tasks/todo-ui-design-system.md`\
**Status:** Approved for incremental implementation\
**Planning date:** 2026-07-16
**Approved:** 2026-07-16

## Overview

Build the design-system foundation first, prove it against coded Bakin
specimens, then migrate every browser surface in small route- and
archetype-sized pull requests. Core and `bakin-bits-official` are one official
consumer fleet. Every migration includes its supported SDK usage, story or
fixture, behavior/accessibility checks, canonical desktop/mobile evidence,
census update, and deletion of the replaced styling.

This plan intentionally does not estimate calendar time. The census and
measured CI timings will provide a reliable throughput baseline after Phase 0;
inventing dates before that would obscure rather than manage risk.

## Architecture Decisions Carried From the Specification

- Private `packages/ui` owns implementation; `@makinbakin/sdk/*` remains the
  only public plugin UI contract.
- DTCG JSON is the token source; generated `--bakin-*` CSS, internal Tailwind
  mappings, TypeScript metadata, Storybook specimens, and docs cannot drift.
- Storybook is the authoritative executable catalog. The deployed catalog is
  public-SDK-only and is self-hosted with the existing docs on Cloudflare.
- Playwright owns repository baselines and browser checks. Canonical images
  are Linux/Chromium; Chromium, Firefox, and WebKit share behavior coverage.
- Official plugins dogfood the public SDK. Core repository location does not
  grant private UI access; Bits is equally first-party.
- The shipped routing overhaul remains authoritative. This initiative uses
  `PluginLink`, SDK router hooks, path/query taxonomy, history, and scroll
  restoration without creating a new navigation system.
- Existing behavior and URL contracts remain stable during visual migration.
  Larger workflow changes become separate specs.
- Browser payload budgets integrate with `size:report` and issue #423; the
  completed SDK deduplication result from issue #422 is a no-regression floor.
- Incremental migration lands on `main`; legacy usage is ratcheted down and
  can never increase.

## Dependency Graph

```text
Spec approval
  │
  ├─ Phase 0: census + measured baseline + legacy ratchets
  │      │
  │      ├─ Phase 1: Storybook + deterministic Playwright/a11y harness
  │      │      │
  │      │      └─ Phase 2: DTCG tokens + coded specimens
  │      │                 │
  │      │                 └─ USER visual-direction approval
  │      │                            │
  │      └────────────────────────────┤
  │                                   ▼
  │                      Phase 3: packages/ui + focused SDK contracts
  │                                   │
  │                      Phase 4: plugin scope + conformance harness
  │                                   │
  │                      Phase 5: host shell/shared surfaces
  │                                   │
  │                      Phase 6: archetype migrations
  │                         ├─ core route/slot slices
  │                         └─ paired Bits route slices
  │                                   │
  └───────────────────────────────────▼
                         Phase 7: deletion + full audit + stable SDK
```

Phases 0–4 are sequential where they establish shared contracts. After the
first archetype recipe passes its checkpoint, independent migration slices may
proceed in parallel branches, but any shared component/API change returns to a
single contract PR before consumers continue.

## Task Contract

Every task below is one focused implementation session and normally one green
conventional commit. A task is complete only when its acceptance and
verification clauses pass. “Files” names the expected ownership area, not
permission to touch unrelated files. If discovery makes a task larger than
five coherent implementation files plus colocated tests/stories/generated
artifacts, split it before coding and update this plan.

### Required pre-splits

The following numbered headings are workstream descriptions, not executable
tasks. Only their child IDs may be assigned or checked off. Each child inherits
the parent dependencies and verification commands, and applies the parent's
acceptance criteria to its named scope. Each child must independently leave the
repository green and remove only its own legacy allowances.

| Workstream | Executable child tasks |
|---|---|
| T10 CI/deploy | T10a UI CI gates/artifacts; T10b combined docs/catalog deployment |
| T20 SDK packaging | T20a focused UI entrypoints; T20b stylesheet/package artifact |
| T27 layout | T27a PageShell/Stack/Inline; T27b Grid/Section/BoundedOverflow |
| T30 archetypes | T30a list/detail; T30b settings/dashboard; T30c conversation/inspector; T30d workflow/action |
| T32 shared display | T32a filters/segmented/tabs/sort; T32b status/metrics |
| T33 charts | T33a data table/palette/sparkline; T33b line/bar/stacked charts |
| T34 conversation | T34a model/folding/time; T34b messages/activity/tool rendering; T34c composer/attachments; T34d panel/stream/drawer |
| T35 app patterns | T35a markdown/search; T35b agent identity/filter/select/status; T35c asset/model/color pickers; T35d settings/turn output |
| T42 exemplars | T42a Bakin reference plugin; T42b Bits official template |
| T43 official CI | T43a core conformance CI; T43b Bits conformance CI |
| T44 shell | T44a canvas/header; T44b sidebar/navigation |
| T45 globals | T45a global search; T45b toasts/global overlays |
| T46 host routes | T46a Settings; T46b Runtime |
| T48 Tasks index | T48a page shell/filters/views; T48b metrics/log table |
| T49 Tasks detail | T49a cards/columns; T49b detail shell/modes; T49c notes/run/output/workflow panels |
| T50 Assets index | T50a index/filters/views; T50b folders/import |
| T51 Assets detail | T51a detail/media/versions; T51b edit/enrichment/slots |
| T52 Brands base | T52a list/create; T52b detail overview |
| T53 Brands authoring | T53a builder/docs; T53b brainstorm/task slot |
| T55 Schedule views | T55a shell/list; T55b calendars/events |
| T56 Schedule jobs | T56a drawer/history; T56b form/controls |
| T57 Team management | T57a index/teams; T57b forms/packages/adoption |
| T58 Agent detail | T58a overview/context/heartbeat; T58b diagnostics/lessons/editor |
| T59 Memory | T59a search/overview; T59b detail/cleanup |
| T60 Models | T60a shell/agents/available; T60b aliases/routing/spend |
| T61 Health primary | T61a overview shell/pulse/alerts; T61b overview operations/spend/context/interactions; T61c activity metrics/charts; T61d activity rows/failures/trends |
| T62 Health secondary | T62a agents; T62b system inventory/search; T62c watch/repair/badge/intros |
| T65 Workflow pages | T65a list/create; T65b detail/drawers/actions |
| T66 Workflow canvas | T66a canvas shell; T66b palette/base node shell; T66c action nodes; T66d orchestration nodes; T66e configuration/parallel editing |
| T67 Bits Messaging base | T67a navigation/plan list; T67b calendar/status/badge |
| T68 Bits Messaging authoring | T68a workspace/deliverables; T68b brainstorm/quick post |
| T75 deletion | T75a public barrel; T75b token aliases/CSS; T75c duplicate components/helpers; T75d migration-only tooling |
| T76 documentation | T76a author guide; T76b generated reference; T76c internal knowledge/migration notes |

T71 is census-driven by definition. Its audit portion is executable as T71a;
any uncovered production contribution becomes a named owner-specific child
(`T71b-<plugin>`, and so on) added to this plan and checklist before editing.
T72 follows the same rule for genuinely unknown census stragglers. Audit or
manual-review tasks T73–T74 remain bounded evidence sessions; any production
fix they discover receives a new child task before implementation.

---

## Phase 0 — Inventory, Evidence, and No-New-Debt Gates

### T1 — Capture the reproducible pre-revamp baseline

**Description:** Record current core/Bits routes and representative screenshots,
raw styling violations, production browser asset sizes, and repeatable route
timings before changing the system.

**Acceptance:**

- A versioned baseline records commands, refs, environment, counts, and output
  locations; it contains no user data or machine-specific absolute paths.
- `size:report` captures host, vendor, SDK, plugin client, and CSS measurements
  that can be compared by later PRs.
- Representative desktop/mobile captures exist for every current page
  archetype, including at least one Bits page.

**Verification:** rerun the capture twice in a clean checkout; counts and
stabilized captures agree. Existing `bun run size:report`, builds, and tests
remain green.

**Dependencies:** approved spec.\
**Likely files:** `design-system/baseline/`, `scripts/ui/baseline.ts`,
`package.json`.\
**Size:** M.\
**Commit:** `chore(ui): capture pre-revamp browser baseline`

### T2 — Define and generate the core UI census

**Description:** Add the census schema and scanner for host routes, core plugin
page/slot registrations, shared components, and public SDK UI exports.

**Acceptance:**

- Generated entries have stable IDs, owner, route/slot identity, source path,
  export status, and evidence of discovery.
- The current 26 host route files and all core plugin page/slot contributions
  are either represented or explicitly classified as non-visual aliases.
- A seeded unregistered route/component causes the completeness test to fail.

**Verification:** `bun run ui:census:check`; focused scanner tests; full existing
test suite.

**Dependencies:** T1.\
**Likely files:** `design-system/census.schema.json`,
`scripts/ui/census.ts`, `tests/ui/architecture/census.test.ts`,
`design-system/census.json`.\
**Size:** M.\
**Commit:** `feat(ui): machine-readable core surface census`

### T3 — Include Bits and create the compatibility matrix

**Description:** Extend census discovery through the existing sibling-clone
pattern for Messaging, Projects, and the official plugin template. Record exact
Bakin/Bits refs and SDK versions used by conformance runs.

**Discovered prerequisite:** the pre-revamp capture found that Messaging still
declares the removed `contributes.nav[].alwaysExpanded` field and is rejected by
current Bakin. Remove that field in the Bits compatibility slice before using
Messaging as conformance evidence; Projects remains the valid T1 Bits specimen.

**Acceptance:**

- Messaging's four custom routes, Projects' four custom routes, badge slots,
  and the official template appear in the generated inventory.
- Missing/unavailable Bits input fails official/release verification clearly;
  local core-only development can opt into an explicitly labeled partial mode.
- The compatibility matrix is machine-readable and never implies that only
  core plugins are first-party.

**Verification:** local sibling run plus CI-style temporary clone; seeded
missing Bits route fails; `bun run docs:check` still uses the same source root.

**Dependencies:** T2.\
**Likely files:** `scripts/ui/census.ts`, `design-system/compatibility.json`,
`tests/ui/architecture/bits-census.test.ts`, CI source-clone setup.\
**Size:** M.\
**Commit:** `feat(ui): official Bits census and SDK compatibility matrix`

### Checkpoint 0A — Census truth

- [x] Core and Bits counts are reviewed against manifests and registrations.
- [x] Seeded unknown core and Bits surfaces make the gate fail.
- [x] Baseline artifacts contain no private/runtime data.

### T4 — Build the legacy-style ratchet

**Description:** Turn the preliminary raw-palette, arbitrary-size, raw-control,
inline-style, generic-token, unscoped-CSS, and private-import audit into a
path-pinned machine-readable allowance file.

**Acceptance:**

- Existing debt is counted by rule and path; new debt or increased counts fail
  CI while untouched debt remains temporarily allowed.
- Each allowance names its census surface and intended migration phase.
- Teeth tests prove every rule fails on a seeded offender and accepts a
  supported SDK/token example.

**Verification:** `bun run ui:census:check`; architecture tests; lint; run the
scanner against both repositories.

**Dependencies:** T2–T3.\
**Likely files:** `design-system/migrations.json`,
`scripts/ui/check-legacy-styles.ts`, `tests/ui/architecture/style-ratchet.test.ts`,
`eslint.config.mjs`.\
**Size:** M.\
**Commit:** `test(ui): ratchet legacy styling across core and Bits`

### T5 — Establish initial performance and dependency budgets

**Description:** Extend `size:report` with UI-specific measurements and add
entrypoint dependency assertions before Storybook or new UI packages land.

**Acceptance:**

- Report design-system CSS copies/bytes, initial host JS, each focused/current
  SDK UI bundle, vendor chunks, and every official plugin client.
- Current values are recorded as baseline rather than immediately failing old
  debt; any new regression fails.
- A seeded base-UI import of charts/conversation and a duplicated stylesheet
  both fail architecture checks.

**Verification:** `bun run size:report`; `bun run ui:performance`; production
build; compare two clean runs for stable measurements.

**Dependencies:** T1, T4.\
**Likely files:** `scripts/report-sizes.ts`, `scripts/ui/performance.ts`,
`tests/ui/architecture/ui-dependencies.test.ts`, budget JSON.\
**Size:** M.\
**Commit:** `perf(ui): baseline and ratchet browser UI payloads`

### Checkpoint 0B — Foundation audit

- [ ] Baseline, census, legacy allowances, and budgets are reproducible.
- [ ] No production behavior or styling changed.
- [ ] User reviews the generated migration dashboard before toolchain work.

---

## Phase 1 — Executable Catalog and Browser Verification

### T6 — Scaffold the React/Vite Storybook workbench

**Description:** Add the current supported stable Storybook React/Vite setup as
development-only tooling with local maintainer and static build commands.

**Acceptance:**

- A minimal story imports a real SDK component and the exact SDK stylesheet.
- Storybook dependencies are absent from production host/vendor/plugin output.
- `bun run ui:dev` and `bun run ui:build` work without changing the Bun host
  build strategy.

**Verification:** local build/serve smoke; production bundle dependency test;
typecheck and full build.

**Dependencies:** T5.\
**Likely files:** `.storybook/main.ts`, `.storybook/preview.tsx`, `package.json`,
`storybook/internal/foundation.stories.tsx`.\
**Size:** M.\
**Commit:** `feat(ui): Storybook workbench foundation`

### T7 — Split public/internal audiences and deterministic fixtures

**Description:** Define explicit story roots/tags and fixture decorators for
time, IDs, network, routing, fonts, viewport, theme, and reduced motion.

**Acceptance:**

- Public build fails if a story imports host internals or `packages/ui`.
- Internal/migration stories never appear in `ui:build:public`.
- Two consecutive builds produce equivalent story indices and fixture output.

**Verification:** public-build architecture tests; fixture unit tests; compare
story indices from two runs.

**Dependencies:** T6.\
**Likely files:** `.storybook/`, `storybook/fixtures/`,
`scripts/ui/build-storybook.ts`, audience tests.\
**Size:** M.\
**Commit:** `feat(ui): public SDK catalog boundary and deterministic fixtures`

### T8 — Add canonical Playwright visual infrastructure

**Description:** Configure pinned Linux Chromium screenshots, canonical
viewports, failure artifacts, and a safe update command.

**Acceptance:**

- `1440x900` and `320x800` sample baselines pass in the matching Playwright
  image and fail on a seeded visual change.
- CI never updates baselines and uploads HTML, trace, expected, actual, and diff
  artifacts on failure.
- The update command refuses to bless snapshots outside the canonical
  environment.

**Verification:** teeth test, intentional diff run, canonical update run, and
artifact inspection.

**Dependencies:** T6–T7.\
**Likely files:** `playwright.ui.config.ts`, `tests/ui/visual/`,
`scripts/ui/update-snapshots.ts`, package scripts.\
**Size:** M.\
**Commit:** `test(ui): canonical Playwright visual baseline harness`

### Checkpoint 1A — Visual harness with teeth

- [ ] Public/internal catalog separation is proven.
- [ ] A visual regression creates an actionable report and blocks CI.
- [ ] Canonical baseline updates cannot happen accidentally on macOS.

### T9 — Add story accessibility and cross-browser behavior projects

**Description:** Configure axe failures, story interaction execution, and
Chromium/Firefox/WebKit keyboard/focus/responsive smoke projects.

**Acceptance:**

- Accessibility violations fail stable stories by default; suppressions
  require reason/evidence metadata.
- Seeded focus-loss, keyboard, overflow, console-error, and axe failures are
  caught by the appropriate project.
- Firefox/WebKit do not create duplicate pixel baselines.

**Verification:** run each seeded teeth case, then `ui:test:stories` and
`ui:test:browsers` green.

**Dependencies:** T8.\
**Likely files:** `.storybook/preview.tsx`, Playwright projects,
`tests/ui/stories/`, `tests/ui/browser/`.\
**Size:** M.\
**Commit:** `test(ui): accessibility and cross-browser story gates`

### Workstream T10 — Integrate UI checks and self-hosted catalog deployment

**Description:** Add path-aware PR checks, full main/release runs, artifacts,
and the public Storybook output under the existing docs Cloudflare artifact.

**Acceptance:**

- UI-affecting changes run the complete affected suite; uncertain dependency
  impact expands to full rather than skipping.
- `docs:check` validates the public catalog, and docs deployment publishes it
  from the same requested release ref without exposing internal stories.
- Existing docs URLs and the routing work's docs checks remain unchanged.

**Verification:** local combined docs build; CI workflow validation; inspect
the static `/docs/ui/` artifact and link traversal.

**Dependencies:** T7–T9.\
**Likely files:** `.github/workflows/ci-{pr,main}.yml`,
`.github/workflows/docs-deploy.yml`, root/docs scripts, docs navigation page.\
**Size:** M.\
**Commit:** `ci(ui): gate and self-host the public Storybook catalog`

### Checkpoint 1B — Workbench foundation

- [ ] Storybook, visual, a11y, and three-browser suites are green.
- [ ] Public catalog is present in a local combined docs artifact.
- [ ] Production bundles contain no Storybook/Vite/test dependencies.

---

## Phase 2 — Tokens and Approved Visual Direction

### T11 — Implement DTCG token validation and generation core

**Description:** Add the narrow in-repo DTCG 2025.10-compatible parser,
reference resolver, schema rules, deterministic ordering, and stale-output
check.

**Acceptance:**

- Invalid references, cycles, wrong types, public raw-token exposure, and
  nondeterministic output fail with source locations.
- Reference, semantic, and internal component layers are mechanically distinct.
- Generator tests include valid and invalid fixtures and a repeatability test.

**Verification:** focused `bun:test`; `bun run ui:tokens:check` twice with no
diff.

**Dependencies:** T10.\
**Likely files:** `packages/ui/tokens/*.json`,
`scripts/ui/generate-tokens.ts`, token tests/fixtures.\
**Size:** M.\
**Commit:** `feat(ui): DTCG token source and deterministic generator`

### T12 — Emit CSS, Tailwind mappings, and TypeScript token metadata

**Description:** Generate namespaced runtime properties, internal Tailwind
theme mappings, typed semantic metadata, and the initial published stylesheet
artifact from the same source.

**Acceptance:**

- No generated public generic aliases (`--background`, `--accent`, etc.) exist.
- CSS, Tailwind, and TypeScript values agree in automated tests.
- The host and Storybook can load the artifact without duplicating it.

**Verification:** token check, CSS build, TypeScript compile, duplicate-style
architecture test.

**Dependencies:** T11.\
**Likely files:** token generator, `packages/ui/src/styles/`, SDK package export,
`packages/host/src/globals.css`.\
**Size:** M.\
**Commit:** `feat(ui): generated semantic token artifacts`

### T13 — Generate token specimens and public reference docs

**Description:** Render semantic token families and structural scales in
Storybook and generated docs with names, intent, values, contrast data, and
public/private status.

**Acceptance:**

- Every public token appears once in the catalog and generated SDK reference;
  internal reference/component tokens do not appear as author contracts.
- Contrast specimens fail the approved WCAG thresholds.
- Generated docs are source-linked and cannot drift from JSON.

**Verification:** public Storybook build, docs check, token coverage test, axe.

**Dependencies:** T12.\
**Likely files:** generated token stories/docs, docs generator, token coverage
tests.\
**Size:** M.\
**Commit:** `docs(ui): generated semantic token catalog`

### Checkpoint 2A — Token pipeline

- [ ] One edit to source JSON updates every derived surface deterministically.
- [ ] Seeded token errors and contrast failures block CI.
- [ ] No old generic token is yet deleted until consumers are migrated.

### T14 — Build and compare bundled typography specimens

**Description:** Bundle candidate UI sans/mono fonts locally and compare
compact hierarchy, tables, IDs, code, numerals, long labels, and 200% zoom.

**Acceptance:**

- No remote font request occurs; candidates include license/provenance notes.
- Specimens cover desktop, 320px, 200% text, and missing/slow font fallback.
- The selected pair is recorded only after user review, then added to tokens.

**Verification:** network assertion, screenshot/axe/overflow checks, manual
legibility review.

**Dependencies:** T13.\
**Likely files:** `storybook/internal/specimens/typography.stories.tsx`, font
assets/metadata, typography tokens.\
**Size:** M.\
**Commit:** `feat(ui): bundled typography direction specimens`

### T15 — Build dense list/data direction alternatives

**Description:** Create coded alternatives using realistic Tasks/Assets/Health
content to test compact rhythm, filters, tables/cards, status, overflow, and
empty/error/loading behavior.

**Acceptance:** alternatives use only candidate tokens and proposed public
composition APIs; desktop/320/200% evidence is complete; content-first
hierarchy avoids nested-card stacks.

**Verification:** story interaction/a11y/visual checks and manual comparison.

**Dependencies:** T13–T14.\
**Likely files:** `storybook/internal/specimens/dense-list.stories.tsx`, fixtures,
specimen notes.\
**Size:** M.\
**Commit:** `feat(ui): dense list and data design specimens`

### T16 — Build detail/form direction alternatives

**Description:** Exercise forms, descriptions, validation, save/discard,
destructive actions, detail sections, overlays, and narrow reflow with realistic
Brand/Team/Project content.

**Acceptance:** all required form/system states and keyboard/focus workflows are
shown; no hand-styled raw control is needed; primary actions remain available
at 320px.

**Verification:** story play tests, axe, focus order, screenshots, 200% zoom.

**Dependencies:** T13–T14.\
**Likely files:** `storybook/internal/specimens/detail-form.stories.tsx`, fixtures,
specimen notes.\
**Size:** M.\
**Commit:** `feat(ui): detail and form design specimens`

### T17 — Build conversation/workflow direction alternatives

**Description:** Exercise streamed messages, tool activity, composer, drawers,
workflow nodes/canvas, selection, live status, and bounded two-dimensional
overflow.

**Acceptance:** keyboard/non-drag alternatives and reduced motion are explicit;
domain colors remain distinct from chrome; dense mobile operation remains
functional rather than merely shrinking desktop.

**Verification:** interaction/a11y/visual checks; reduced-motion inspection;
manual keyboard workflow.

**Dependencies:** T13–T14.\
**Likely files:** `storybook/internal/specimens/conversation-workflow.stories.tsx`,
fixtures, specimen notes.\
**Size:** M.\
**Commit:** `feat(ui): conversation and workflow design specimens`

### T18 — Approve and codify the visual direction

**Decision (2026-07-18):** Product Character is the approved default with
Space Grotesk + JetBrains Mono. Operational Neutral is rejected as a global
direction; its tighter gap and row height inform only the single contextual
compact-professional recipe for tables, repeated rows, and operational data.

**Description:** Compare T14–T17 evidence, choose one coherent direction,
finalize initial token/font values and composition rules, and record rejected
alternatives and reasons.

**Acceptance:** user approval is recorded; chosen values regenerate cleanly;
preliminary contradictory knowledge docs are marked superseded or updated;
no unresolved aesthetic fork remains before component work.

**Verification:** `ui:tokens:check`, public/internal Storybook builds, spec and
knowledge cross-link audit.

**Dependencies:** T14–T17 and user review.\
**Likely files:** token JSON, `SPEC.md`, design rationale/knowledge docs,
specimen story status.\
**Size:** S.\
**Commit:** `docs(ui): approve the browser design direction`

### 🔶 USER CHECKPOINT — Visual direction

- [x] Review all four specimen families at desktop and 320px.
- [x] Approve fonts, semantic color roles/values, spacing rhythm, radii,
  elevation, hierarchy, and interaction tone.
- [x] Production component styling does not begin before this approval.

---

## Phase 3 — Private UI Package and Focused Public SDK

### T19 — Establish the private `packages/ui` boundary

**Description:** Create the private package, dependency rules, aliases, and
host/SDK-only import allowlist without moving components yet.

**Status (2026-07-18):** Complete. `@bakin/ui` is a private, source-only
workspace with explicit exports, React peers, CSS-only side effects, and
repository/editor/plugin gates that reserve direct imports for UI, host, SDK,
and internal Storybook owners. Host and SDK boundary probes resolve to one
CSS-free implementation in the browser bundle; no production component has
been migrated yet.

**Acceptance:** external/plugin imports fail architecture checks; package is
side-effect controlled; host and SDK can consume a sample implementation
without duplicate React or CSS.

**Verification:** typecheck/build, import teeth tests, bundle identity test.

**Dependencies:** T18.\
**Likely files:** `packages/ui/package.json`, package tsconfig/index, root
workspace/tsconfig, architecture test.\
**Size:** M.\
**Commit:** `refactor(ui): establish private implementation package`

### Workstream T20 — Establish focused SDK UI entrypoints and stylesheet export

**Description:** Add `ui`, `layout`, `patterns`, `charts`, `conversation`, and
stylesheet export boundaries while retaining the legacy components barrel only
under its migration allowance.

**T20a status (2026-07-18):** Complete. The five focused browser UI paths now
resolve consistently through source aliases, npm exports and declarations,
host vendor/import-map artifacts, and the existing Whiskit build contract.
`layout`, `patterns`, `charts`, and `conversation` are intentionally empty until
their owning migration tasks; `components` remains a separate migration-only
barrel. Public Storybook rejects that legacy barrel, a built-package consumer
fixture compiles against every focused path, and dependency/size gates prove
the new domain entries add no runtime bytes or cross-domain reachability. No
component, page, plugin, or route migration is included in this slice.

**T20b status (2026-07-18):** Complete. `@makinbakin/sdk/styles.css` is the
explicit side-effectful public artifact used by the host, npm package, and
public Storybook. The SDK publisher recompiles CSS and refuses release unless
its bytes match the checked-in canonical artifact; a dry-run package produced
the same SHA-256. Storybook imports through the public package specifier, while
the host continues to embed and serve that same file once at `/globals.css`.
Browser verification proved the namespaced tokens and a real SDK component are
styled with no console errors. Author docs and the mirrored reference-plugin
guidance distinguish host-loaded plugin clients from standalone preview/test
harness imports. No component, page, plugin, or route migration is included.

**Acceptance:** export maps and package build publish the expected artifacts;
each entrypoint has an independent dependency graph; public stories can import
only these paths.

**Verification:** package self-containment tests, TypeScript consumer fixture,
production size report.

**Dependencies:** T19.\
**Likely files:** `packages/sdk/package.json`, focused index files, SDK package
build/tests.\
**Size:** M.\
**Commit:** `feat(sdk)!: focused browser UI entrypoint foundation`
**T20b commit:** `feat(sdk)!: freeze canonical stylesheet artifact`

### T21 — Migrate action and status primitives

**Description:** Move/restyle Button, Badge, Alert, and Progress behind the
private implementation and public UI entrypoint with semantic variants.

**Acceptance:** canonical size/tone/state stories, keyboard/focus/a11y coverage,
and current consumer compatibility within the approved breaking baseline.

**Verification:** component tests, public stories, visual/a11y, size report.

**Dependencies:** T20.\
**Likely files:** `packages/ui/src/primitives/{button,badge,alert,progress}.tsx`,
public stories/exports/tests.\
**Size:** M.\
**Commit:** `feat(ui): action and status primitives`

### T22 — Migrate surface and content primitives

**Description:** Move/restyle Avatar, Card, Separator, Skeleton, and Collapsible;
document that Card is bounded-object-only rather than the page-layout default.

**Acceptance:** content stress and loading stories exist; composition guidance
rejects nested-card examples; avatar fallbacks and collapsible semantics pass.

**Verification:** component/story/a11y/visual tests and card anti-pattern docs.

**Dependencies:** T20.\
**Likely files:** relevant `packages/ui/src/primitives/` files, stories/tests.
**Size:** M.\
**Commit:** `feat(ui): surface and content primitives`

### Checkpoint 3A — Package boundary and first primitives

- [ ] Host, SDK consumer fixture, and public Storybook use one implementation.
- [ ] No plugin can import the private package.
- [ ] Payload report proves base entrypoints do not pull heavy domains.

### T23 — Migrate text-field primitives

**Description:** Move/restyle Label, Input, Textarea, and InputGroup and expose
the low-level semantics needed by the field contract.

**Acceptance:** disabled, read-only, invalid, required, autofill, long value,
and mobile keyboard/input modes are covered; raw input remains available only
as the documented exception path.

**Verification:** component tests, form stories, axe, keyboard/focus, mobile
visual checks.

**Dependencies:** T21–T22.\
**Likely files:** field primitive files, stories/tests.\
**Size:** M.\
**Commit:** `feat(ui): text field primitives`

### T24 — Migrate selection primitives

**Description:** Move/restyle Checkbox, Switch, Select, and shared option/list
presentation.

**Acceptance:** selected/mixed/disabled/error/open states and full keyboard
operation pass; touch targets meet the 24 CSS-pixel contract.

**Verification:** interaction tests, axe, cross-browser open/selection checks,
visuals.

**Dependencies:** T21–T23.\
**Likely files:** selection primitive files, stories/tests.\
**Size:** M.\
**Commit:** `feat(ui): selection primitives`

### T25 — Migrate modal and side-overlay primitives

**Description:** Move/restyle Dialog and Sheet, reconcile BakinDrawer behavior,
and centralize focus trap, labelling, close, busy, and portal treatment.

**Acceptance:** nested/open/escape/outside-click/return-focus/scroll-lock states
pass; mobile full-height behavior and reduced motion are intentional.

**Verification:** Playwright keyboard/focus tests across three browsers,
Storybook visuals, existing drawer/dialog tests.

**Dependencies:** T21–T24.\
**Likely files:** dialog/sheet private primitives, `bakin-drawer` replacement,
stories/tests.\
**Size:** M.\
**Commit:** `feat(ui): modal and side-overlay primitives`

### T26 — Migrate anchored overlays and command primitives

**Description:** Move/restyle Popover, DropdownMenu, Tooltip, and Command with
one layering, collision, focus, shortcut-hint, and portal contract.

**Acceptance:** keyboard navigation, escape/return focus, viewport collision,
long content, nested menu, and labelled icon-only control cases pass.

**Verification:** cross-browser interaction tests, axe, visuals, portal
containment preflight.

**Dependencies:** T25.\
**Likely files:** anchored overlay/command primitives, stories/tests.\
**Size:** M.\
**Commit:** `feat(ui): anchored overlay and command primitives`

### Checkpoint 3B — Form and overlay primitive set

- [ ] Standard controls no longer require custom plugin markup.
- [ ] Keyboard/focus/open-layer tests pass in all three engines.
- [ ] Portal strategy is ready for plugin-containment enforcement.

### Workstream T27 — Build the minimal public layout vocabulary

**Description:** Implement PageShell, Stack, Inline, responsive Grid, Section,
and BoundedOverflow from census evidence.

**Acceptance:** typed semantic props cover common official layouts without raw
Tailwind; container behavior passes 1024/720/480/320; no generic layout DSL or
arbitrary value prop is exposed.

**Verification:** public stories, API type tests, representative composition
fixtures, overflow checks.

**Dependencies:** T21–T26.\
**Likely files:** `packages/ui/src/layout/`, SDK layout exports, stories/tests.
**Size:** M, split by Stack/Inline and Grid/Section if file limit is exceeded.\
**Commit:** `feat(sdk): minimal responsive layout vocabulary`

### T28 — Implement the canonical field/form composition

**Description:** Replace the current loose form helpers with Field, Fieldset,
FormActions, description/error association, and submit/busy composition using
the migrated primitives.

**Acceptance:** labels/descriptions/errors are mechanically associated; required,
optional, disabled, read-only, async validation, submission error, and success
examples pass; React Hook Form adapters do not own presentation.

**Verification:** story interactions, Testing Library association assertions,
axe, mobile form workflow.

**Dependencies:** T23–T24, T27.\
**Likely files:** private/public form components, adapter, stories/tests.\
**Size:** M.\
**Commit:** `feat(sdk): canonical accessible form composition`

### T29 — Implement standardized system states and feedback

**Description:** Build initial-empty, no-results, loading/skeleton, inline/full
error, permission-denied, banner, and toast guidance/components.

**Acceptance:** every state has semantic/live-region behavior, recovery action
rules, content defaults, responsive stories, and clear selection guidance.

**Verification:** story/axe/live-region tests, reduced-motion checks, visual
state matrix.

**Dependencies:** T21–T22, T27.\
**Likely files:** private/public state components, toaster integration,
stories/tests/docs.\
**Size:** M.\
**Commit:** `feat(sdk): system state and feedback patterns`

### Workstream T30 — Implement page-archetype recipes

**Description:** Codify list/index, detail, settings/form, dashboard/overview,
conversation, inspector, and workflow/action recipes from the approved
specimens and census.

**Acceptance:** each recipe defines header/actions, state slots, responsive
behavior, scroll ownership, URL-state guidance, and misuse boundaries without
hard-coding plugin data.

**Verification:** public archetype stories at all required widths; routing
contract assertions; docs examples compile through SDK.

**Dependencies:** T27–T29.\
**Likely files:** `packages/ui/src/patterns/`, SDK pattern exports,
public stories/docs/tests.\
**Size:** M per recipe family; split before implementation if more than two
archetypes share a task.\
**Commit:** `feat(sdk): canonical browser page archetypes`

### Checkpoint 3C — Layout, forms, states, archetypes

- [ ] Reference compositions use no arbitrary host Tailwind classes.
- [ ] Every archetype works at desktop and 320px with all system states.
- [ ] User reviews the public API names/props before official migrations.

### T31 — Migrate destructive, dirty, and confirmation patterns

**Description:** Rebuild ConfirmDialog, SaveBar/unsaved guards, and DangerZone
on the canonical primitives while preserving the shipped router behavior.

**Acceptance:** typed confirmation, busy/error/retry, browser/router navigation
guards, and mobile action placement pass; no hard navigation is introduced.

**Verification:** existing behavior tests, router/deep-link tests, Storybook
interactions, three-browser focus checks.

**Dependencies:** T25, T28–T30.\
**Likely files:** confirm/save/danger patterns and tests/stories.\
**Size:** M.\
**Commit:** `refactor(sdk): canonical destructive and dirty-state patterns`

### Workstream T32 — Migrate filters, segmented navigation, status, and metrics patterns

**Description:** Rebuild FacetFilter, AgentFilter, SegmentedControl,
UnderlineTabs, SortableHead, StatusBadge, and StatTile as coherent families.

**Acceptance:** URL-state examples use existing hooks; keyboard semantics,
counts, clearing, long labels, status non-color meaning, and dense metric
layouts pass.

**Verification:** behavior/story/a11y/visual tests; existing routing tests;
public API type checks.

**Dependencies:** T24, T26–T30.\
**Likely files:** pattern-family files, exports, stories/tests.\
**Size:** M per navigation and display family; split into two tasks at build
time if the file limit is exceeded.\
**Commit:** `refactor(sdk): canonical filter navigation and metric patterns`

### Workstream T33 — Isolate and migrate the chart entrypoint

**Description:** Move chart components/palette into the focused charts contract,
apply approved typography/tokens, and preserve exact accessible tables and
keyboard-equivalent marks.

**Acceptance:** importing base UI does not include charts; every chart has
empty/overflow/multi-series/CVD/non-color stories and an exact table path.

**Verification:** chart tests, visual/a11y/keyboard coverage, bundle graph.

**Dependencies:** T20–T22, T27, T29.\
**Likely files:** chart components, SDK charts index, stories/tests.\
**Size:** M, split visual chart types from table/palette if needed.\
**Commit:** `refactor(sdk): focused accessible chart kit`

### Workstream T34 — Isolate and migrate the conversation entrypoint

**Description:** Move folding/rendering/composer/tool-drawer/panel presentation
behind the focused conversation contract and approved interaction language.

**Acceptance:** base UI does not include conversation code; streamed, thinking,
tool, error, attachment, empty, long-content, and reduced-motion states pass;
behavior/folding contracts remain unchanged.

**Verification:** existing conversation tests, story interactions, browser
visual/a11y, bundle graph.

**Dependencies:** T20–T30.\
**Likely files:** conversation component groups, SDK entrypoint, stories/tests.
**Size:** multiple M tasks during execution: folding/model, renderers, composer,
panel/drawer.\
**Commit family:** `refactor(sdk): focused conversation ...`

### Workstream T35 — Classify and migrate remaining shared application patterns

**Description:** Census Markdown, agent displays/selectors, asset/model pickers,
search degradation/score UI, PluginSettingsRenderer, and TurnOutputView into
presentation-only versus app-aware SDK ownership.

**Acceptance:** each export has one justified entrypoint/owner and an official
consumer; private host behavior is not accidentally public; stories cover the
stable public set.

**Verification:** export census, consumer tests, public Storybook completeness,
bundle graph.

**Dependencies:** T20–T34.\
**Likely files:** shared component families, focused exports, stories/tests.
**Size:** four pre-split M tasks: T35a markdown/search; T35b agent identity,
filter, select, and status; T35c asset/model/color pickers; T35d settings and
turn output.\
**Commit family:** `refactor(sdk): classify shared application patterns`

### T36 — Prove focused entrypoints and freeze the migration API

**Description:** Run external consumer fixtures, dependency graphs, size
comparisons, and official representative consumers; update the spec if any
public API changed during implementation.

**Acceptance:** public API inventory is reviewed; legacy barrel is frozen and
fails on new exports; charts/conversation remain isolated; no duplicate React,
Base UI, SDK, or stylesheet runtime exists.

**Verification:** package fixture, `build:vendors`, `size:report`, Storybook,
architecture tests, representative reference plugin.

**Dependencies:** T31–T35.\
**Likely files:** export tests, legacy allowance, API inventory/docs.\
**Size:** S.\
**Commit:** `test(sdk): freeze focused UI entrypoint contracts`

### 🔶 USER CHECKPOINT — Public component and layout contract

- [ ] Review the public Storybook, props, composition recipes, and escape
  hatches before official fleet migration.
- [ ] Confirm no missing Bits-driven requirement needs a public primitive.
- [ ] Approve the frozen prerelease UI API for migration use.

---

## Phase 4 — Plugin Isolation, Stylesheet, and Conformance Harness

### T37 — Inject page and per-slot plugin ownership roots

**Description:** Wrap every plugin page and each individual slot contribution
with stable `data-bakin-plugin` ownership without changing routing or slot
semantics.

**Acceptance:** nested/multiple contributions have correct independent roots;
route params, Suspense, error boundaries, cleanup, and React identity remain
unchanged; seeded tests cover pages and slots.

**Verification:** plugin-host/slot tests, routing suite, reference plugin live
mount.

**Dependencies:** T36.\
**Likely files:** host PluginHost/slot rendering, SDK slots, component tests.
**Size:** M.\
**Commit:** `feat(host): plugin ownership roots for pages and slots`

### T38 — Implement plugin CSS containment validation

**Description:** Parse built plugin CSS, prefix/validate selectors, keyframes,
font declarations, root/document selectors, and cross-plugin references with
actionable source-mapped errors.

**Acceptance:** global/escaping selectors and duplicate SDK stylesheet content
fail; valid domain CSS nested under the plugin root passes; false-positive
exceptions are explicit system-owned cases.

**Verification:** fixture matrix with teeth; core/Bits audit; plugin build tests.

**Dependencies:** T37.\
**Likely files:** `scripts/ui/validate-plugin-css.ts`, plugin builder integration,
fixtures/tests.\
**Size:** M.\
**Commit:** `feat(plugins): enforce scoped browser CSS contracts`

### T39 — Make overlays and runtime CSS containment-safe

**Description:** Ensure system portals preserve plugin identity/style scope,
the host loads one SDK stylesheet, and plugin bundles do not embed it.

**Acceptance:** dialog/popover/tooltip/toast examples from two plugins can
coexist without selector/token bleed; portal content retains ownership;
production build proves exactly one stylesheet copy.

**Verification:** cross-plugin Playwright fixture, duplicate-style test,
production build/size report.

**Dependencies:** T25–T26, T37–T38.\
**Likely files:** portal provider/primitives, host stylesheet loading, build
assertions/tests.\
**Size:** M.\
**Commit:** `fix(ui): containment-safe plugin overlays and stylesheet loading`

### Checkpoint 4A — Isolation contract

- [ ] Seeded page, slot, selector, portal, and duplicate-style failures bite.
- [ ] Existing routing/slot behavior remains green.
- [ ] Two plugins can render overlays simultaneously without visual bleed.

### T40 — Build the deterministic plugin fixture host

**Description:** Extend `@makinbakin/sdk/testing` with a browser fixture host
containing real styles, wrappers, routing, slots, overlay roots, and controllable
runtime data.

**Acceptance:** external-style plugins mount page and slot contributions using
only public SDK imports; fixtures select desktop/mobile and all system states;
no Bakin user state is required.

**Verification:** fixture package self-containment, reference plugin smoke,
Playwright render test.

**Dependencies:** T37–T39.\
**Likely files:** `packages/sdk/src/testing/ui/`, fixture host, tests.\
**Size:** M.\
**Commit:** `feat(sdk): deterministic plugin UI fixture host`

### T41 — Implement the plugin UI conformance command

**Description:** Add the starter-facing `test:ui` workflow for CSS scope,
stylesheet identity, overflow, axe, keyboard/focus, console errors, and
desktop/mobile screenshots.

**Acceptance:** every promised violation has a seeded failing fixture and an
actionable report; broader visual findings do not become runtime install
blockers; deterministic contract violations can be reused by packaging.

**Verification:** run passing and seeded failing external fixtures; inspect
HTML report; package consumer test.

**Dependencies:** T40.\
**Likely files:** SDK testing CLI/runner, starter script fixture, conformance
tests/reporting.\
**Size:** M.\
**Commit:** `feat(sdk): one-command plugin UI conformance suite`

### Workstream T42 — Rebuild the reference plugin and official template as exemplars

**Description:** Migrate the in-tree reference plugin and Bits `_template` to
the focused SDK, canonical archetypes, form/state recipes, scoped domain CSS,
stories/fixtures, and `test:ui`.

**Acceptance:** no private/legacy imports, raw standard controls, unscoped CSS,
or host Tailwind dependency remains; page and slot examples pass conformance;
docs can source snippets from them.

**Verification:** install/build/activate golden path; conformance; docs snippet
checks; desktop/mobile visuals.

**Dependencies:** T41.\
**Likely files:** `examples/reference-plugin/`, Bits `_template/`, starter docs
fixtures.\
**Size:** one M task/PR per repository.\
**Commit pair:** `refactor(examples): canonical plugin UI reference` and
`refactor(template): canonical SDK UI starter`

### Workstream T43 — Wire official core and Bits conformance CI

**Description:** Run the same public harness for all client-bearing official
plugins and feed results into the compatibility matrix and census.

**Acceptance:** core and Bits CI name every plugin result; server-only Git and
Images are explicitly non-UI rather than silently skipped; a seeded official
violation blocks its repository.

**Verification:** complete harness locally against core and sibling Bits;
workflow validation; seeded failure branch.

**Dependencies:** T41–T42.\
**Likely files:** both repositories' CI/config, compatibility/census generator,
official fixture metadata.\
**Size:** M per repository.\
**Commit pair:** `ci(ui): official plugin conformance gate`

### Checkpoint 4B — Plugin-author golden path

- [ ] Fresh template: install dependencies → `bun run test:ui` → pass.
- [ ] Reference plugin and Bits template render pages and slots in the real
  contract with no private styling access.
- [ ] Every client-bearing official plugin is enrolled before migration begins.

---

## Phase 5 — Host Shell and Shared Browser Surfaces

### Workstream T44 — Migrate shell canvas, sidebar, header, and navigation

**Description:** Apply approved tokens/layout to LayoutShell, AppSidebar,
Header, navigation sections/items/badges, connection status, dispatch timer,
notification toggle, and mobile backdrop without altering the recent
navigation/routing contract.

**Acceptance:** desktop and 320px navigation remain fully operable; closed
sections, badges, active state, collapse, focus order, skip navigation, and
backdrop labelling pass; no hard navigation or URL shape changes occur.

**Verification:** existing navigation/routing tests, Storybook/internal shell
fixtures, three-browser keyboard/mobile checks, visual baselines, size budget.

**Dependencies:** T36, T43.\
**Likely files:** `packages/host/src/components/layout/`, shell tests/stories,
snapshots.\
**Size:** split into two M tasks/commits: shell/header and sidebar/navigation.\
**Commit family:** `refactor(host): migrate browser shell ...`

### Workstream T45 — Migrate global search, toasts, and global overlays

**Description:** Apply command/overlay/system-state patterns to global search,
toaster, launcher/global dialogs, and failure notices while retaining existing
search and SPA-navigation behavior.

**Acceptance:** keyboard launch/navigation/dismiss/return focus, degraded and
error states, long results, mobile layout, and concurrent plugin overlays pass;
toast links remain SPA navigation and dismiss correctly.

**Verification:** existing search/toast tests, Playwright interaction/a11y/
visual, routing connection-survival smoke.

**Dependencies:** T26, T29, T39, T44.\
**Likely files:** host global-search/toaster plus shared launcher components and
tests/stories.\
**Size:** M, split search from toast/notifications if needed.\
**Commit:** `refactor(host): canonical global search and feedback overlays`

### Checkpoint 5A — Shell/navigation stability

- [ ] Recent routing overhaul success criteria still pass.
- [ ] Shell/navigation/global overlays are functional from 1440 to 320px.
- [ ] SSE connections survive internal navigation during live smoke.

### Workstream T46 — Migrate Settings and Runtime routes

**Description:** Move Settings forms and Runtime overview/capabilities/
extensions/runtimes tabs onto the canonical form, tab, status, state, and
detail archetypes.

**Acceptance:** settings validation/save/error/dirty behavior and runtime
loading/degraded/error/tab URL state are unchanged; all standard controls come
from the SDK/private host implementation.

**Verification:** existing host/runtime/settings tests, route deep links,
Storybook fixtures, desktop/mobile visual/a11y, size budget.

**Dependencies:** T28–T32, T44–T45.\
**Likely files:** Runtime host components, settings shared components/routes,
tests/stories.\
**Size:** two M tasks/commits: settings and runtime.\
**Commit family:** `refactor(host): migrate settings/runtime UI`

### T47 — Migrate landing, not-found, and plugin-failure surfaces

**Description:** Apply canonical page/system-state patterns to the index route,
NotFound, catch-all/plugin failure, and shell-level recovery notices.

**Acceptance:** unknown paths retain shell/navigation and recovery actions;
plugin shadow/failure diagnostics remain honest; desktop/mobile/error states
are deterministic and accessible.

**Verification:** existing 404/plugin-host tests, route smoke, axe/keyboard/
visual, console-error assertions.

**Dependencies:** T29–T30, T44.\
**Likely files:** index/not-found/catch-all/plugin-host failure components and
tests/stories.\
**Size:** M.\
**Commit:** `refactor(host): canonical landing and recovery surfaces`

### Checkpoint 5B — Host surface complete

- [ ] Every host-owned route and global overlay is migrated in the census.
- [ ] Shell payload/runtime budgets are ratcheted to their post-migration values.
- [ ] No host migration allowance remains for completed files.

---

## Phase 6 — Official Surface Migration by Archetype

Each task in this phase is a focused PR unless the plan explicitly identifies
a paired commit. The exact file list comes from the approved census entry and
must stay within that surface. Every PR includes behavior tests, deterministic
fixture/story, desktop/mobile baselines, axe/keyboard checks, conformance,
performance comparison, census status, and deletion of its legacy allowances.

### Workstream T48 — Tasks list shell, filters, metrics, and views

**Description:** Migrate Tasks page shell, URL-backed filters, metrics,
segmented board/log views, empty/loading/error states, and task log table.

**Acceptance:** `view`, `q`, `agent`, and `status` URL behavior remains intact;
dense board/log controls reflow at 320px; metrics/status use canonical patterns.

**Verification:** Tasks page/filter/log tests, routing tests, conformance,
visual/a11y/browser checks.

**Dependencies:** Phase 5 complete.\
**Likely files:** `kanban-board`, `task-filters`, `task-metrics`,
`task-log-table`, Tasks fixtures/tests.\
**Size:** split page shell/filters from metrics/log into two M commits.\
**Commit family:** `refactor(tasks): migrate list and filter UI`

### Workstream T49 — Tasks cards, columns, and detail workflow

**Description:** Migrate board columns/cards, deep-linked task detail, modes,
notes, run history, step output, and workflow panels without changing task or
dispatch behavior.

**Acceptance:** `taskId` overlay history/back behavior, DnD plus non-drag
alternative, blocking/deletion confirmations, long output, live activity, and
mobile detail operation pass.

**Verification:** existing task/DnD/detail tests, route/deep-link suite,
reduced-motion/keyboard/manual drag alternative, visual/a11y/conformance.

**Dependencies:** T48.\
**Likely files:** Tasks card/column/detail subgroups and tests/stories.\
**Size:** split board items and detail subpanels into at least two M PRs.\
**Commit family:** `refactor(tasks): migrate board/detail UI`

### Checkpoint 6A — First operational archetype

- [ ] Tasks is fully migrated with no styling allowances.
- [ ] Board, table, drawer, URL state, live activity, and mobile behavior prove
  the list/detail recipes before other plugins copy them.
- [ ] Review resulting SDK gaps; any shared change lands separately.

### Workstream T50 — Assets index, folders, import, and list/grid views

**Description:** Migrate VersionedAssetGrid, filters/sort/pagination, cards/
atoms, TagFolderGrid, TagInput, and ImportView.

**Acceptance:** existing `view`, `q`, `type`, `page`, `sort`, `dir`, and folder
URL state remains stable; media/domain content keeps identity; list/grid/trash
and no-results/error/loading states work at 320px.

**Verification:** Assets component/plugin tests, deep links, conformance,
visual/a11y/browser checks, large-content overflow.

**Dependencies:** T48 checkpoint.\
**Likely files:** Assets index/folder/import component groups and tests/stories.
**Size:** two M PRs: index/filter/views and folder/import.\
**Commit family:** `refactor(assets): migrate index UI`

### Workstream T51 — Assets detail, edit, enrichment, versions, and slots

**Description:** Migrate detail route, preview, edit drawer, enrichment,
versions, task-assets slot, and nav badge provider.

**Acceptance:** `/assets/$assetId` cold/deep link, edit/delete/version actions,
bounded media preview, slot isolation, and badge semantics remain intact.

**Verification:** asset detail/route/slot tests, conformance, overlay focus,
visual/a11y/mobile.

**Dependencies:** T50.\
**Likely files:** Assets detail/edit/enrichment/version/slot groups.\
**Size:** two M PRs: detail/media and edit/enrichment/slots.\
**Commit family:** `refactor(assets): migrate detail and contribution UI`

### Checkpoint 6B — Data/media archetype

- [ ] Assets list/detail/media/slot surfaces have zero legacy allowances.
- [ ] Bounded media and table overflow do not create document overflow.
- [ ] Task-assets contribution passes page and per-slot containment.

### Workstream T52 — Brands list, creation, card, and detail overview

**Description:** Migrate BrandsPage, BrandCard, new-brand flows, detail shell,
overview/status/actions, and canonical routing.

**Acceptance:** `/brands` and `/brands/$brandId` behavior, URL-backed search/tab
state, creation validation, deletion/recovery, and brand-owned color rendering
remain intact.

**Verification:** Brands tests, routing/deep links, form workflow, visual/a11y/
conformance.

**Dependencies:** Phase 5, T51 patterns.\
**Likely files:** Brands list/create/detail-shell groups.\
**Size:** two M PRs: list/create and detail overview.\
**Commit family:** `refactor(brands): migrate list and detail UI`

### Workstream T53 — Brands builder, docs, brainstorm, and task slot

**Description:** Migrate BrandBuilder, doc editor route, doc brainstorm,
new-brand flows remainder, and task-brand slot using scoped domain expression.

**Acceptance:** dedicated doc paths and existing tab/search state remain;
dirty/save guards, editor/preview, conversation embedding, brand palettes, and
task slot isolation pass.

**Verification:** editor/brainstorm/slot tests, unsaved routing guard, visual/
a11y/conformance/mobile.

**Dependencies:** T52, T31, T34.\
**Likely files:** Brands builder/docs/brainstorm/slot groups.\
**Size:** two M PRs: builder/docs and brainstorm/slot.\
**Commit family:** `refactor(brands): migrate authoring and slot UI`

### T54 — Explore catalog, detail, install, and consent

**Description:** Migrate ExplorePage, CatalogCard, DetailDrawer, InstallDialog,
ConsentDialog, and search degradation/system states.

**Acceptance:** install/consent permissions and errors remain honest;
catalog/detail works with keyboard and at 320px; external/domain imagery remains
bounded.

**Verification:** Explore/plugin install tests, overlay focus, visual/a11y/
conformance.

**Dependencies:** Phase 5.\
**Likely files:** Explore components and tests/stories.\
**Size:** M.\
**Commit:** `refactor(explore): migrate catalog and install UI`

### Checkpoint 6C — Creation and catalog archetypes

- [ ] Brands and Explore have no legacy allowances.
- [ ] Forms/editors/consent flows use canonical fields and system states.
- [ ] Brand/domain styling remains scoped and accessible.

### Workstream T55 — Schedule shell, calendar views, and list

**Description:** Migrate SchedulePage, monthly/weekly/today calendars, job list/
rows, events, agent/status presentation, and URL-backed view/filter states.

**Acceptance:** calendar/list switching, event selection, `view/q/agent` state,
dense desktop scanning, bounded narrow overflow, and non-color statuses pass.

**Verification:** Schedule calendar/list tests, URL state, keyboard event access,
visual/a11y/conformance at all widths.

**Dependencies:** T48 patterns, T33 if charts used.\
**Likely files:** Schedule page/calendar/list groups.\
**Size:** two M PRs: page/list and calendars/events.\
**Commit family:** `refactor(schedule): migrate calendar and list UI`

### Workstream T56 — Schedule job form, drawer, history, and controls

**Description:** Migrate JobDrawer, JobForm, schedule input, pause/delete
controls, and run history.

**Acceptance:** `jobId`/`mode` deep links, create/edit/duplicate/delete/pause,
validation, recurrence input, busy/error states, and back/forward behavior remain
stable.

**Verification:** Schedule form/drawer tests, routing history, form axe/focus,
visual/conformance/mobile.

**Dependencies:** T55, T28, T31.\
**Likely files:** Schedule job form/drawer/control groups.\
**Size:** two M PRs: drawer/history and form/controls.\
**Commit family:** `refactor(schedule): migrate job workflow UI`

### Workstream T57 — Team index, teams, forms, packages, and adoption

**Description:** Migrate TeamManager/Grid, TeamDetail, agent/team forms,
PackageCard/state, and AdoptDialog.

**Acceptance:** `/team`, `/team/teams/$teamId`, create/edit/adopt/package flows,
validation, empty/error states, and mobile layout remain functional.

**Verification:** Team index/team/form/package tests, route checks, visual/a11y/
conformance.

**Dependencies:** T52 form/detail recipes.\
**Likely files:** Team grid/manager/team-detail/form/package/adopt groups.\
**Size:** two M PRs: index/teams and forms/packages/adoption.\
**Commit family:** `refactor(team): migrate roster and management UI`

### Workstream T58 — Agent detail tabs, diagnostics, lessons, and markdown editing

**Description:** Migrate AgentDetail and its overview, active context,
diagnostics, heartbeat, lesson, and markdown editor tabs.

**Acceptance:** `/team/$id`, `tab`, and `lessonId` deep links remain; scroll/
highlight, status/diagnostic charts, editor dirty state, independent failures,
and mobile tabs pass.

**Verification:** Team detail/tab tests, deep-link suite, chart/editor checks,
visual/a11y/conformance.

**Dependencies:** T57, T33.\
**Likely files:** Agent detail tab groups.\
**Size:** at least two M PRs: overview/context/heartbeat and diagnostics/
lessons/editor.\
**Commit family:** `refactor(team): migrate agent detail UI`

### Checkpoint 6D — Scheduling and people archetypes

- [ ] Schedule and Team have zero legacy styling allowances.
- [ ] Calendar, drawer/form, tabbed detail, diagnostics, and editor recipes are
  proven at desktop/mobile with URL state intact.

### Workstream T59 — Memory search, overview, detail, and cleanup

**Description:** Migrate MemoryShell, tier overview, search results/content,
deep-linked detail drawer, and cleanup workflow.

**Acceptance:** `q/tier/agent/kind/recordId` state, degraded search, selection/
back, tier/domain display, cleanup confirmation, and all system states remain.

**Verification:** Memory search/detail/cleanup tests, deep links, visual/a11y/
conformance/mobile.

**Dependencies:** T48, T31–T32.\
**Likely files:** Memory components and tests/stories.\
**Size:** two M PRs: search/overview and detail/cleanup.\
**Commit family:** `refactor(memory): migrate search and detail UI`

### Workstream T60 — Models catalog, aliases, routing, spend, and agent tabs

**Description:** Migrate ModelsPage/shared structures and its agents, available,
aliases, routing, and spend tabs.

**Acceptance:** `tab` URL state, independent loading/errors, model/brand domain
identity, forms/tables/charts, and mobile tab navigation remain intact.

**Verification:** Models page/tab tests, deep links, chart/form coverage,
visual/a11y/conformance.

**Dependencies:** T33, T46 tab patterns.\
**Likely files:** Models page and tab groups.\
**Size:** two M PRs: shell/agents/available and aliases/routing/spend.\
**Commit family:** `refactor(models): migrate catalog and routing UI`

### Workstream T61 — Health overview and activity surfaces

**Description:** Migrate HealthPage shell, overview cards/alerts/operations/
spend/context/interactions, activity tab, metrics, charts, rows, pulse, failure
groups, and trends.

**Acceptance:** overview/action-first behavior, activity states, chart tables,
live refresh, long incidents, and `tab` URL state remain; content-first layout
removes nested card excess.

**Verification:** existing Health preflight/verifier plus component tests,
deep links, visual/a11y/conformance/performance.

**Dependencies:** T33, Phase 5.\
**Likely files:** Health overview and activity groups.\
**Size:** four pre-split M tasks: T61a overview shell/pulse/alerts; T61b
overview operations/spend/context/interactions; T61c activity metrics/charts;
T61d activity rows/failures/trends.\
**Commit family:** `refactor(health): migrate overview and activity UI`

### Workstream T62 — Health agents, system inventory, repair, and badge

**Description:** Migrate agents tab/usage/pulse, system inventory/search/watch
list, repair dialog, intros/incidents, and nav badge provider.

**Acceptance:** agent/system independent failures, repair busy/error/result,
inventory overflow, badge semantics, and desktop/mobile operation remain.

**Verification:** Health verifier full route, component/repair tests,
visual/a11y/conformance/performance.

**Dependencies:** T61.\
**Likely files:** Health agents/system/repair/badge groups.\
**Size:** three pre-split M tasks: T62a agents; T62b system inventory/search;
T62c watch/repair/badge/intros.\
**Commit family:** `refactor(health): migrate agents and system UI`

### Checkpoint 6E — Search, catalogs, and diagnostics

- [ ] Memory, Models, and Health have zero legacy allowances.
- [ ] Health's bespoke verifier is reconciled with—not duplicated by—the
  general harness.
- [ ] Dense chart/table/diagnostic pages remain within performance budgets.

### T63 — Chat list, rail, launcher, agent selection, and badges

**Description:** Migrate ChatPage list shell, rail, agent picker, launcher, and
unread/badge/toast presentation while preserving the new path routing.

**Acceptance:** `/chat`, `/chat/new?agent=`, selection, unread attention,
mobile rail/navigation, and SPA toast/notification behavior remain unchanged.

**Verification:** recent chat path-routing tests, attention/badge tests,
visual/a11y/conformance/mobile.

**Dependencies:** T34, T45.\
**Likely files:** Chat page/rail/agent-picker/launcher/badge groups.\
**Size:** M.\
**Commit:** `refactor(chat): migrate navigation and attention UI`

### T64 — Chat conversation, composer, streaming, and tool activity

**Description:** Migrate ChatView onto the focused conversation kit's approved
rendering/composer/tool states without changing stream or transcript behavior.

**Acceptance:** `/chat/$chatId` cold boot/back/forward, streaming text, thinking,
tool activity/drawer, attachments, errors/retry, composer, long transcripts,
and reduced motion pass at desktop/mobile.

**Verification:** chat conversation/streaming tests, routing suite, mock live
flow, visual/a11y/conformance/performance.

**Dependencies:** T63.\
**Likely files:** Chat view plus conversation-kit consumer fixtures/tests.\
**Size:** M.\
**Commit:** `refactor(chat): migrate conversation UI`

### Workstream T65 — Workflows list, creation, detail, and drawers

**Description:** Migrate WorkflowsPage/cards, new route, WorkflowDetail,
details/step drawers, copy/delete actions, and managed copy dialog.

**Acceptance:** list/search, `/workflows/new`, detail/edit navigation, copy/
delete, approvals/status, and drawer focus/history remain stable.

**Verification:** Workflows route/component tests, deep links, visual/a11y/
conformance/mobile.

**Dependencies:** T31–T32.\
**Likely files:** Workflows list/detail/action/drawer groups.\
**Size:** two M PRs: list/create and detail/drawers/actions.\
**Commit family:** `refactor(workflows): migrate list and detail UI`

### Workstream T66 — Workflow canvas, nodes, palette, and configuration

**Description:** Migrate canvas/editor, node palette, all node types, node
config, parallel children, and assignment labels while preserving workflow
behavior and bounded canvas ownership.

**Acceptance:** select/pan/zoom/connect/configure/save, keyboard/non-drag
alternatives, node statuses/domain colors, narrow fallback, reduced motion, and
unsaved guards pass; document-level overflow never occurs.

**Verification:** workflow canvas/node tests, browser interaction/a11y/manual
keyboard, visual/conformance/performance.

**Dependencies:** T65, T31.\
**Likely files:** Workflows canvas/palette/nodes/config groups.\
**Size:** five pre-split M tasks: T66a canvas shell; T66b palette/base node
shell; T66c action nodes; T66d orchestration nodes; T66e configuration and
parallel editing.\
**Commit family:** `refactor(workflows): migrate canvas ...`

### Checkpoint 6F — Conversation and workflow archetypes

- [ ] Chat and Workflows have zero legacy allowances.
- [ ] Routing overhaul and streaming/workflow behavior tests remain unchanged.
- [ ] Keyboard/non-drag and bounded-canvas requirements have manual evidence.

### Workstream T67 — Bits Messaging navigation, plan list, and calendar

**Description:** In `bakin-bits-official`, migrate Messaging's custom route
shell/navigation, PlanList, ContentCalendar, status/badge/quick controls, and
all URL-backed filter/view state.

**Acceptance:** `/messaging`, `/messaging/plans`, `/messaging/calendar`, nav
children, filters/view/deep links, deliverable states, and mobile navigation
pass entirely through public prerelease SDK imports.

**Verification:** Bits tests/typecheck/lint/build, Bakin conformance harness,
desktop/mobile visual/a11y/browser checks, compatibility matrix update.

**Dependencies:** corresponding Bakin SDK prerelease from T36/T43.\
**Likely files:** Messaging route/client, plan-list/calendar/status/badge groups.
**Size:** two M Bits PRs: shell/list and calendar/status.\
**Commit family:** `refactor(messaging): migrate list and calendar UI`

### Workstream T68 — Bits Messaging workspace, deliverables, and brainstorm

**Description:** Migrate PlanWorkspace, DeliverableDrawer, BrainstormView, and
QuickPostButton using form/detail/conversation patterns.

**Acceptance:** `/messaging/brainstorm`, session/deep links, editor/dirty state,
deliverable actions, conversation stream, overlays, and 320px operation remain.

**Verification:** Bits plugin tests, conformance, conversation/form interaction,
visual/a11y/performance, compatibility matrix.

**Dependencies:** T67, T34.\
**Likely files:** Messaging workspace/deliverable/brainstorm/quick-post groups.
**Size:** two M Bits PRs: workspace/deliverable and brainstorm/quick-post.\
**Commit family:** `refactor(messaging): migrate workspace and brainstorm UI`

### T69 — Bits Projects list, cards, and creation

**Description:** Migrate ProjectGrid/Card and NewProjectDialog on `/projects`
and `/projects/new` using list/form archetypes.

**Acceptance:** URL-backed status/search, create validation/errors, navigation,
empty/no-results, and mobile cards/forms pass using public SDK only.

**Verification:** Bits project tests/typecheck/lint/build, conformance, routing,
visual/a11y, compatibility matrix.

**Dependencies:** Bakin SDK prerelease and T43.\
**Likely files:** Projects grid/card/new dialog/route groups.\
**Size:** M Bits PR.\
**Commit:** `refactor(projects): migrate list and creation UI`

### T70 — Bits Projects detail, checklist, and editor

**Description:** Migrate ProjectDetail, Checklist, and Editor on detail/edit
paths using detail/form/dirty-state recipes.

**Acceptance:** `/projects/$id`, `/projects/$id/edit`, save/cancel/dirty guard,
checklist interaction, statuses, long content, and mobile operation pass.

**Verification:** Bits project tests, routing/deep links, form/checklist browser
tests, visual/a11y/conformance, compatibility matrix.

**Dependencies:** T69, T31.\
**Likely files:** Projects detail/checklist/editor/route groups.\
**Size:** M Bits PR.\
**Commit:** `refactor(projects): migrate detail and editor UI`

### Checkpoint 6G — Official Bits parity

- [ ] Messaging, Projects, and the template have zero legacy allowances.
- [ ] Their exact SDK prerelease/Bakin ref is recorded and all conformance,
  visual, a11y, lint, typecheck, test, and build gates pass.
- [ ] Public API gaps discovered by Bits were resolved through separate SDK
  contract PRs, not private imports or local clones.

### Workstream T71 — Audit and migrate all non-page slot/badge contributions

**Description:** Use the census to verify nav-badge providers, task-assets,
task-brand, launchers, and any newly discovered individual slot contribution
not already completed with its owning page.

**Acceptance:** every slot has independent ownership root, deterministic fixture,
loading/error/empty state as relevant, and no cross-plugin selector/import;
server-only plugins are explicitly N/A.

**Verification:** complete slot census, multi-plugin fixture, conformance,
visual/a11y/browser checks.

**Dependencies:** T49, T51, T53, T62–T70.\
**Likely files:** remaining badge/slot providers, fixtures/tests/census.\
**Size:** split by contribution owner; no multi-plugin production edit in one
commit unless the change is purely generated census metadata.\
**Commit family:** `refactor(<plugin>): migrate <slot> contribution UI`

### T72 — Resolve shared-component and route census stragglers

**Description:** Re-run generation and create explicit small tasks for any
host/shared component, custom plugin route, overlay, or stable SDK export not
covered above; do not waive a surface to make completion percentages green.

**Acceptance:** every census item is migrated or has an approved explicit N/A
reason; no temporary `unknown`, `todo`, or unowned item remains.

**Verification:** `ui:census:check --require-complete`; compare manifests,
routes, slots, exports, stories, and tests; user reviews the zero-open dashboard.

**Dependencies:** T44–T71.\
**Likely files:** census-directed only.\
**Size:** one S/M task per straggler, appended to this plan before implementation.
**Commit family:** scope-specific.

### 🔶 USER CHECKPOINT — Complete official fleet

- [ ] Walk every route and primary workflow from the generated dashboard.
- [ ] Review desktop/mobile diff gallery and manual accessibility records.
- [ ] Approve moving from migration coexistence to destructive legacy deletion.

---

## Phase 7 — Full Audit, Deletion, Documentation, and Stable Baseline

### T73 — Complete manual accessibility and content review

**Description:** Close manual screen-reader, keyboard, 200% zoom, reflow,
reduced-motion, target-size, non-color, and content-language checklists for all
archetypes and complex components.

**Acceptance:** records name environment, workflow, outcome, limitations, and
owner; every discovered issue is fixed or explicitly blocks stabilization; no
automated result is presented as full WCAG proof.

**Verification:** manual record completeness scanner, axe/full browser suites,
content terminology audit.

**Dependencies:** T72.\
**Likely files:** `design-system/manual-a11y/`, content docs, issue-driven fixes.
**Size:** one M review/fix task per archetype; split fixes by component.\
**Commit family:** `fix(ui): close <archetype> accessibility findings`

### T74 — Run the complete visual, browser, conformance, and performance audit

**Description:** Execute the entire deterministic matrix on core and exact Bits
refs; inspect rather than merely generate the reports.

**Acceptance:** all stories/routes/slots have required baselines; Chromium,
Firefox, WebKit, console, overflow, conformance, and production budgets pass;
expected/actual data has no masked unexplained region.

**Verification:** `bun run ui:check`, production builds, full Bits checks,
`size:report`, repeated canonical run for flake detection.

**Dependencies:** T73.\
**Likely files:** only evidence, deterministic fixes, and reviewed baseline
updates.\
**Size:** M audit; each discovered defect becomes a separate S/M fix commit.\
**Commit:** `test(ui): complete official fleet verification evidence`

### Workstream T75 — Delete legacy contracts and temporary migration infrastructure

**Description:** Remove the old `/components` barrel, generic CSS token aliases,
duplicate primitives, superseded helpers/styles, zero-count allowance entries,
and migration-only stories/flags.

**Acceptance:** no owned consumer references deleted paths/tokens/patterns;
permanent architecture rules replace ratchets; package/docs generated output
contains only stable contracts; clean install/build works with no shim.

**Verification:** repository and Bits grep/scanners, typecheck/test/build/docs,
public package fixture, production smoke, baseline matrix.

**Dependencies:** user fleet-complete checkpoint, T74.\
**Likely files:** legacy SDK/root components/globals, export maps, scanners,
knowledge docs.\
**Size:** split into M commits: public barrel, token aliases/CSS, duplicate
components/helpers, migration tooling.\
**Commit family:** `refactor(ui)!: delete legacy ...`

### Checkpoint 7A — Clean contract

- [ ] Zero migration allowances and zero legacy imports/tokens remain.
- [ ] External consumer fixture compiles only against focused entrypoints.
- [ ] Reverting any deletion commit has a clear isolated rollback path.

### Workstream T76 — Publish the complete style guide and migration documentation

**Description:** Finalize public Storybook, Starlight teaching pages, generated
SDK reference, page-archetype guidance, CSS/token contract, content guide,
starter workflow, conformance troubleshooting, and breaking migration notes.

**Acceptance:** source-backed examples compile; public Storybook and docs match
the final package; stale preliminary knowledge is reconciled/deleted; routing
guidance points to the shipped routing documents rather than restating them
incorrectly.

**Verification:** `docs:check`, link/source-snippet checks, public Storybook
build, package export comparison, docs deployment preview.

**Dependencies:** T75.\
**Likely files:** `docs/src/content/docs/extending/ui/`, generated reference,
SDK README, `.claude/knowledge/`, migration guide.\
**Size:** split into M commits: author guide, generated reference, internal
knowledge/migration notes.\
**Commit family:** `docs(ui): publish ...`

### T77 — Cut and validate the coordinated stable UI SDK baseline

**Description:** Pin exact release candidates in core/Bits, run the complete
matrix, record compatibility, release the first stable redesigned UI contract,
and switch subsequent changes to normal semver/deprecation policy.

**Acceptance:** exact core and Bits refs pass every gate; release artifact
contains focused exports and stylesheet; starter installs the stable version;
release/migration notes name all breaking changes and rollback path.

**Verification:** package dry run/contents, release candidate install into
reference and Bits, full CI/visual/conformance/performance/docs, post-release
smoke from published artifact.

**Dependencies:** T76 and explicit user release approval.\
**Likely files:** compatibility matrix, package/release metadata, changelog,
release workflow/docs.\
**Size:** M.\
**Commit:** `release(sdk): stable browser UI contract baseline`

### T78 — Reconcile performance tracking with issue #423

**Description:** Publish final browser asset budgets/results into the existing
size-reporting workstream and identify which whole-binary/release goals remain
owned by #423; do not claim the broader issue is complete unless all of its
acceptance criteria truly pass.

**Acceptance:** local/CI reporting documents browser versus raw/compressed
binary measurements; #422 deduplication remains protected; any issue update is
factually scoped and user-authorized.

**Verification:** `size:report`, release artifact comparison, budget docs.

**Dependencies:** T77.\
**Likely files:** size-report docs/budgets and, only with authorization, GitHub
issue #423.\
**Size:** S.\
**Commit:** `docs(perf): record stable UI browser budgets`

### Final Checkpoint — Initiative complete

- [ ] All 15 specification success criteria pass with evidence.
- [ ] Core and Bits stable refs are compatible and released.
- [ ] No permanent legacy tier, shim, temporary allowlist, or hidden hosted
  service remains.
- [ ] Spec and plan statuses are marked complete only after every required
  task and user checkpoint is actually done.

---

## Pull Request and Commit Strategy

### PR boundaries

1. **Planning PR:** specification, plan, and checklist only.
2. **Foundation PRs:** census/ratchets; workbench/browser harness;
   tokens/generator; coded specimens/design approval.
3. **Contract PRs:** private package/focused exports; primitives by family;
   layout/forms/states/archetypes; charts; conversation; remaining patterns.
4. **Plugin-contract PRs:** ownership roots/CSS containment; fixture/conformance
   harness; reference/template and CI enrollment.
5. **Host PRs:** shell/navigation; global overlays; Settings/Runtime; recovery
   surfaces.
6. **Migration PRs:** one coherent route/archetype slice per PR. Large plugins
   use the explicit subtasks above; Bits changes live in paired Bits PRs against
   an exact SDK prerelease.
7. **Closeout PRs:** manual/full audit fixes; legacy barrel; token/CSS cleanup;
   duplicate deletion; public docs; coordinated release.

No PR may combine foundation API design with unrelated plugin migrations. No
Bits PR may solve a missing SDK capability with a local helper that belongs in
the public contract.

### Commit rules

- Every commit is a named rollback checkpoint and passes its scoped tests,
  lint/typecheck where relevant, and the production build boundary it changes.
- A component or surface commit includes its behavior tests, story/fixture,
  accessibility assertions, approved canonical baseline changes, census
  update, and deletion of the replaced code/allowance. Do not leave a commit
  knowingly red while waiting for a later “test” commit.
- Generated artifacts change in the same commit as their canonical source.
- Intentional visual baseline updates are isolated enough to review and named
  in the PR description; CI never generates an approval commit.
- Documentation describing a new public contract ships in the same PR as the
  contract. Broad migration/release notes may aggregate only after all
  referenced behavior exists.
- Conventional scopes identify ownership: `ui`, `sdk`, `host`, or the plugin
  ID. Breaking public changes use `!` and name the migration in the body.
- Before each commit: confirm expected branch/HEAD and `git status`; stage only
  the task's files; never absorb unrelated user work or generated noise.

### Paired Bakin/Bits changes

```text
Bakin contract PR → publish exact UI prerelease → Bits consumer PR
        │                                      │
        └──────── compatibility matrix + harness ────────┘
                              │
                       Bakin fleet gate PR
```

If a change cannot be backward-compatible within the prerelease window, merge
order and temporary exact versions are documented in both PRs. There is still
no compatibility shim: the prerelease fleet advances as one coordinated set.

### Required PR evidence

- Census items and legacy counts before/after.
- Behavior preserved and explicit non-goals.
- Commands run and exact refs/environments.
- Desktop/mobile expected/actual/diff gallery for intentional changes.
- Accessibility results and any manual record updated.
- Browser payload/runtime measurements before/after.
- Rollback: the commit(s) or package version to revert and any paired Bits
  dependency.

## Verification Matrix

| Change type | Minimum gate |
|---|---|
| Token source/generator | token fixtures, deterministic regeneration, contrast, public docs/story coverage, CSS build |
| Primitive/pattern | unit/interaction, axe, keyboard/focus, desktop/mobile visual, three-browser smoke, API types |
| Layout/archetype | 1024/720/480/320 overflow/reflow, system states, routing-state guidance, visual/a11y |
| Host shell/global | routing/navigation suite, SSE-survival live smoke, mobile keyboard, visual/a11y, payload budget |
| Plugin page/slot | plugin behavior tests, real-host conformance, scope validator, desktop/mobile visual, census/allowance removal |
| SDK export/style | external consumer fixture, package contents, vendor/runtime identity, tree/bundle graph, size budget |
| Bits consumer | Bits lint/typecheck/test/build plus Bakin harness and exact compatibility matrix |
| Docs/catalog | source-backed snippets, public-only import audit, static build/link check, Cloudflare artifact preview |
| Stable release | entire core+Bits matrix, package dry run/install, docs, production assets, rollback notes |

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Public components are designed around core only | High | Census Bits first; coded specimens use Bits content; API checkpoint requires a Bits consumer before freeze. |
| Temporary mixed UI becomes permanent | High | Machine-readable owner/status, monotonic ratchets, zero-open user checkpoints, and stable release blocked until deletion. |
| Visual tests become flaky/noisy | High | Pinned Linux image, deterministic source fixtures, stable fonts/time/network/motion, mask only by review, repeat-run gate. |
| Screenshot volume bloats Git/CI | Medium | Two canonical baseline sizes, risk-based extra states, path-aware PR runs, full main/release runs, inspect size after Phase 1. |
| Storybook/Vite behavior diverges from Bun host | High | Public stories use exact SDK stylesheet; reference plugin and real-host conformance are graduation gates; production dependencies are asserted absent. |
| Plugin CSS containment breaks portals/overlays | High | Ownership-aware system portal root, two-plugin fixture, page and per-slot teeth tests before enforcement. |
| Focused SDK entrypoints reintroduce duplicate payload | High | Dependency graph tests and `size:report`; preserve #422 outcome; heavy domains isolated; exact one-style/React/SDK assertions. |
| Migration changes feature behavior or routes | High | Behavior tests first, existing routing docs authoritative, migration scope boundary, workflow changes require separate specs. |
| Automated accessibility creates false confidence | High | Manual screen-reader/reflow/reduced-motion records at graduation and closeout; suppressions ask-first and evidence-backed. |
| 320px support turns into hidden/removed functionality | High | Required primary workflow test at 320px; bounded internal scroll allowed, document overflow and missing actions fail. |
| Cross-repository prerelease drift | High | Exact SDK pins and refs, compatibility matrix, paired PR diagram, complete official fleet gate before stable. |
| Performance work duplicates issue #423 | Medium | UI work owns browser measurements; #423 retains binary/release budget scope; integrate existing `size:report`. |
| Baseline review becomes rubber-stamping | Medium | CI cannot accept; PR must explain affected surfaces and expose diffs; user checkpoints inspect galleries. |
| Long-lived branch accumulates conflicts | High | Incremental green PRs on `main`; no mega-branch or duplicate feature-flagged application. |

## Planning Outputs Still Chosen Empirically

These are not open scope decisions. Their tasks and approval gates are fixed,
but the value cannot be known responsibly before evidence exists:

- Resolved at T18: Product Character, Space Grotesk + JetBrains Mono, and the
  approved initial semantic token values.
- Final page-archetype membership and low-level layout membership: T2–T3,
  T27–T30.
- Numeric browser asset/runtime budgets: T1, T5, then ratcheted throughout.
- Additional migration tasks discovered by the complete census: T72, which
  requires updating this plan before implementation rather than silently
  broadening another task.

## Approval Gate

Implementation begins only after the user approves both `SPEC.md` and this
plan. Approval authorizes the incremental implementation workflow and local
repository changes described here; it does not pre-authorize hosted services,
paid plans, external issue/PR writes, releases, or destructive migration
checkpoints that are separately marked for user review.
