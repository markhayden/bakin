---
title: SDK
description: Use @bakin/sdk to build plugins with supported registration, routing, UI, hooks, slots, types, utilities, and metadata helpers.
---

`@bakin/sdk` is the plugin-author surface. It exists so external plugins can typecheck and run without importing Bakin host internals. If a plugin needs something that is not exported here, treat that as an SDK design question before reaching into `src` or another package.

## Import Map

<div class="table-light-full table-label-wrap">

| Import | Purpose |
| --- | --- |
| `@bakin/sdk` | plugin registration, route helpers, top-level types, and core exports |
| `@bakin/sdk/ui` | base UI primitives such as buttons, inputs, dialogs, tables, tabs, and badges |
| `@bakin/sdk/hooks` | shared React hooks |
| `@bakin/sdk/components` | higher-level Bakin shell components |
| `@bakin/sdk/slots` | slot registry and `<Slot>` primitive |
| `@bakin/sdk/types` | public TypeScript contract types |
| `@bakin/sdk/utils` | shared utilities |
| `@bakin/sdk/metadata` | docs-aware contract helper types and compatibility exports |
| `@bakin/sdk/routing` | typed declarative route helpers re-exported from the canonical routing package |

</div>

At build time, plugin bundles should mark `@bakin/sdk`, `@bakin/sdk/*`, `react`, and `react-dom` as externals. At runtime, Bakin resolves them to the host copies so there is one React instance and one SDK registry.

## Top-Level Authoring APIs

<div class="table-light-full table-label-wrap">

| API | Use it for |
| --- | --- |
| `registerPlugin()` | Client-side nav items, plugin-owned routes, and slots. |
| `registerPluginCleanup()` | Client-side teardown for plugin-owned registries during hot reload. |
| `definePlugin()` | Server plugin object with preserved route type inference. |
| `defineRoute()` | Typed declarative plugin API routes. |
| `getPluginRoute()` and `getPluginRoutes()` | Reading client route registry state. Mostly for host/shell code. |

</div>

## Notable Types

<div class="table-light-full table-label-wrap">

| Type | Description |
| --- | --- |
| `BakinPlugin` | Server plugin object shape. |
| `PluginContext` | Full runtime handle passed to `activate(ctx)`. |
| `PluginContextLite` | Route-handler context for declarative routes. |
| `PluginManifest` | Parsed `bakin-plugin.json` shape. |
| `NavItem` | Client navigation item shape. |
| `HealthCheckResult` | Doctor check result row: `{ check, status, message, autoFixable }`. |
| `PluginHealthCheckInput` | Input shape for `ctx.registerHealthCheck()`. |

</div>

All public types are importable from `@bakin/sdk` or `@bakin/sdk/types`. Routing-specific types are also available from `@bakin/sdk/routing`.

## UI Guidance

Prefer SDK UI components for plugin UI. Custom UI is allowed for domain-specific needs, but it should preserve Bakin's accessibility, spacing, contrast, density, loading behavior, and keyboard interactions.

```tsx
import { Button, Input, Table } from '@bakin/sdk/ui'
import { PluginHeader } from '@bakin/sdk/components'
```

Avoid copying host component files into a plugin. If a component is broadly useful, promote it to the SDK instead.

## Metadata Helpers

`@bakin/sdk/metadata` re-exports docs-aware contract types and helper functions. New HTTP APIs should use `defineRoute()` from `@bakin/sdk` or `@bakin/sdk/routing`; older metadata helpers remain for compatibility with existing contracts.

## Stability Rule

SDK exports are the compatibility promise. Host files, package aliases, generated routes, and another plugin's internals are not. When reviewing a plugin, imports are the first thing to scan.

## Related

- [Plugin Manifest](/docs/extending/plugins/manifest/)
- [Server Contracts](/docs/extending/plugins/server-contracts/)
- [Client UI](/docs/extending/plugins/client-ui/)
- [SDK Reference](/docs/reference/generated/sdk/)
