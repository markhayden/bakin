# Form components overhaul — approved specification

Status: approved foundation and visual baselines implemented; full conformance
passed. PR #914 is ready for final CI verification.
Date: 2026-09-22.
Evidence: [source audit](form-components-overhaul-audit.md).
Plan: [implementation plan](form-components-overhaul-plan.md).

The user explicitly approved this specification and the detailed implementation
plan, including local checkpoint commits. The user subsequently approved the
exact 66-path visual inventory and requested PR preparation with passing checks.

## Objective and confirmed scope

Give Bakin's form controls a coherent public presentation and behavior contract
that can be demonstrated and verified in Storybook before application UI
adoption. Prioritize clear APIs and reduced styling debt. No compatibility
shims or parallel control systems.

Confirmed by the user:

- Audit every form-control family.
- Implement text and selection first: Input, Textarea, InputGroup, Select,
  searchable/multiple selection, and Field/Form composition.
- Record checkbox/radio/switch and specialized control findings for a later
  implementation phase.
- Application UI migration follows completion of the core enhancements.

The specification retains Base UI, existing Bakin semantic colors/fonts,
visible external field labels, focused SDK entrypoints, and existing
form/dirty-state ownership. Floating labels, an underline-only appearance,
and a new form-state library are outside this phase.

## Approved presentation extension

The user explicitly approved this reusable extension on 2026-09-22.

Closest contracts are `CanonicalUsage` in
`storybook/public/primitives/{input,textarea,input-group,select}.stories.tsx`.
They do not provide a shared size/appearance API. Local overrides cannot
provide a consistent reusable public contract across the controls.

Approved contract:

| Axis | Approved values | Default / meaning |
| --- | --- | --- |
| Size | `sm`, `md`, `lg` | `md`; single-line heights 32/36/44px |
| Variant | `outlined`, `filled`, `ghost` | `outlined`; visible boundary for ordinary forms |
| Filled | Contrasting surface | Same geometry and validation semantics |
| Ghost | Transparent resting surface | Compact toolbar/inline use; visible hover, focus and invalid state |
| Textarea size | Padding and typography | Does not impose a fixed single-line height |

The user also explicitly approved aligning Button `lg` and `icon-lg` at 44px
(previously 40px). Update `storybook/public/primitives/button.stories.tsx` —
`Sizes`, its public guidance and focused regression coverage. This is a core
style enhancement within this effort; existing large buttons grow by 4px.
Small and medium peer controls already align at 32px and 36px.

Safeguards: keep actual accessible labels, keyboard focus, associated errors,
readonly/disabled semantics, responsive layout and plugin ownership. No routing
changes. Review the complete matrix in public Storybook before application
adoption. This is a reusable system extension, not a permanent exception.

The exact token delta, any new exports, and visual baseline changes must be
enumerated for review. Generic approval of this effort does not authorize
arbitrary new tokens or baseline replacement.

## Approved searchable-selection extension

The user explicitly approved a dedicated public Combobox alongside Select on
2026-09-22, including:

- Single and multiple selection, removable chips, and clear actions.
- Grouped and rich options.
- Local filtering and caller-controlled async loading, error, and empty states.
- Reuse of Base UI behavior and Bakin plugin portal ownership.
- Keyboard, label/error association, narrow-layout, and form-submission proofs.

User-created options and virtualization are explicitly deferred. The component
does not own data fetching or persistence. Query text and committed selection
remain separate values.

Closest existing contracts are `CanonicalUsage` in
`storybook/public/primitives/select.stories.tsx` and
`storybook/public/navigation/command.stories.tsx`. Neither defines editable
search plus committed form values, so this is an approved reusable system
extension. Publish through the existing focused UI entrypoint with a dedicated
public story; enumerate the exact exports in the implementation plan.

## Approved text-entry recipes

The user approved all recommended InputGroup recipes:

- Clearable input.
- Password reveal.
- Leading/trailing icons and prefix/suffix units.
- Loading indicator.
- Character count.
- Local actions such as copy and submit.

