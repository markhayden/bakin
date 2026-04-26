---
title: SDK
description: Use @bakin/sdk to build plugins with supported UI components, hooks, slots, types, and utilities.
---

# SDK

`@bakin/sdk` is the plugin-author surface. It exposes plugin registration, UI components, hooks, slots, types, and utilities that are safe for plugins to import.

Public SDK exports require TSDoc and stability metadata before launch.

## Subpaths

| Import | Purpose |
| --- | --- |
| `@bakin/sdk` | plugin registration and top-level exports |
| `@bakin/sdk/ui` | base UI components |
| `@bakin/sdk/hooks` | shared React hooks |
| `@bakin/sdk/components` | higher-level shell components |
| `@bakin/sdk/slots` | slot runtime helpers |
| `@bakin/sdk/types` | public TypeScript types |
| `@bakin/sdk/utils` | shared utilities |
| `@bakin/sdk/metadata` | planned metadata helpers for standalone plugins |

## Component Guidance

Prefer SDK components for plugin UI. Custom UI is allowed for domain-specific needs, but it should preserve Bakin's accessibility, spacing, and interaction patterns.
