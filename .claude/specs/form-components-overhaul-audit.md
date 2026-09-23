# Form components overhaul — audit

Date: 2026-09-22. Baseline: `1ecbc0b90`.
Status: audit reconciled, implementation and approved baselines complete; full conformance passed.
The inventory and findings below describe baseline `1ecbc0b90`; implementation
resolution is recorded at the end of this document.
Scope decision: audit all form controls; implement text and selection first.
Application UI migration is a separate follow-up.

## Evidence and classification

Storybook is the current public contract. A capability exposed by an upstream
type is not automatically a documented, tested Bakin pattern. Findings below
distinguish missing implementation, missing contract/coverage, and downstream
migration work. Missing coverage is not a claim that behavior is broken.

No implementation, token, API inventory, or screenshot baseline changed during
this audit. The pre-existing modification to
`packages/host/src/api/_embedded-assets-static.ts` is unrelated.

## Current inventory

| Family | Present today | Gap / disposition |
| --- | --- | --- |
| Input | Base UI Input; native type, autocomplete, inputMode, required, readonly, disabled, invalid attributes; one outlined treatment | No visual size/variant API. Input `size` currently belongs to the underlying native contract; resolve that collision explicitly. Implement first. |
| Textarea | Native textarea; content sizing, minimum height, vertical resize; FieldControl association | No size/variant API; clarify rows versus auto-growth and min/max sizing. Implement first. |
| InputGroup | Inline/block addons, text, buttons, input and textarea; shared focus/error border | Root fixes height and appearance; children override primitive styling. Define one owner for size/variant and avoid conflicting root/child settings. Implement first. |
| Select | Base UI root, groups, separators, disabled choices, selected indicator, placeholder, scrolling, portal ownership | Trigger has `sm/default` only; no appearance variants. Multiple selection is exposed by types but absent from the documented pattern. Implement first. |
| Searchable selection | Command primitive exists; no public Combobox export found in kit/API inventory | New reusable form-selection contract needed; Command alone does not define editable value, selection, chips, or form semantics. Proposed first-phase extension. |
| Field/Form | Label, description/error association; required/optional label marker; async validation; fieldsets; busy submission | Preserve this architecture. Extend default FieldControl styling consistently; expand lifecycle and new-control integration proofs. First phase. |
| SearchInput | Controlled query, clear behavior, expandable width, InputGroup composition | No shared size/variant API; record downstream adoption decision. Preserve query/focus behavior. |
| AgentSelect | Controlled agent/team choice; avatars, grouping, none/assigned entries | No size/variant props; uses Select. Follow-up adoption rather than product migration now. |
| ModelSelect | Controlled provider grouping; default choice and unavailable catalog stories | Hardcodes `size="sm"`; no shared presentation API. Follow-up adoption. |
| Checkbox | Checked, unchecked, indeterminate, disabled, readonly, invalid; 24px control | No visual size API; audit consistent label targets and form reset. Defer implementation; do not force text-field variants onto a checkbox. |
| RadioGroup/Radio | Base UI roving choice; fixed 24px control, group naming, state styling | No size or layout choice API beyond className. Document grouped descriptions, orientation, reset and error coverage. Defer implementation. |
| Switch | Boolean semantics, readonly/disabled, `sm/default`; 24px interaction target | Size naming differs from proposed text contract. Checked state must remain clear without color alone. Defer implementation. |
| FileInput | Button trigger, hidden native picker, drop intake, accept filtering on drops, multiple and repeat selection | This is file intake, not a full native form value control. Input's file story and FileInput need a clear usage decision. Deferred audit follow-up: rejection feedback and upload lifecycle ownership. |
| ColorInput/ColorPicker | Native arbitrary hex swatch and separate fixed-palette choice | ColorInput is fixed at 32px; specialized controlled semantics. Keep distinct from text-field variants; defer. |
| AssetPicker/AssetLibraryPicker | Domain picker, loading/empty/error and attach/relink stories | Reuse domain contracts; defer presentation adoption until foundation stabilizes. |
| Date/time/numeric | Existing consumers use Input with date, datetime-local and number types | No standalone DatePicker, NumberField or Slider export found in public kit inventory. Record as potential system gaps, not automatic commitments to build widgets. |
| PluginSettingsRenderer | Schema-driven text/select/control composition and save feedback | Consumer of foundation; document regression coverage and later adoption. No schema or product redesign in this phase. |
| SaveBar/UnsavedChangesDialog | Existing save/dirty/retry and routing contracts | Preserve; cover representative form integration. No parallel dirty-state system. |