Use canonical compositions with working Storybook interactions and state
coverage. Retain one editable control, its accessible label, and the group's
shared presentation boundary. Define action labels, keyboard order, focus
retention and readonly/disabled behavior in the detailed contract. Loading
indicates work in progress without silently discarding or locking the value.
Counts must document their counting semantics and relationship to maxLength.
Masks and specialized numeric/currency editors are deferred.

## Approved multiple-selection presentation

The user approved a compact first-selected-label plus “+N more” summary for
Select. Combobox uses removable chips that wrap with the search input, with an
optional compact summary mode for toolbars or constrained spaces. Every
selection remains accessible in the popup in either presentation.

Presentation must not change selection values or form serialization. Long
labels must stay inside the available width; the summary exposes the full
selection through an accessible description and popup state. Keep clear and
chip-removal buttons outside any trigger button to avoid nested interactive
elements. Multiple-selection chip containers use the selected size as their
minimum height and may grow; the single-line height is not a clipping boundary.

## Approved Textarea height behavior

The user approved manual vertical resizing by default with bounded auto-grow
as an opt-in mode. The default field starts at three rows. Auto-grow has
configurable minimum/maximum rows and scrolls internally once it reaches the
maximum. Both modes support all approved sizes and variants; horizontal
resizing must not break the containing layout.

The implementation plan must define the relationship between native `rows`,
auto-grow bounds, manual resizing and InputGroupTextarea. Cover empty and
prefilled values, typing/paste/deletion, controlled value changes, reset,
container-width changes, and font/text scaling. The current unconditional
`field-sizing-content` plus fixed minimum height must not override explicit
row sizing in the new manual mode. Keep behavior consistent across the
repository's supported browser projects.

## Approved presentation ownership

The user approved explicit size/variant props on standalone controls and
InputGroup ownership of its input/addon appearance. Form and Field continue
to own layout, labels, validation and submission. Do not add form-wide or
field-wide inherited visual defaults.

Use private shared styling and a narrowly scoped group context where required
so the outer shell owns border, background, size and focus treatment. Group
children must not independently choose a conflicting size or appearance.
This is component composition, not an application theme provider.

## Proposed public API contract for spec review

These details make the approved features implementable. They become the
contract when this specification is approved; exact implementation tasks and
checkpoint commits follow in the plan.

### Shared presentation

Export `ControlSize = 'sm' | 'md' | 'lg'` and
`ControlVariant = 'outlined' | 'filled' | 'ghost'` from the existing
`@makinbakin/sdk/ui` entrypoint. Reuse these types rather than introducing a
different size/variant enumeration for every field.

- `Input`, `Textarea` and `InputGroup`: `size?: ControlSize` and
  `variant?: ControlVariant`, default `md` / `outlined`.
- `SelectTrigger`: same props; replace `default` with `md` in its existing
  size contract without an alias. Keep existing exported prop/type names
  where they describe the same component, referencing the shared scale.
- `ComboboxControl`: the visual group around input/chips/trigger/clear; owns
  the same size/variant contract.
- `InputGroupInput`, `InputGroupTextarea` and `ComboboxInput`: consume their
  owning group's appearance; do not expose conflicting visual size/variant
  props. Preserve native input/textarea behavior and refs.
- `InputGroupButton`: preserve its existing explicit inset-action sizes;
  document matching recipes for each outer control size. It must fit without
  clipping or reducing the meaningful pointer target below 24px.
- `Input` and the default-input form of `FieldControl` reserve `size` for
  visual sizing. Expose the native numeric attribute as `htmlSize`; strip
  presentation props before forwarding to DOM. This is a deliberate API
  cleanup, not a compatibility alias.
- Default `FieldControl` styling uses the same recipe. When `render` supplies
  a control, put presentation props on that rendered control and keep
  FieldControl responsible for association; do not apply a second shell.

Width is distinct from size. Input/Textarea/InputGroup keep their existing
full-width behavior. Add `width?: 'full' | 'auto'` to SelectTrigger and
ComboboxControl: SelectTrigger defaults to `auto` (its existing behavior),
ComboboxControl to `full`. Ordinary form stories explicitly use `full` for
Select; toolbar stories demonstrate `auto`. Both remain bounded by their
container. Group wrappers shrink correctly inside flex/grid layouts.

