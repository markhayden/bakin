# Form control border contrast — approval proposal

Status: explicitly approved by the user; token implementation applied.
Canonical contrast and interaction verification passed. No PNG baseline changes authorized.
Subsequent user screenshot feedback explicitly requested no filled border,
including the bottom edge. Filled now uses only its background at rest.
Outlined retains the approved complete border and its measured contrast. Both
retain focus and complete invalid borders. The original proposal below records
the token approval; its filled-border treatment is superseded by this request.
The generated CSS name follows the existing `--bakin-color-*` convention;
the proposal originally abbreviated it as `--bakin-border-control`.

The approved Input/SurfaceContexts contract exposes outlined and filled fields
on canvas, default and elevated surfaces. Canonical computed contrast measures
its existing subtle boundary at **2.10:1 on canvas and 1.90:1 on elevated fill**.
The existing token explicitly describes nonessential boundaries. It does not
provide a 3:1 boundary for identifying an editable field.

Text is 17.50–19.28:1, focus 8.46:1, and error boundaries 4.65–5.12:1. Those
already satisfy their measured contrast targets. Ghost deliberately has no
resting boundary; its label, hover/focus and error treatments remain unchanged.

## Recommended exact extension

- Add internal reference color `reference.color.warm.400 = #716c6c`.
- Add public semantic `semantic.color.border.control`, generated as
  `--bakin-color-border-control`, referencing warm.400. Describe it as the resting
  boundary of outlined/filled editable controls; record UI-component contrast
  against elevated surface (the worst of the three supported parents).
- Use it only in the shared outlined/filled field recipe for Input, default
  FieldControl, Textarea, InputGroup, SelectTrigger and ComboboxControl.
- Point the internal `component.field.border` alias at the new semantic token.
- Keep existing subtle separators/cards, ghost rest, focus, danger, disabled
  opacity and all sizes unchanged. No product UI migration.

The proposed border is **3.73:1 on canvas, 3.58:1 on default surface, and
3.39:1 on elevated surface**. Reusing the muted-text token would give a much
brighter boundary and conflate text with control semantics; changing the
existing subtle token would unnecessarily change separators throughout the UI.

## Concrete canonical preview

These are browser-only preview overrides, not committed implementation or
baseline replacements. Same layout, text, viewport and rendering as the final
Input/SurfaceContexts story; only outlined/filled resting border color changes.

| View | Current | Proposed |
| --- | --- | --- |
| Desktop | [Before](../test-results/form-border-1440-before.png) | [Proposal](../test-results/form-border-1440-proposal.png) |
| 320px | [Before](../test-results/form-border-320-before.png) | [Proposal](../test-results/form-border-320-proposal.png) |

After approval: update source tokens, regenerate their existing artifacts,
add the contrast assertion, run quick/token/story/performance checks, and
recapture only affected canonical images. Exact baseline PNG approval remains
a separate later step. Existing full-browser and unaffected snapshot checks
continue while this decision is pending.

Authority: `.agents/skills/bakin-ui-conformance/SKILL.md` requires explicit
approval for a new public token. The approved overhaul spec also requires a
precise proposal when existing tokens cannot supply sufficient field contrast.
