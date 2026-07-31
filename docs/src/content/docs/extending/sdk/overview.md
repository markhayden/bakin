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
| `@makinbakin/sdk/content` | opt-in rich content rendering and editing |
| `@makinbakin/sdk/hooks` | shared React hooks |
| `@makinbakin/sdk/slots` | slot registry and `<Slot>` primitive |
| `@makinbakin/sdk/types` | public TypeScript contract types |
| `@makinbakin/sdk/utils` | shared utilities |
| `@makinbakin/sdk/metadata` | docs-aware contract helper types and compatibility exports |
| `@makinbakin/sdk/routing` | typed declarative route helpers re-exported from the canonical routing package |
| `@makinbakin/sdk/navigation` | browser links, router hooks, URL state, history, and dirty-exit protection |
| `@makinbakin/sdk/testing/ui` | deterministic browser fixture host for registered plugin pages and slots |
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

All public types are importable from `@makinbakin/sdk` or `@makinbakin/sdk/types`. Server route declaration types are also available from `@makinbakin/sdk/routing`; browser router, link, URL-state, history, and dirty-exit contracts are available from `@makinbakin/sdk/navigation`.

Health producer constructors are available from `@makinbakin/sdk/utils`: `healthHealthy`, `healthWarning`, `healthError`, `healthUnknown`, `healthObserved`, and `healthNotApplicable`. They preserve the status/disposition invariants at the call site; core still validates all runtime input before publishing it.

## UI Guidance

Prefer SDK UI components for plugin UI. Custom UI is allowed for domain-specific needs, but it should preserve Bakin's accessibility, spacing, contrast, density, loading behavior, and keyboard interactions.

```tsx
import { Alert, Badge, Button, Progress } from '@makinbakin/sdk/ui'
```

Avoid copying host component files into a plugin. If a component is broadly useful, promote it to a focused SDK entrypoint instead. (The legacy `@makinbakin/sdk/components` barrel was removed once every consumer migrated to the focused entrypoints.)

Use semantic props instead of rebuilding primitive styles: `Button` exposes action variants and sizes, `Badge` separates status `tone` from visual `variant`, `Alert` assigns announcement behavior from its tone, and `Progress` supports exact determinate or indeterminate state. The supported `buttonVariants()` and `badgeVariants()` helpers are reserved for links and render integrations that need the same treatment without changing native semantics. See the [UI style guide](/docs/extending/ui/) and [public component catalog](/docs/ui/) for the complete contracts and states.

The Bakin host loads the design-system stylesheet once. Installed plugin clients must not import it. Standalone previews and browser test harnesses import the exact public artifact once at their root:

```ts
import '@makinbakin/sdk/styles.css'
```

## Test Plugin UI Without Bakin User State

`PluginUiFixtureHost` from `@makinbakin/sdk/testing/ui` mounts normal plugin
client registrations through Bakin's production route matcher, slot registry,
plugin ownership roots, and portal ownership bridge. It is browser-only and
separate from the Node-backed `@makinbakin/sdk/testing` server harness.

Give the fixture an explicit route, desktop or mobile viewport name, fixed
time, random seed, color scheme, motion preference, and network responses.
Unhandled requests throw instead of falling through to live services. The
same registration can therefore cover its page, slot contributions, scoped
domain CSS, portalled overlays, and canonical ready/empty/loading/error states
without accounts, local storage, or production data.

The viewport name records fixture intent and controls deterministic media
preferences. Your browser runner must also apply the exported
`PLUGIN_UI_VIEWPORTS` dimensions; a component cannot resize its own browser
viewport. Import `@makinbakin/sdk/styles.css` once at the standalone preview
root. Do not add that stylesheet import to an installed plugin client.

See **Testing / Plugin UI fixture host** in the public component catalog for
the registered page-and-slots, mobile, scoped-overlay, and system-state
examples.

### Run the plugin UI conformance suite

Install `playwright` and `axe-core` as plugin dev dependencies and expose the
SDK binary as the package's `test:ui` script:

```json
{ "scripts": { "test:ui": "bakin-plugin-test-ui" } }
```

Install the browser once with `bunx playwright install chromium`.

Create `bakin.ui-test.ts` at the package root:

```ts
import { definePluginUiConformance } from '@makinbakin/sdk/testing/ui/conformance'

export default definePluginUiConformance({
  pluginId: 'bookmarks',
  fixtureEntry: './tests/ui.fixture.tsx',
})
```

Run `bun run test:ui` and open `test-results/bakin-ui/index.html`. The command
builds the external-style fixture, reuses the same CSS containment validator as
plugin packaging, enforces exactly one canonical stylesheet import, and checks
desktop/mobile overflow, axe, keyboard/focus behavior, and browser errors. Its
HTML and JSON reports include concrete repair guidance plus desktop/mobile
screenshots. CSS containment and stylesheet identity may block packaging;
broader browser findings gate conformance and release without becoming runtime
install policy.

## Conversation Kit

Use the conversation kit for plugin-owned back-and-forth agent work.
`ConversationPanel` is the embedded single-session surface — it owns the chat
UI, tool-activity rendering (collapsed groups → detail drawer), the composer
(drafts, history, abort, attachments), and resize persistence. The plugin owns
its durable transcript and domain side effects; Bakin's shared turn engine owns
the background runtime turn and event transport.

```tsx
import {
  ConversationPanel,
  useConversationThread,
  type ConversationMessage,
} from '@makinbakin/sdk/conversation'
```

Create the matching server service once during plugin activation with
`ctx.conversations.createTurnService(...)`. Configure your plugin-namespaced
`chunk`, `done`, and `error` events; transcript resolver and append function;
runtime thread id; and `metering: { workClass: 'chat', runId }`. Send routes call
`service.start(...)` and return `202` for `accepted`, `409` for `busy`, or `404`
for `not_found`. The turn continues if the browser navigates away or the HTTP
request ends.

Server services can use the matching utilities from `@makinbakin/sdk/utils`:

```ts
import { conversationThreadId, createTurnRecorder } from '@makinbakin/sdk/utils'
```

- `conversationThreadId(scope, entityId, agentId)` builds a stable adapter-neutral runtime thread key. Use it for durable sessions, for example `projects:${projectId}:${agentId}` or `messaging:${sessionId}:${agentId}`.
- `createTurnRecorder({ turnId })` turns one streamed turn's runtime chunks into persistable `ConversationMessage` rows (`ingest` per chunk, `drain` for crash-safe incremental writes, `finish` at turn end). Structured tool rows survive; previews are clipped honestly.
- `useConversationThread` loads the durable transcript, adds an optimistic user row, posts the send request, and folds your plugin events into live chunks. On `done` or `error` it refetches the durable transcript.

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