### Textarea height API

Use a discriminated mode so contradictory props are not accepted:

- Manual mode: `autoSize?: false`, native `rows` default 3, vertical resize.
- Auto mode: `autoSize: true`, `minRows?: number` default 3,
  `maxRows?: number` default 10; no native `rows` or manual resize handle.
- Bounds are positive whole rows with `maxRows >= minRows`. Reject invalid
  configuration clearly during development rather than silently ignoring it.
- The selected size controls inset and typography in both modes. Height is
  measured from actual line height, padding and border; no fixed pixel
  minimum overrides the requested rows.
- At maximum auto height, scroll the textarea internally. Deleting content
  shrinks it down to the minimum. Recompute after controlled changes, reset,
  width and font changes; do not change the value or caret while measuring.
- InputGroupTextarea honors the same height mode; the group grows with it.

Choose the smallest cross-browser implementation during planning. Native CSS
content sizing alone is acceptable only if the supported browser projects
prove identical required behavior. Do not add a textarea library by default.

### Select

Retain Base UI's composable root, item and popup behavior. Preserve typed
single/multiple values, controlled/uncontrolled state and event details.
Document multiple selection with an explicit summary composition through
SelectValue's existing render function; a separate summary component is not
needed unless the implementation demonstrates reusable behavior beyond that.

Keep grouping, separators, disabled options, typeahead, scroll affordances,
alignment and popup positioning available. Rich options may contain an icon
or avatar, primary label and description; the primary label supplies the
selected display and typeahead text. Do not put buttons or links in options.

Distinguish `null` (no selection/placeholder) from an intentionally selectable
empty-string option. Clearing a required selection must expose validation,
not silently select the first option. No selection mutation on open, hover,
focus, popup close, loading, or catalog refresh.

### Combobox

Use Base UI's existing generic value contract, including `multiple`, `value`,
`defaultValue`, `onValueChange`, `inputValue`, `onInputValueChange`, `items`,
`filter`, `itemToStringLabel`, `itemToStringValue`, `isItemEqualToValue`,
`name`, `required`, `disabled` and `readOnly`. Do not replace it with a second
state machine or allow free text to become a selected value.

Proposed public values (each with its corresponding Props type):

`Combobox`, `ComboboxControl`, `ComboboxInput`, `ComboboxTrigger`,
`ComboboxClear`, `ComboboxValue`, `ComboboxContent`, `ComboboxList`,
`ComboboxItem`, `ComboboxGroup`, `ComboboxLabel`, `ComboboxEmpty`,
`ComboboxStatus`, `ComboboxChips`, `ComboboxChip`, `ComboboxChipRemove`.

- Root and Value preserve Base UI responsibilities. `ComboboxControl` wraps
  Base UI InputGroup and provides the Bakin visual shell.
- `ComboboxContent` composes portal, PluginPortalBoundary, positioner and
  popup; positioning options follow the existing SelectContent convention.
- Items include a non-color selected indicator. Labels name groups; field
  labels continue to come from FieldLabel. Lists accept Base UI's render
  callback for filtering and grouped collections.
- Chips are inside the control, with a borderless input and separately
  labelled remove buttons. Compact summary is a canonical composition of
  Value plus the input; it retains an editable query and popup access rather
  than hiding keyboard navigation behind an unexplained count.
- Clear is a separate sibling button, never inside a trigger button. Removal
  announces the change and returns focus predictably to the input or next
  chip according to the underlying primitive's behavior.
- Use stable primitive IDs where possible. Object-valued stories demonstrate
  explicit label/value serialization and identity comparison.
- Local filtering uses the underlying supported filter. Async filtering uses
  caller-supplied results with `filter={null}`; callers own requests, debounce,
  cancellation and stale-response protection. The async story demonstrates
  stale responses being ignored with deterministic fixtures, without live IO.

Do not export raw positioning internals, a second portal API, virtualization,
creatable-option behavior, or a generic fetch abstraction in this phase.

### Loading, empty, error and unavailable values

