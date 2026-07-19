---
title: UI Style Guide
description: Build plugin interfaces from Bakin's supported SDK components, executable examples, and tested interaction contracts.
---

Bakin's UI system has two complementary references:

- This documentation explains how to choose and compose supported UI contracts.
- The [public component catalog](/docs/ui/) is the executable source of truth for SDK components, states, responsive behavior, accessibility, and interaction examples.

The catalog is built from the same release ref as these docs and contains only stories that import through supported `@makinbakin/sdk/*` entrypoints. Maintainer-only and migration stories stay in the local workbench and are mechanically excluded from the published artifact.

## Foundation Status

The catalog includes the approved Product Character foundation: Space Grotesk for interface text, JetBrains Mono for code and machine-readable values, semantic color and layout tokens, and one contextual compact rhythm for tables and other dense operational data. Operational Neutral remains comparison evidence, not a second theme or density mode.

The catalog will grow component by component as primitives, layout recipes, system states, page archetypes, and plugin examples pass their design-system checkpoints. An item appearing in the catalog documents an existing SDK contract; it does not make host internals or arbitrary Tailwind utility strings public API.

## Authoring Rule

Start with the focused visual SDK entrypoints: `@makinbakin/sdk/ui`, `@makinbakin/sdk/layout`, `@makinbakin/sdk/patterns`, `@makinbakin/sdk/charts`, and `@makinbakin/sdk/conversation`. Use semantic component props and documented composition patterns. The older `@makinbakin/sdk/components` barrel is migration-only and should not gain new consumers. Add plugin-owned, root-scoped CSS only for domain-specific presentation that the SDK does not cover.

Do not copy host components into a plugin. If the same need recurs across official or third-party plugins, propose it as an SDK contract with its public story, interaction test, accessibility coverage, and responsive states.

## Action and Status Primitives

The first supported primitive set covers actions, compact state, contextual messages, and measurable work:

| Need | Component | Choose with |
| --- | --- | --- |
| Trigger an action | `Button` | semantic `variant` and `size` |
| Label compact state or metadata | `Badge` | independent `tone`, `variant`, and `size` |
| Explain a page- or section-level condition | `Alert` | semantic `tone` |
| Show determinate or indeterminate work | `Progress` | `value`, accessible label, `tone`, and `size` |

```tsx
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@makinbakin/sdk/ui'

export function ImportStatus() {
  return (
    <section aria-labelledby="import-status-heading">
      <h2 id="import-status-heading">Import</h2>
      <Badge tone="attention">Waiting for review</Badge>
      <Progress value={64}>
        <ProgressLabel>Importing assets</ProgressLabel>
        <ProgressValue />
      </Progress>
      <Alert tone="danger">
        <AlertTitle>Three assets need attention</AlertTitle>
        <AlertDescription>Resolve the conflicts before publishing.</AlertDescription>
      </Alert>
      <Button variant="primary">Review conflicts</Button>
    </section>
  )
}
```

Use one primary action per local decision area. `secondary`, `outline`, and `ghost` reduce emphasis; `danger` is reserved for destructive consequences. `warning`, `info`, and `accent` communicate specific context and should not replace clear action labels. Icon-only buttons need an accessible name.

For badges, `tone` describes meaning (`neutral`, `primary`, `success`, `attention`, `danger`, or `accent`) while `variant` describes visual treatment (`soft`, `solid`, `outline`, `ghost`, or `link`). Do not encode status only with color: keep the text explicit. Badges label state; buttons change it.

Routine alerts announce with `role="status"`. Danger alerts default to `role="alert"`, so reserve them for conditions that need immediate assistive-technology announcement. Progress accepts an exact `value` for determinate work or `null` for indeterminate work; always supply a visible `ProgressLabel` or an `aria-label`.

`buttonVariants()` and `badgeVariants()` are supported escape hatches for links and render integrations that must share a primitive's visual treatment while preserving the correct native element. They do not make the generated class string, arbitrary Tailwind utilities, or internal DOM structure part of the SDK contract. Prefer the component whenever it has the right semantics.

Existing `default` and `destructive` action variants and `default`, `secondary`, and `destructive` badge variants remain compatibility aliases while owned consumers migrate. New work uses the semantic names above.

## Stylesheet Contract

`@makinbakin/sdk/styles.css` is the one supported compiled design-system stylesheet. The Bakin host loads it once for installed plugins, so plugin client entries must not import it or copy its contents into plugin-owned CSS.

Standalone Storybook instances, browser previews, and external test harnesses do not have the host stylesheet. Import the public artifact once at the preview or application root:

```ts
import '@makinbakin/sdk/styles.css'
```

This is the exact artifact used by Bakin and the public component catalog. It supplies the namespaced `--bakin-*` semantic tokens and supported component styling; it does not make the host's arbitrary Tailwind utility vocabulary public API.

## Navigation Stays Separate

UI composition does not redefine routing. Follow the existing presentation-based routing contract: paths identify pages, while query parameters represent overlays, tabs, filters, and other composable view state. Use `PluginLink` or `useRouter()` for client-side navigation and the SDK query-state hooks for URL-backed view state.

## Local Commands

```sh
bun run ui:dev
bun run ui:test:stories
bun run ui:test:visual
bun run ui:test:browsers
bun run docs:check
```

`docs:check` validates the curated docs, the existing route contracts, the public-story boundary, and the combined `/docs/ui/` artifact.

## Related

- [SDK overview](/docs/extending/sdk/overview/)
- [Plugin client UI](/docs/extending/plugins/client-ui/)
- [Quality control](/docs/extending/quality-control/)
- [SDK reference](/docs/reference/generated/sdk/)
