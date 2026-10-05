# UI pattern ownership and settings-row composition — #807 / #808

Status: independently reviewed and approved by the maintainer on 2026-10-04.
#807 implementation in progress; #808 remains the separate follow-up.
Reviewed base: `7e92fb21a` on 2026-10-04.
Issues: [#807](https://github.com/markhayden/bakin/issues/807),
[#808](https://github.com/markhayden/bakin/issues/808).
Implementation and commit checkpoints: [PLAN.md](./PLAN.md).

## Objective and agreed scope

Reduce two concrete forms of UI maintenance debt in separate PRs:

1. **#807:** put controlled agent and picker presentation in the private UI
   package, retaining the existing public SDK surface and one implementation.
2. **#808:** remove the settings renderer's dependency on the internal placement
   of switches and labels, using the existing Field composition API.

The maintainer approved these scopes and separate delivery after the issue
review, then approved this spec and plan. There are no external
users to migrate; no compatibility shims, deprecation machinery, dependency
upgrades, or replacement entrypoints are needed. Keeping the supported SDK
imports is the intended architecture, not a compatibility layer.

#810 was closed with an explanation: the page split is already satisfied and
the table-slot rename is declined. Page structure, DataTable slots, generic
forms infrastructure, validation redesign, and unrelated UI cleanup are excluded.

Assumptions: retain current presentation and interactions; preserve existing
schema and persistence behavior; deliver #807 first and #808 on updated main
after #807 merges. Use actual commit dates; earlier backdating requests applied
to earlier tasks. No releases, publishing, installation, or live-service restart.

## Current evidence and ownership

| Concern | Current evidence | Desired ownership |
| --- | --- | --- |
| Agent presentation | `packages/sdk/src/patterns/agent-patterns.tsx` imports React, UI primitives, `cn`, and the color helper. | `packages/ui/src/patterns/agent-patterns.tsx`, re-exported through SDK `/patterns`. |
| Picker presentation | `packages/sdk/src/patterns/picker-patterns.tsx` has the same dependency boundary; no fetch or host store. | `packages/ui/src/patterns/picker-patterns.tsx`, re-exported through SDK `/patterns`. |
| Color validation | `presentation-color.ts` has only these two implementation consumers. | Private helper beside the moved implementations; no new public export. |
| SDK adapters | `asset-library-picker.tsx` owns loading/upload wiring; `plugin-settings-renderer.tsx` consumes SDK schemas and agent presentation. | Stay in SDK; resolve presentation from private UI `/patterns`. |
| Fields | `packages/ui/src/forms/field.tsx` already owns Field, label, description, error, and control; the SDK publishes them. | Keep this API and its Base UI associations. |
| Settings list layout | Renderer line 328 combines responsive columns, subgrid, and descendant switch/label row overrides with `!important`. | Renderer-owned cells and Field-root composition; no internal control targeting. |

## Storybook contract

These existing public stories are the reference before changes:

- `storybook/public/agents/agent-avatar.stories.tsx` — `CanonicalUsage`.
- `storybook/public/agents/agent-status.stories.tsx` — `CanonicalUsage`.
- `storybook/public/agents/agent-select.stories.tsx` — `CanonicalUsage`.
- `storybook/public/forms/asset-picker.stories.tsx` — `CanonicalUsage`.
- `storybook/public/forms/model-select.stories.tsx` — `CanonicalUsage`.
- `storybook/public/forms/color-picker.stories.tsx` — `CanonicalUsage`.
- `storybook/public/forms/form-composition.stories.tsx` — `CanonicalUsage`
  and `Overview` (horizontal Field composition).
- `storybook/public/forms/plugin-settings-renderer.stories.tsx` —
  `CanonicalUsage`, `MessagingSchemaWorkflow`, `BusyAndUnavailable`,
  `AgentTogglesGrid`, and `HighlightedField`.

Contracts: SDK `/patterns` for presentation and renderer, `/ui` for Field and
controls, `/layout` for surrounding page composition. No new public component,
story category, slot name, token, or routing behavior is proposed. Extend evidence
inside the existing story files. The Field primitive may still organize its own
parts internally; this task removes the consumer's dependence on those parts.

## #807 design and acceptance

- Move both implementations and the helper; delete their old SDK source files.
- Use explicit imports from UI implementation modules and `../utils` inside
  the private package. Do not import the UI root barrel from its own patterns,
  and never import the SDK or app back into UI.
- Export the existing values and types through `packages/ui/src/patterns/index.ts`.
  Keep the same names on `packages/sdk/src/patterns/index.ts` as explicit
  re-exports. Do not put them into the base UI root barrel.
- Update the two SDK adapters to the new private owner. No logic changes in
  agent identity, presence, assignment/team helpers, asset selection, model
  selection, keyboard handling, color validation, or upload/data ownership.
- Tests must prove the public and private exports are the same runtime objects,
  preserve the focused API inventory, and guard against app/SDK imports into
  the moved implementation. Retain behavior and package-output coverage.
- Built SDK JS and declarations must work outside monorepo aliases. Host,
  vendor, core-plugin, and official-Bits builds must still resolve `/patterns`.
- No export-inventory, snapshot, or payload-ceiling increase is assumed. Measure
  real build effects with pinned inputs; investigate differences before updating
  any reviewed artifact.
- Carry the picker's existing exception scope and migration record to its new
  path in `design-system/{exceptions,migrations}.json`. Keep all allowance counts,
  approval evidence, and summary budgets unchanged. This is the same recorded
  debt following its implementation, not a new exception or rebaseline.

## #808 design and acceptance

Prefer composition with the current Field roots and neutral, non-interactive
layout cells. The proposed implementation is:

1. Keep the existing named settings-row container and its one/two/three-column
   responsive behavior. The list grid owns columns and shared label/control
   tracks, not control internals.
2. Give each compact scalar a neutral cell spanning the two shared tracks.
   Text/number/select Fields span the label and control tracks through subgrid.
   A horizontal boolean Field occupies the control track as a whole; Field
   itself continues to align its switch and label.
3. Put any compact layout classes on the owned cell or Field root. Remove
   descendant `data-slot=switch` / `field-label` positioning, important row
   overrides, and broad child rules replaced by explicit cell ownership.
4. Keep wrappers absent from standalone scalar Fields and the agent-toggle
   presentation. Preserve field names, refs/highlight targets, values, callbacks,
   DOM reading order, focus order, and mounted label/message associations.

This uses existing composition and does not require a new Field prop or generic
FieldGrid/FieldRow API. Browser geometry is the acceptance proof. If the proposed
composition cannot preserve the contract, record the actual failing case and
revise this spec before implementing a public-system extension; do not hide a
new primitive or API inside the renderer.

Acceptance matrix:

| Case | Required result |
| --- | --- |
| Mixed text/number/select/boolean cells | Controls align on the intended row without reaching into a sibling control's markup. |
| Boolean first, middle, last; multiple booleans; more than three fields | Schema order and responsive grid packing stay correct, including incomplete final rows. |
| Short, wrapping, long unbroken, and required labels | Labels remain fully legible; controls do not overlap or become inaccessible; no document overflow. |
| Narrow container within a wide viewport; 320px viewport; wider two/three-column layouts; 200% text | Layout follows the container, preserves supported columns and compact toggle placement, and adds no nested page scrolling. Enlarged wrapping labels do not overlap their controls or adjacent cells. |
| Keyboard, labels, descriptions, validation | Label activation and keyboard control operation work; accessible names and message association stay intact. |
| List/scalar validation and add/remove/reset/save | Current payloads, required/unique/min/max rules, and feedback placement remain unchanged; list errors remain list-level errors. |
| Busy/disabled and field highlighting | Existing propagation, save availability, highlight target, and scroll behavior remain unchanged. |
| Standalone fields and agent toggles | Existing appearance and behavior are preserved; no unrelated migration. |

Do not expose descriptions that compact rows currently omit, add new per-cell
validation, change key/reconciliation behavior, or rewrite the renderer's state
management as part of this layout fix.

## Tooling, structure, and style

Use pinned Bun 1.3.13, React 19, current Base UI/Tailwind versions from the lockfile,
and the existing TypeScript, Bun-test, Storybook/Vitest, and canonical Playwright
tools. No package changes. Production modules remain in the paths above; tests
remain in `tests/ui/{architecture,patterns,browser}` and existing SDK build tests.

Follow single quotes, named imports, existing union/prop types, and explicit
barrel exports. The existing public import remains:

```tsx
import { AgentAvatar, ModelSelect, PluginSettingsRenderer } from '@makinbakin/sdk/patterns'
import { Field, FieldLabel, Input } from '@makinbakin/sdk/ui'
```

Exact commands, pinned-input preparation, and verification checkpoints are in
PLAN.md. Use isolated tests and the repo's temporary-home mocks and React act
discipline. Canonical browser tooling owns visual evidence; do not substitute
local operating-system screenshots for a baseline update.

Rebuild `packages/sdk/styles.css` from the candidate source and pinned sibling
inputs before SDK packaging. The package builder checks freshly compiled CSS
against this artifact. Review and include any necessary generated stylesheet
delta with its implementation; this is not a visual-baseline or budget refresh.

## Documentation coverage

- Review `.claude/knowledge/{repo-architecture,design-system,style-guide,shared-ui-patterns,ui-patterns}.md`.
  Update ownership guidance for #807 and the settings composition rule for #808
  where relevant. Preserve historical examples clearly marked as history.
- `repo-architecture.md` currently omits `packages/ui` from its package overview;
  a small correction belongs with #807. Avoid refreshing unrelated package or
  plugin counts throughout the document.
- Review `docs/src/content/docs/extending/ui/overview.md` (Field composition and
  internals), `packages/sdk/README.md`, and root `README.md`. Public imports and
  root quickstart remain valid; no root README change is expected. The SDK README
  still advertises the removed `/components` barrel; remove that stale row while
  checking #807's supported import guidance, without reviving the barrel.
- For #808 document that settings rows compose whole Fields rather than styling
  internal parts. Show the supported result in the existing settings story.
- API ledger and generated docs should remain unchanged unless an actual
  supported contract changes. Do not hand-edit generated inventory to pass CI.

## Boundaries and approval

- Always: keep two focused PRs, preserve unrelated files (including
  `.vitest-attachments/`), verify each coherent checkpoint, review before opening
  PRs, and report actual evidence and limitations.
- Revisit with the maintainer: a necessary public-system extension, intentional
  visual change, new dependency, public export change, or budget increase. The
  current plan authorizes none of those and requires no new system exception.
- Never: add compatibility shims, expand into #810, weaken gates, regenerate
  baselines merely to make failures pass, access production homes, rewrite old
  commits, merge, publish, tag, deploy, or restart the live installation.

The maintainer approved the concrete spec and plan. Code investigation resolved
the package boundary and existing-Field questions. Build-time evidence may
require a revised proposal if the stated constraints cannot be met.
