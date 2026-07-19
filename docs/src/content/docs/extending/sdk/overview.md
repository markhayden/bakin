---
title: SDK
description: Use @makinbakin/sdk to build plugins with supported registration, routing, UI, hooks, slots, types, utilities, and metadata helpers.
---

`@makinbakin/sdk` is the plugin-author surface. It exists so external plugins can typecheck and run without importing Bakin host internals. If a plugin needs something that is not exported here, treat that as an SDK design question before reaching into `src` or another package.

## Import Map

<div class="table-light-full table-label-wrap">

| Import | Purpose |
| --- | --- |
| `@makinbakin/sdk` | plugin registration, route helpers, top-level types, and core exports |
| `@makinbakin/sdk/ui` | base UI primitives such as buttons, inputs, dialogs, tables, tabs, and badges |
| `@makinbakin/sdk/layout` | canonical page and responsive composition |
| `@makinbakin/sdk/patterns` | reusable application-aware UI patterns |
| `@makinbakin/sdk/charts` | isolated data-visualization components |
| `@makinbakin/sdk/conversation` | isolated conversation UI and models |
| `@makinbakin/sdk/hooks` | shared React hooks |
| `@makinbakin/sdk/components` | migration-only legacy component barrel |
| `@makinbakin/sdk/slots` | slot registry and `<Slot>` primitive |
| `@makinbakin/sdk/types` | public TypeScript contract types |
| `@makinbakin/sdk/utils` | shared utilities |
| `@makinbakin/sdk/metadata` | docs-aware contract helper types and compatibility exports |
| `@makinbakin/sdk/routing` | typed declarative route helpers re-exported from the canonical routing package |
| `@makinbakin/sdk/styles.css` | canonical compiled design-system stylesheet |

</div>

At build time, plugin bundles should mark `@makinbakin/sdk`, `@makinbakin/sdk/*`, `react`, and `react-dom` as externals. At runtime, Bakin resolves them to the host copies so there is one React instance and one SDK registry.

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
| `HealthCheckRegistrationInput` | Owner-local check definition accepted by `ctx.registerHealthCheck()`. |
| `HealthCheckRunInput` | Discriminated producer result: non-empty observations or an explicit not-applicable reason. |
| `HealthObservationInput` | Stable, structured healthy/warning/error/unknown evidence returned by a check. |
| `HealthReport` | Core-stamped immutable report consumed by HTTP, CLI, and UI surfaces. |
| `HealthRepairActionDefinition` | Separately registered plan/apply contract for explicit operator repairs. |

</div>

All public types are importable from `@makinbakin/sdk` or `@makinbakin/sdk/types`. Routing-specific types are also available from `@makinbakin/sdk/routing`.

Health producer constructors are available from `@makinbakin/sdk/utils`: `healthHealthy`, `healthWarning`, `healthError`, `healthUnknown`, `healthObserved`, and `healthNotApplicable`. They preserve the status/disposition invariants at the call site; core still validates all runtime input before publishing it.

## UI Guidance

Prefer SDK UI components for plugin UI. Custom UI is allowed for domain-specific needs, but it should preserve Bakin's accessibility, spacing, contrast, density, loading behavior, and keyboard interactions.

```tsx
import { Button, Input, Table } from '@makinbakin/sdk/ui'
```

Avoid copying host component files into a plugin. If a component is broadly useful, promote it to a focused SDK entrypoint instead. `@makinbakin/sdk/components` remains available only while existing consumers migrate.

The Bakin host loads the design-system stylesheet once. Installed plugin clients must not import it. Standalone previews and browser test harnesses import the exact public artifact once at their root:

```ts
import '@makinbakin/sdk/styles.css'
```

## Conversation Kit

Use the conversation kit for plugin-owned back-and-forth agent work. `ConversationPanel` is the embedded single-session surface — it owns the chat UI, tool-activity rendering (collapsed groups → detail drawer), the composer (drafts, history, abort, attachments), and resize persistence. The plugin still owns transport, storage, and domain side effects.

```tsx
import {
  ConversationPanel,
  useConversationStream,
  type ConversationMessage,
} from '@makinbakin/sdk/components'
```

Server routes and exec tools should use the matching utilities from `@makinbakin/sdk/utils`:

```ts
import { conversationThreadId, createTurnRecorder } from '@makinbakin/sdk/utils'
```

- `conversationThreadId(scope, entityId, agentId)` builds a stable adapter-neutral runtime thread key. Use it for durable sessions, for example `projects:${projectId}:${agentId}` or `messaging:${sessionId}:${agentId}`.
- `createTurnRecorder({ turnId })` turns one streamed turn's runtime chunks into persistable `ConversationMessage` rows (`ingest` per chunk, `drain` for crash-safe incremental writes, `finish` at turn end). Structured tool rows survive; previews are clipped honestly.
- Your SSE route streams `event: chunk` frames whose data is the raw runtime chunk JSON, plus `done`/`error`; custom events (domain payloads like proposals) pass through `useConversationStream`'s `onCustom`.

Do not replay an entire plugin-stored transcript into every prompt when a durable runtime thread is available. Store `ConversationMessage` rows for UI hydration and search, but let the active runtime adapter map repeated `agentId + threadId` calls to the same provider session.

## Metadata Helpers

`@makinbakin/sdk/metadata` re-exports docs-aware contract types and helper functions. New HTTP APIs should use `defineRoute()` from `@makinbakin/sdk` or `@makinbakin/sdk/routing`; older metadata helpers remain for compatibility with existing contracts.

## Stability Rule

SDK exports are the compatibility promise. Host files, package aliases, generated routes, and another plugin's internals are not. When reviewing a plugin, imports are the first thing to scan.

## Related

- [UI Style Guide and Component Catalog](/docs/extending/ui/overview/)
- [Plugin Manifest](/docs/extending/plugins/manifest/)
- [Server Contracts](/docs/extending/plugins/server-contracts/)
- [Client UI](/docs/extending/plugins/client-ui/)
- [SDK Reference](/docs/reference/generated/sdk/)
