# Plan: CLI TUI Output Integration

## Status

Draft implementation plan following the style spike in
`.claude/specs/cli-tui-output-style.md`.

This plan is intentionally narrower than the broader CLI TUI DX hardening work.
The goal is to make real human-facing CLI output look and behave like the
approved gallery, while preserving deterministic JSON/plain output boundaries.

## Objective

Promote the approved gallery style into shared production CLI UI primitives and
then migrate the most important command families incrementally:

- onboarding and setup decisions
- doctor diagnostics, repair previews/results, and delegated repairs
- plugin, task, and agent list/report surfaces
- generic errors and command result fallback output

Success means real TTY users consistently see the Bakin header, status blocks,
section dividers, grouped remediation, and clear interactive prompts across the
main CLI workflows. Agents and scripts continue to use JSON envelopes or stable
plain output.

## Non-Goals

- Do not complete the full canonical CLI runner cutover in this plan.
- Do not change plugin/server API contracts unless a renderer needs structured
  data already returned by those APIs.
- Do not add compatibility shims for old output strings.
- Do not migrate browser UI design patterns.
- Do not make the style gallery call real Bakin APIs.

## Design Decisions

- The gallery remains a design fixture and regression playground.
- Production primitives live under `src/core/cli/ui/*`; gallery-only fixtures
  stay in `tui-gallery.tsx`.
- Existing production `Report`, `StatusBadge`, `DoctorReport`, and onboarding
  UI should be replaced or refactored to use the same status tokens, header,
  sections, summaries, and row layout from the gallery.
- JSON and non-TTY plain output stay separate from the Ink TTY renderer.
- Interactive selection uses the existing `MultiSelect` primitive, with embedded
  title suppression when a surrounding screen/section already names the action.
- The Bakin header should appear on human-facing TTY command screens, not JSON,
  plain, or machine-consumed output.

## Migration Order

### Slice 1: Promote Shared TUI Primitives

Create production-ready primitives from the gallery design:

- `BakinHeader`
- `Section`
- `StatusToken`
- `SummaryStrip`
- `FindingRows`
- `ProgressMeter`
- `NextActions`
- typed status vocabulary and mappings

Keep the gallery rendering through those shared primitives so the prototype and
production implementation cannot drift.

Verification:

- `tests/cli/ui.test.tsx`
- `tests/cli/tui-gallery.test.tsx`
- `bun run typecheck`

Commit checkpoint:

- `refactor: promote shared cli tui primitives`

### Slice 2: Migrate Generic Result and Error Rendering

Update `GenericResultView` and `renderInkEnvelope()` to use the Bakin header,
status blocks, and sectioned error/remediation layout. Leave JSON and plain
renderers stable.

Verification:

- `tests/cli/render.test.tsx`
- focused generic error render tests

Commit checkpoint:

- `refactor: align generic cli result rendering`

### Slice 3: Migrate Doctor Output

Replace `DoctorReport` and doctor repair/delegate presentation with the shared
TUI primitives.

Target screens:

- `bakin doctor`
- `bakin doctor --full`
- `bakin doctor --fix`
- `bakin doctor --fix --yes`
- `bakin doctor --delegate`
- `bakin doctor --delegate --yes`
- `bakin doctor repair list/show/verify`

Important behavior:

- Default doctor stays report-only.
- Confirmation prompts remain explicit for mutation/delegation.
- `--json` remains machine-readable and does not render Ink.
- Offline/default doctor clearly separates local checks from skipped server
  checks.

Verification:

- `tests/cli/doctor-ui.test.tsx`
- `tests/cli/doctor-repair.test.ts`
- relevant core doctor tests
- manual gallery comparison for doctor screens

Commit checkpoint:

- `refactor: migrate doctor cli tui output`

### Slice 4: Migrate Onboarding Output

Replace `OnboardingSummary`, `OnboardingBusy`, `ConfirmStep`, and onboarding
intro output with shared primitives.

Target screens:

- `bakin onboard`
- `bakin onboard --check`
- already-onboarded message
- runtime blocker
- Antfly/Search/Termite/mcporter confirmations
- recommended plugin and agent selection
- async progress and final status

Important behavior:

- Real selection screens use `MultiSelect`.
- Antfly confirmation default should be decided explicitly before coding; the
  current mock shows `y/N`, while current code defaults the search adapter prompt
  to confirm.
- Non-TTY and `--json` must never hang on prompts.
- `--yes` uses defaults without rendering interactive prompts.

Verification:

- `tests/cli/onboarding-ui.test.tsx`
- focused prompt/default tests
- isolated `BAKIN_HOME` smoke for blocked and already-onboarded cases

Commit checkpoint:

- `refactor: migrate onboarding cli tui output`

### Slice 5: Migrate List and Report Commands

Apply the same primitives to high-frequency list/report commands after doctor
and onboarding establish the pattern.

Candidates:

- `bakin plugins list`
- `bakin tasks list`
- `bakin agents list`
- `bakin agents list --packages`
- `bakin packages list`
- `bakin paths`
- `bakin status`
- `bakin check all`
- `bakin install <component>`

Important behavior:

- Prefer command-specific views where users scan rows often.
- Use `GenericResultView` only for unusual or low-traffic payloads.
- Avoid nested cards and repeated headings.

Verification:

- existing CLI tests for affected commands
- new focused render tests for each migrated view family

Commit checkpoint:

- `refactor: migrate cli list report output`

### Slice 6: Documentation and Review

Update persistent docs after implementation:

- `.claude/specs/cli-tui-output-style.md`
- `.claude/knowledge/doctor-and-health-checks.md`
- relevant README/help docs if command output examples change

Run review and broad checks:

- `bun test --isolate tests/cli`
- targeted doctor/onboarding/core tests
- `bun run typecheck`
- manual render checks at 72, 100, and 132 columns

Commit checkpoint:

- `docs: record cli tui output integration`

## Testing Strategy

Use layered tests:

- Pure unit tests for status mapping, row grouping, prompt defaults, and
  selection state transitions.
- Ink `renderToString()` tests for reusable primitives and command-specific
  views.
- Command-level tests for JSON/plain/Ink routing boundaries.
- Existing behavior tests for doctor repair and onboarding side effects.
- Manual gallery comparison for visual regressions before opening the PR.

Avoid full-screen snapshots except for tiny stable primitives. Prefer targeted
assertions for header presence, status tokens, section labels, wrapping, next
actions, prompt defaults, and absence of repeated headings.

## Risks

- Current production output has scattered direct `console.log` calls in
  `cli/bakin.ts`; migrating every command at once would mix output refactor with
  runner architecture work.
- Ink's default `MultiSelect` layout is tight at narrow widths. We should either
  accept it for this pass or customize the primitive in a separate focused slice.
- Some existing tests may assert old bracket status labels such as `[OK]`; those
  should move to component-level assertions when the user-facing output changes.
- The global Bakin header must not leak into JSON, non-TTY plain output, or
  command outputs that are intentionally stream-like.

## Open Decision

Should the real Antfly/search-adapter onboarding prompt default to `y/N` as
shown in the mock, or keep the current code behavior that defaults to yes?

Recommendation: default to `y/N`. Installing Antfly through Homebrew is an
external host mutation, and onboarding should make that consent explicit unless
the user passed `--yes`.
