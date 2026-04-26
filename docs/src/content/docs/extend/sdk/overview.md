---
title: SDK
description: Use @bakin/sdk to build plugins with supported UI components, hooks, slots, types, and utilities.
---

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

## Notable Type Exports

| Type | Description |
| --- | --- |
| `HealthCheckResult` | Doctor check result row: `{ check, status, message, autoFixable }`. Returned from any function registered via `ctx.registerHealthCheck()`. |
| `PluginHealthCheckInput` | Input shape for `ctx.registerHealthCheck()`: `{ id, name, run, autoFix? }`. |
| `PluginContext` | The runtime handle passed to `activate(ctx)`. |
| `BakinPlugin` | The default-exported plugin object shape. |

All types are importable from `@bakin/sdk` (or `@bakin/sdk/types`).

## Component Guidance

Prefer SDK components for plugin UI. Custom UI is allowed for domain-specific needs, but it should preserve Bakin's accessibility, spacing, and interaction patterns.

## Related Authoring Guides

- [Plugin Manifest](/docs/extend/plugins/manifest/)
- [Server Contracts](/docs/extend/plugins/server-contracts/)
- [Client UI](/docs/extend/plugins/client-ui/)