| Situation | Required behavior |
| --- | --- |
| No selected value | Show the placeholder; keep the visible field label |
| No configured choices | Explain that no choices are available; no fake selectable empty item |
| Query has no matches | Announce no matches for the current query; retain the query and existing selection |
| Loading | Announce progress; do not show “no results” at the same time or discard selections |
| Load failed | Explain the failure; provide a real caller-owned retry action outside listbox options |
| Selected option absent from results | Preserve selected value and known label; filtered-out does not mean unavailable |
| Caller confirms selected option unavailable | Show explicit unavailable context and recovery; never silently clear or substitute |
| Clearing | Set single selection to null or multiple to an empty array; preserve form validation semantics |

ComboboxStatus remains mounted during updates so announcements are reliable.
Use associated field errors for invalid values, and status feedback for option
loading; these are different concerns. Retry inside an overlay must be covered
by keyboard/focus tests. No placeholder or empty-state item masquerades as a
selectable value.

### InputGroup recipe behavior

Recipes compose the existing kit. Do not add seven competing high-level input
components solely to demonstrate seven layouts.

| Recipe | Required interaction |
| --- | --- |
| Clear | Label the button for its field; set empty value through the normal change path; return focus to input; disable mutation for readonly/disabled |
| Password reveal | Use a real button with changing Show/Hide accessible name; preserve value, selection and autocomplete semantics; never submit the form |
| Icons and units | Decorative icons are hidden from accessibility APIs; meaningful units are also explained in associated text |
| Loading | Announce actual in-flight work; stable geometry and reduced-motion behavior; loading does not imply disabling the input |
| Count | Use UTF-16 code-unit count to agree with native maxLength, documented explicitly; no live announcement on every keystroke; show limits and invalid external values honestly |
| Copy | Use the existing CopyButton contract where composition supports it; report actual success/failure rather than simulating success |
| Submit | Use native form/Enter behavior and the existing duplicate-submission guard; disabling the action alone does not disable typing |

Readonly fields remain focusable, selectable and copyable. Mutating actions
(clear, remove, submit where editing is required) are unavailable; inspecting
or copying existing content remains possible. Disabled controls preserve
native disabled behavior and are not merely made translucent.

## Visual implementation constraints

The separately approved `semantic.color.border.control` token is the only new
public token; no new entrypoint is proposed. Reuse semantic control
radius, typography, focus, danger, disabled opacity and motion tokens.
Compute 44px from the existing 36px control token plus the 8px spacing token;
use the existing 32px token-backed spacing for small controls. Keep the shared
recipe private; do not publish a bag of arbitrary CSS values.

- Outlined: canvas background and visible control border (at least 3:1 contrast).
- Filled: elevated surface fill with all borders transparent at rest, including
  the bottom edge, as explicitly requested in the user's screenshot review.
  Reserved border space allows a complete invalid border without layout shifts.
  Identify the field through its visible label and fill; the resting 3:1 border
  claim applies only to outlined. Keep focus and error treatments visible.
- Ghost: transparent at rest, neutral surface hover and visible keyboard
  focus/invalid state. Reserve border space so interaction does not shift text.
- Focus uses the established visible outline. Invalid state remains visible
  with focus and has associated explanatory text; color alone is insufficient.
- Use full text contrast for readonly values; readonly is not disabled.
- Group disabled treatment applies once rather than multiplying opacity
  through each child. Addon buttons keep their own visible focus indicators.
- Nominal single-line heights are 32/36/44px at the standard text size.
  Accessibility text enlargement may increase height to avoid clipping.
- Preserve 16px mobile input text behavior and validate 200% text, 320px
  containers, forced colors and reduced motion. Popup options may wrap.

Visual review must include all three appearances on relevant parent surfaces.
If existing tokens cannot provide a usable boundary/contrast for a variant,
report the measured mismatch and propose a precise token change for approval;
do not quietly add colors or waive accessibility checks.

## Storybook coverage definition

“Full coverage” means every supported API axis and state has an executable
example, every meaningful interaction has assertions, and representative
compositions have browser/visual evidence. It does not mean asserting every
upstream internal detail or multiplying redundant screenshots.