Primary source paths: `packages/ui/src/primitives/`, `packages/ui/src/forms/`,
`packages/ui/src/patterns/search-input.tsx`,
`packages/sdk/src/patterns/{agent-patterns,picker-patterns,plugin-settings-renderer}.tsx`,
`packages/ui/src/index.ts`, and `design-system/public-api.json`.

## Closest public Storybook contracts

| Story file under `storybook/public/` | Exports inspected | Coverage finding |
| --- | --- | --- |
| `primitives/input.stories.tsx` | CanonicalUsage, StatesAndMobileModes | State examples and typing proof exist; no size/variant matrix. Metadata omits text-200. |
| `primitives/textarea.stories.tsx` | CanonicalUsage, ContentAndStates | Readonly/disabled/invalid association exists; no size/variant or explicit bounded-growth matrix. |
| `primitives/input-group.stories.tsx` | CanonicalUsage, Adornments, LocalSubmitAction | Addon and local-action patterns exist; no shared geometry/variant controls. |
| `primitives/select.stories.tsx` | CanonicalUsage, States, Behavior | Grouping, long option, empty-string choice, keyboard selection and compact trigger exist; no multiple selection, search, rich-option contract, or size/variant matrix. |
| `forms/form-composition.stories.tsx` | CanonicalUsage, Overview, AsyncValidation, SubmissionWorkflow | Strong existing foundation; extend integration rather than replacing it. |
| `primitives/{checkbox,radio-group,switch}.stories.tsx` | CanonicalUsage, States, Behavior | Existing state/keyboard coverage; review complete form lifecycle in later phase. |
| `primitives/file-input.stories.tsx` | CanonicalUsage, States | Existing intake pattern; differentiate from native form submission. |
| `forms/color-input.stories.tsx` | CanonicalUsage, PairedHexField | Native swatch plus textual value composition already exists. |
| `forms/color-picker.stories.tsx` | CanonicalUsage, PaletteChoices | Fixed choices already have a separate pattern. |
| `agents/agent-select.stories.tsx` | CanonicalUsage, AgentFiltering, AssignmentAndFiltering | Domain filtering here is assignment filtering, not a reusable typed-search Combobox contract. |
| `forms/model-select.stories.tsx` | CanonicalUsage, GroupedCatalog, UnavailableModelCatalog | Grouped and empty/unavailable catalog cases exist. |

## External comparison

Official references consulted on 2026-09-22. These are design evidence, not
dependencies to add or a requirement to copy each library's feature set.

