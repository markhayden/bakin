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

Start with `@makinbakin/sdk/ui` and `@makinbakin/sdk/components`. Use semantic component props and documented composition patterns. Add plugin-owned, root-scoped CSS only for domain-specific presentation that the SDK does not cover.

Do not copy host components into a plugin. If the same need recurs across official or third-party plugins, propose it as an SDK contract with its public story, interaction test, accessibility coverage, and responsive states.

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