| Story family | Required additions / coverage |
| --- | --- |
| Input | Canonical controls for size/variant; 3×3 matrix; native email/search/password/number/date hints; readonly, disabled, required, invalid; controlled/uncontrolled and reset |
| Textarea | 3×3 presentation matrix; manual rows/resize; bounded auto-grow; paste/delete/reset/controlled updates; long content and narrow wrapping |
| InputGroup | 3×3 matrix and matching buttons; all seven approved recipes; inline/block addons; multiline; readonly/disabled/error; action-only disabled |
| Select | 3×3 matrix, full/auto width, single/multiple summary, rich/grouped/disabled options, placeholder/none, long content, controlled/uncontrolled reset, keyboard/typeahead, overlay positioning |
| Combobox (new) | CanonicalUsage first; size/variant controls and matrix; single; multi chips/compact; grouped/rich/object values; clear; async status/retry/no-match; unavailable value; readonly/disabled/error; form/overlay integration |
| Field/form composition | Each control paired with label/help/error, required/optional semantics, native/server/async validation, successful submit, failed-submit recovery and reset |
| Button | Updated lg/icon-lg sizes; peer alignment across all field sizes; no clipping with icons/long labels |
| Representative recipes | Form-in-drawer and settings form prove popup focus, responsive layout and unchanged submission/dirty-state ownership |

Comparison stories may use Storybook support wrappers; CanonicalUsage remains
minimal and SDK-only. Add docs descriptions, real arg controls, play assertions
and `bakinCoverage` axes. New public exports must be demonstrated and recorded
in the API inventory; do not grandfather their coverage.

Select/Combobox keyboard proofs include open, arrows, Home/End where supported,
Enter, Escape, Tab, disabled option skip, focus restoration, typeahead/query,
chip removal and IME composition. Do not intercept IME Enter to submit or
prematurely commit an option. Base UI retains behavior ownership.

Form proofs assert actual submitted values and reset outcomes, not only
attributes: single and multiple selection, object serialization, readonly and
disabled fields, controlled and uncontrolled cases. Controlled examples own
their reset state explicitly.

## Storybook-first acceptance criteria

- CanonicalUsage remains a minimal working example using focused SDK imports.
- Every supported size and appearance is available through Storybook controls
  and visible together in comparison stories.
- State coverage includes empty/value, hover, focus, required, invalid,
  readonly, disabled and applicable busy/loading/error states.
- Composition stories demonstrate labels, help, errors, addons, peer buttons,
  multiline entry, ordinary form submission and controls inside overlays.
- Selection stories cover keyboard navigation, disabled items, grouping,
  long labels, dismissal/focus restoration and all approved selection modes.
- Narrow 320px and 200% text layouts retain content, focus and popup bounds.
- Supported controls submit named values and reset correctly in controlled
  and uncontrolled examples where applicable; query text is not mistaken for
  a committed selection.
- Size/variant selection requires no per-consumer CSS overrides.
- Public docs explain when each variant and selection pattern should be used.
- Existing domain pickers and host/plugin consumers remain buildable. Any
  unavoidable mechanical API edit is explicitly scoped separately from UI
  redesign; no compatibility shim is added.
- Browser evidence accompanies any intended visual change; baselines are
  updated only after exact approval under the repository conformance contract.

## Architecture and project structure

- `packages/ui/src/primitives/`: low-level controls and private shared styles.
- `packages/ui/src/forms/`: field association, grouping and submission.
- `packages/ui/src/index.ts` and `packages/sdk/src/ui/index.ts`: focused public
  exports; no new public entrypoint is assumed.
- `packages/sdk/src/patterns/`: existing domain consumers; follow-up adoption.
- `storybook/public/primitives/` and `storybook/public/forms/`: executable
  public contracts; helpers remain under `storybook/support/`.
- `tests/ui/primitives/`, `tests/ui/forms/`, browser/visual suites: evidence.
- `packages/ui/tokens/*.tokens.json`: authoritative token source if needed.
- `design-system/public-api.json`: reviewed export inventory.

Retain React 19, the installed Base UI foundation (1.4.1 installed;
`^1.3.0` declared), Bun
1.3.13, TypeScript, semantic token utilities, and existing class composition.
Resolve installed dependency capabilities before coding; do not add a second
component library to copy its appearance.