| Reference | Relevant pattern | Recommendation for Bakin |
| --- | --- | --- |
| [MUI TextField](https://mui.com/material-ui/react-text-field/) | Shared field appearances, sizing, adornments, helper/error text, controlled/uncontrolled examples and multiline bounds | Adopt consistent presentation across controls and explicit composition examples. Keep existing Field architecture; do not add floating labels by default. |
| [MUI Select](https://mui.com/material-ui/react-select/) | Shared input styling, multiple selection, grouped options, native alternative; advanced search is a separate component | Keep bounded choice separate from editable search. Make multi-value rendering and none/placeholder behavior deliberate. |
| [MUI Autocomplete](https://mui.com/material-ui/react-autocomplete/) | Search/filtering, multiple values, async options and custom option rendering | Define selected value separately from query, async state, and option identity. Decide creatable/virtualized scope explicitly. |
| [shadcn Select](https://ui.shadcn.com/docs/components/base/select) | Composable trigger/popup/item structure and field error association | Bakin already uses this composition shape; preserve it and expand the supported presentation contract. |
| [shadcn InputGroup](https://ui.shadcn.com/docs/components/base/input-group) | Context, actions and addons composed around one editable control | Extend Bakin's existing group instead of adding competing prefix/suffix implementations. |
| [shadcn Combobox](https://ui.shadcn.com/docs/components/base/combobox) | Editable selection with multiple values and chips | Add a dedicated reusable searchable-selection contract if approved; define chip removal and accessible names. |
| [Chakra Input](https://chakra-ui.com/docs/components/input) | Independent size and variant axes; outline/subtle/flushed; addon and clear compositions | Use a small purposeful size scale. Filled corresponds to a surface treatment; underline-only need not be copied. |
| [Radix Themes TextField](https://www.radix-ui.com/themes/docs/components/text-field) | Three sizes, surface/classic/soft appearances and leading/trailing slots | Demonstrate geometry with addons and peer buttons, not isolated bare inputs only. |
| [Base UI Select](https://base-ui.com/react/components/select) / [Combobox](https://base-ui.com/react/components/combobox) | Existing behavioral foundation supports selection primitives | Reuse the installed foundation and verify its installed version. Avoid implementing an independent keyboard/focus engine. |

## Prioritized findings

1. **P1 — Inconsistent geometry and appearance APIs.** Input/Textarea/InputGroup
   have no visual size or variant contract; Select uses `sm/default`. Define one
   text-and-selection scale with explicit defaults and browser evidence.
2. **P1 — Shared styling has several owners.** FieldControl imports Input's
   class string; InputGroup draws a separate shell and strips child styling.
   Design inheritance/ownership before introducing variants to avoid doubled
   borders, conflicting heights and drift.
3. **P1 — Searchable selection lacks a public form contract.** Introduce a
   dedicated Combobox pattern if approved, preserving plugin portal ownership.
4. **P1 — Exposed Select capabilities exceed documented usage.** Either specify
   and prove multiple selection or narrow the intended public behavior. Do not
   mistake the existing upstream API for missing implementation.
5. **P1 — Coverage must follow the contract matrix.** Add representative
   browser proofs for every size/variant, errors, readonly versus disabled,
   focus restoration, reset and form values; labels and declarations alone are
   insufficient. Existing passing tests are retained where behavioral.
6. **P2 — Width and popup presentation rely on local choices.** Select is
   fit-content; stories explicitly force full width. Popup uses anchor width,
   a minimum width and viewport maximum. Define field versus inline sizing,
   collision behavior and long labels without requiring per-consumer CSS.
7. **P2 — Empty is not one state.** Distinguish placeholder, explicit none,
   no available choices, no search results, loading and load failure. Preserve
   a selected label when an async catalog changes or excludes that value.
8. **P2 — Rich options need a contract.** Avatars already appear in domain
   selectors. Specify primary text, supporting description, disabled reason,
   selected rendering and typeahead text; avoid interactive descendants in an
   option or nested clear buttons inside a trigger button.
9. **P2 — Input actions need canonical recipes.** Clear, reveal password,
   prefix/suffix units, loading, character count and local actions should reuse
   InputGroup. Define readonly/disabled action behavior and focus retention.
10. **P2 — Browser-native behavior needs deliberate proof.** Include autofill,
    mobile keyboard hints, IME composition, reduced motion, forced colors,
    narrow/zoomed layouts and actual computed heights. These have not been
    verified by the source audit.
11. **P2 — Documentation must distinguish density from size.** Existing guidance
    permits one compact-professional system. Contextual sizes can extend it
    without adding a user-selectable density/theme system.
12. **Follow-up — Specialized consumers pin old decisions.** AgentSelect,
    ModelSelect, SearchInput and settings composition need later adoption.
    Core style changes can affect their rendering immediately; include
    regression evidence even while deliberately postponing UI migration.

## Baseline verification

- PASS: `bun test --isolate tests/ui/primitives/text-field-primitives.test.tsx tests/ui/primitives/selection-primitives.test.tsx tests/ui/forms/form-composition.test.tsx`
  — 18 tests, 75 assertions.
- PASS: `bun run ui:conformance --quick` — governance, token/API/census and
  ratchet checks, 228 architecture tests, and application TypeScript.
- Not yet run: full conformance, Storybook interaction suite, visual or
  cross-browser checks. No claim of complete browser coverage is made.

## Documentation follow-through

Implementation must update `.claude/knowledge/style-guide.md`, relevant
`.claude/knowledge/design-system.md` guidance, public stories and
`docs/src/content/docs/extending/ui/overview.md`, together with the reviewed
API inventory and approved token artifacts when applicable. Check
`.claude/knowledge/ui-patterns.md` for affected composition guidance.
README changes are conditional on changed setup, commands or top-level product
claims; a component styling extension alone does not currently require one.

The detailed spec is in `form-components-overhaul.md`. Implementation planning
follows resolution and review of the specification.


## Implementation resolution (2026-09-22)

| Requirement / finding | Final contract and evidence |
| --- | --- |
| Sizes, appearances, width and 44px alignment | Input, Select and Combobox SizesAndVariants; InputGroup SizesAndVariants; Button Sizes; form-controls.browser geometry checks |
| Field versus shell ownership | FieldControl shares Input; InputGroup owns size/variant; grouped textarea association unit test and form-groups.browser at 320px/200% |
| Textarea height and native behavior | Textarea BoundedGrowth/SizingFixture; native three rows; bounded measurement hook; three-engine growth/reset/width/text enlargement checks |
| Clear, reveal, adornments, units, loading, count, copy and submit | InputGroup TextEntry/LocalSubmitAction and support/form-input-recipes; built-in CopyButton outcome; native maxLength; readonly/disabled action rules |
| Select multiple, rich text and typeahead | Select MultipleSelection plus Behavior; primary label supplied separately from supporting description; repeated FormData values and explicit reset |
| Search, chips, compact and object IDs | Combobox CanonicalUsage/MultipleSelection/CompactAndObjectValues; object identity unit test and form-selection.browser keyboard/serialization proof |
| Async states and recovery | Combobox AsyncAndUnavailable/AsyncFixture; caller ignores stale completions, separates value from query, explicit unavailable state, retry outside listbox |
| Validation and whole-form lifecycle | Field and form composition FoundationControls; failed save retains draft; native object IDs, controlled selection reset, uncontrolled textarea; IME browser proof |
| Dialog/Drawer and plugin portals | Combobox OverlayFixture; Form in a drawer SearchableControls; portal-containment unit and three-engine focus/containment proofs |
| Surfaces, focus, disabled/readonly/errors | Input SurfaceContexts and Combobox ControlStates; canonical visual candidates and forced-colors/reduced-motion browser coverage |
| Performance | Six JavaScript ceiling adjustments explicitly approved in tasks/form-components-payload-review.md; shared focus CSS keeps the original CSS ceiling |

Installed Base UI does not restore Combobox selection on native form reset.
The public reset recipe therefore controls selection and restores it in onReset.
Form onFormSubmit receives serialized object IDs, not catalog objects. These
are documented composition contracts; no independent selection state engine
or upstream compatibility shim was added.

## Deferred implementation priorities

1. **Next form phase:** Checkbox/RadioGroup/Switch complete submission/reset,
   readonly versus disabled, required/error and group-description lifecycle
   stories. Preserve current toggle semantics; do not apply text-field variants
   to these controls without a separate reviewed contract.
2. **Specialized inputs:** FileInput intake versus native multipart submission,
   clear/reselect and upload failure; ColorInput textual validity and palette
   keyboard behavior; date/time and numeric/currency constraints/locales.
   Existing native Input types remain supported. Masks, a NumberField, calendar
   widgets, user-created options and huge-list virtualization remain deferred.
3. **Product adoption:** SearchInput, AgentSelect, ModelSelect, settings renderer
   and domain pickers can adopt the approved controls in a separate migration.
   Their current stories and snapshots remain regression consumers here.
4. **Lifecycle composition:** build on existing SaveBar/UnsavedChangesDialog
   for dirty navigation; do not duplicate routing or form-state systems.

README and ui-patterns guidance were reviewed: no setup/command/product or
archetype change requires an edit. Public UI overview, style guide, design-system
knowledge and generated SDK API reference carry the author-facing changes.
No product-page migration, dependency, exception, suppression or legacy
allowance was added. The separately approved control-border token is the only
new semantic token. See tasks/evidence-form-components-overhaul.md for receipts
and the separate exact visual-baseline approval boundary.


## Measured contrast finding requiring a separate decision

Canonical Input/SurfaceContexts measurements: primary text 17.50–19.28:1,
focus 8.46:1 and error boundaries 4.65–5.12:1. Reduced motion computes to no
transition. Resting subtle borders measure only 1.90–2.10:1; the existing
semantic token is explicitly intended for nonessential boundaries. Do not
interpret passing text/error checks as a 3:1 resting-control-boundary pass.
A concrete, narrowly scoped new control-border token proposal and canonical
before/after previews are in `tasks/form-components-border-review.md`.
The user subsequently approved this exact color/scope. The implemented token
is `--bakin-color-border-control` (the generator's existing naming convention),
with 3.39:1 against elevated fill and a gating non-text contrast assertion.
Subtle separators retain their existing token. Subsequent screenshot review
explicitly removed all resting borders from filled controls; the resting-border
contrast claim therefore applies only to outlined. Exact PNG scope is approved
and applied (18 new, 47 replacements, one approved candidate retained unchanged).