## Code style

Use existing small composable exports, single quotes, no semicolons, and
semantic classes. Public examples import SDK entrypoints. For example, this
existing form composition remains the baseline:

```tsx
import { Field, FieldDescription, FieldLabel, Input } from '@makinbakin/sdk/ui'

export function WorkflowName() {
  return (
    <Field name="workflowName">
      <FieldLabel requirement="required">Workflow name</FieldLabel>
      <Input required autoComplete="off" />
      <FieldDescription>Shown in the workflow list.</FieldDescription>
    </Field>
  )
}
```

## Commands and verification strategy

Baseline checks already passed; see audit. Implementation will use meaningful
behavior tests and browser assertions, not tests that merely repeat classes.

```sh
bun test --isolate tests/ui/primitives/text-field-primitives.test.tsx tests/ui/primitives/selection-primitives.test.tsx tests/ui/forms/form-composition.test.tsx
bun run ui:conformance --quick
bun run ui:dev
bun run ui:test:stories
bun run ui:test:browsers
bun run ui:test:visual
bun run ui:build:public:verify
bun run ui:conformance --full
```

The full conformance command already includes quick checks, lint, repository
tests, CSS/vendor/plugin/host builds, payload checks, deterministic Storybook,
story interactions/accessibility, canonical Chromium visuals, cross-browser
behavior, plugin fixture checks and published docs. Run focused suites while
iterating, then this aggregate once at final handoff; do not repeat its
constituent suites without a new change or failure to investigate.

Browser behavior targets Chromium, Firefox and WebKit as defined in
`playwright.browser.config.ts`; pixel evidence uses the repository's canonical
container workflow. Add focused files for approved new behavior. Validate
keyboard, focus, overflow, accessibility, console and computed geometry.
Follow repository test isolation and React act conventions; never touch live
Bakin data.

The initial audit verified source, existing coverage, focused tests and quick
conformance. Before changing styles, capture existing affected Storybook
behavior/visual evidence and report baseline failures separately. Do not
describe the initial audit as complete browser verification.

## Boundaries

- Always: Storybook/public contract first; existing semantic tokens where
  adequate; native and Base UI semantics; associated labels/errors; plugin
  portal ownership; docs updated with the change; tests before checkpoints.
- Ask first: exact reusable extensions not yet approved, new public tokens,
  entrypoints, accessibility suppressions, performance-ceiling increases,
  visual baseline replacement, or changes expanding confirmed scope.
- Never: product-wide UI migration in this phase, a new form-state framework,
  parallel keyboard engine, compatibility shims, live data mutation, unrelated
  cleanup, or regenerating ratchets merely to make failures pass.

## Documentation and commit requirements for the next phase

Documentation deliverables:

- `.claude/knowledge/style-guide.md`: size/variant use, explicit presentation
  ownership, readonly/disabled distinctions, selection and textarea choices.
- `.claude/knowledge/design-system.md`: clarify that contextual control sizes
  live within the existing visual system, not separate density themes.
- `docs/src/content/docs/extending/ui/overview.md`: exact public props,
  composition examples, selection decision table, async responsibility,
  native htmlSize and textarea migration notes.
- Public stories: executable examples, controls, coverage and usage guidance.
- `design-system/public-api.json`: reviewed new values/types and modified
  contracts; no increase to legacy allowances.
- `.claude/knowledge/ui-patterns.md`: reviewed; update only if new interaction
  lessons warrant durable guidance, without duplicating the style guide.
- `README.md`: reviewed for impact; no setup or top-level command changes are
  proposed, so no update is currently required.

The
implementation plan must enumerate dependency-ordered commits with exact
file groups, acceptance checks and rollback boundaries. Natural checkpoints
are approved audit/spec/plan, executable Storybook contract, each working
control family with its tests/docs, selection extensions, and final browser
evidence. Do not create commits that reference unavailable exports or claim
untested proposed behavior. Roll back dependent commits in reverse order;
avoid splitting shared API changes from required compilation fixes.

The detailed plan is linked above and approved. Execution evidence is recorded
in `tasks/evidence-form-components-overhaul.md`.
