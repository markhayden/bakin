---
title: SDK Reference
description: Public API surface of @makinbakin/sdk — hooks, components, types, and utilities for plugin authors.
---

The Bakin SDK is a single package with multiple subpaths. Plugin authors mark `@makinbakin/sdk` (and `react`/`react-dom`) as externals at build time; the host serves a single shared instance at runtime.

```ts
import { registerPlugin } from '@makinbakin/sdk'
import { useSearch } from '@makinbakin/sdk/hooks'
import { PluginHeader } from '@makinbakin/sdk/components'
import type { BakinPlugin, PluginContext } from '@makinbakin/sdk/types'
```

## `@makinbakin/sdk`

The main entry. Re-exports the plugin contract types (`./types`) plus the high-traffic plugin lifecycle helpers (`registerPlugin`, `defineRoute`, `definePlugin`). Source: `packages/sdk/src/index.ts`.

| Export | Description |
| --- | --- |
| `registerPlugin` | Register a plugin (single-call entry from a plugin's `client.tsx`). |
| `unregisterPlugin` | Tear down all registrations owned by a plugin (used during hot-swap). |
| `registerPluginCleanup` | Register a cleanup callback fired when the plugin is unregistered. |
| `getRegistryVersion` | Current registry version — bumps on every mutation (for useSyncExternalStore). |
| `subscribeRegistry` | Subscribe to registry-version changes. |
| `getAllNavItems` | Get every registered nav item across all plugins. |
| `getNavItemsSnapshot` | Get a snapshot of the current nav items (non-subscribing). |
| `getPluginNavItems` | Get nav items contributed by a specific plugin. |
| `setNavBadge` | Set or clear a runtime badge on a plugin-owned nav item. |
| `getNavBadge` | Read the current badge for a nav item, or undefined if none. |
| `getNavBadgesSnapshot` | Stable snapshot of every active nav badge keyed by navItemId. |
| `subscribeNavBadges` | Subscribe to nav-badge mutations (separate channel from `subscribeRegistry`). |
| `getPluginRoute` | Look up a specific client route by plugin id + path. |
| `getPluginRoutes` | Get all registered client routes (across all plugins). |
| `setManifestNav` | Seed a plugin's declarative nav from its manifest (host-side; survives unregisterPlugin). |
| `getManifestNav` | Read the manifest nav currently seeded for a plugin (drift validation). |
| `getSearchHitRenderer` | Look up the ⌘K hit renderer registered for a content type. |
| `getSearchHitRenderersSnapshot` | Stable snapshot of all registered hit renderers keyed by content type. |
| `subscribeSearchHitRenderers` | Subscribe to hit-renderer mutations (own channel). |
| `ClientRouteEntry` | — |
| `MatchedPluginRoute` | — |
| `PluginRegistration` | — |
| `configureLazyPlugins` | Install the manifest-derived slot/route ownership index for lazy loading (host-side). |
| `setLazyPluginLoader` | Install the demand loader that imports a plugin's client bundle (host-side). |
| `setPluginLoadState` | Report a plugin client's load progress: idle → loading → loaded \| error (host-side). |
| `getPluginLoadState` | Current load state for a plugin client. Unknown plugins report 'idle'. |
| `getPluginLoadError` | Last load error message for a plugin whose state is 'error', if any. |
| `getSlotOwners` | Plugins whose manifests declare the given slot in `contributes.slots`. |
| `getRouteOwners` | Plugins whose manifest `contributes.routes` patterns match a pathname. |
| `requestSlotPlugins` | Ask the host to lazy-load every idle plugin that fills the named slot. |
| `requestRoutePlugins` | Ask the host to lazy-load every idle plugin whose route patterns match the pathname. |
| `requestAllPlugins` | Ask the host to lazy-load every idle plugin — cross-plugin surfaces (⌘K search). |
| `retryPluginLoad` | Reset a failed plugin to idle and re-request its client bundle. |
| `getLazyPluginsVersion` | Monotonic lazy-store version for useSyncExternalStore consumers. |
| `subscribeLazyPlugins` | Subscribe to lazy-plugin store mutations. Returns an unsubscribe fn. |
| `LazyPluginIndex` | — |
| `PluginLoadState` | — |
| `defineRoute` | Define a plugin HTTP route with typed input/output schemas. |
| `defineCoreRoute` | Define a core (non-plugin) HTTP route. |
| `definePlugin` | Compose a plugin's routes into a single definition for the server. |
| `HttpStatus` | — |
| `RouteContext` | — |
| `PluginContextLite` | — |
| `CoreContext` | — |
| `BodySpec` | — |
| `ResponseSpec` | — |
| `ParsedInput` | — |

## `@makinbakin/sdk/hooks`

Source: `packages/sdk/src/hooks/index.ts`.

```ts
import { useSearch, useDebug } from '@makinbakin/sdk/hooks'
```

### Data & State

| Hook | Description |
| --- | --- |
| `useContentStore` | Access the global Zustand store for SSE-driven content state. |
| `useScheduleJobs` | List scheduled jobs with live updates. |
| `useRunHistory` | Fetch run history for a scheduled job. |
| `ScheduleJob` | — |
| `RunEntry` | — |

### Search

| Hook | Description |
| --- | --- |
| `useSearch` | Hybrid full-text + semantic search across plugins with facet filtering. |
| `reorderBySearchResults` | Re-rank a local list to match the order returned by a search query. |
| `SearchResult` | — |
| `SearchResponse` | — |
| `UseSearchOptions` | — |
| `UseSearchReturn` | — |

### Navigation & URL

| Hook | Description |
| --- | --- |
| `useQueryState` | Bind a single component-state value to a URL query param. |
| `useQueryArrayState` | Bind a multi-value (array) component state to a URL query param. |
| `useSidebar` | Read sidebar open/closed state and toggle helper. |
| `useRouter` | Access the TanStack Router instance for imperative navigation. |
| `usePathname` | Current URL pathname (Next.js-shape compatible). |
| `useSearchParams` | Current URL search params as a URLSearchParams instance. |
| `useParams` | Current route's typed path parameters. |

### Agent Data

| Hook | Description |
| --- | --- |
| `useAgentStore` | Access the agent registry store (Zustand). |
| `useAgent` | Look up a single agent by ID. |
| `useAgentList` | List all registered agents. |
| `useAgentColor` | Get an agent's brand color (hex string). |
| `useAgentDisplayName` | Get an agent's display name (fallback to ID). |
| `useAgentIds` | List all registered agent IDs. |
| `useMainAgentId` | Get the ID of the designated main/orchestrator agent. |
| `usePackageState` | Read agent-package install state (managed/unmanaged). |
| `hexToMuted` | Convert a hex color to a muted variant for backgrounds. |

### Notification Channels

| Hook | Description |
| --- | --- |
| `useNotificationChannels` | List configured notification channels (Discord, Slack, email, etc.). |
| `getChannelLabel` | Get a human-readable label for a channel ID. |
| `getChannelInitials` | Get initials for a channel (e.g. "Discord" → "D"). |

### UI Controls

| Hook | Description |
| --- | --- |
| `useDebug` | Read/toggle the global debug (X-Ray) flag. |
| `useFormGuard` | Guard a form against unmounting while submission is in flight. |
| `toast` | Fire a toast notification (success/error/info). |
| `useToastStore` | Subscribe to the toast store for custom toast UIs. |
| `useVerticalResize` | Imperatively resize a vertical pane via mouse drag handle. |

### Runtime

| Hook | Description |
| --- | --- |
| `useRuntimeStatus` | Subscribe to runtime connection status (online/offline, last heartbeat). |
| `useSSE` | Subscribe to a Server-Sent Events endpoint with auto-reconnect. |

### Other

| Hook | Description |
| --- | --- |
| `useNavBadge` | Sync a nav item's badge to a derived value; the recommended provider glue. |
| `useJsonFetch` | Cancellable JSON GET with a `{ data, loading, error, refresh }` lifecycle. |
| `UseJsonFetchResult` | — |
| `useTaskRunHistory` | Fetch dispatch run history for a task. |
| `TaskOutcome` | — |
| `TaskRunEntry` | — |
| `usePluginEvent` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `PluginEventPayload` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `useHorizontalResize` | Resize a side-by-side split pane by dragging the divider between columns. |
| `useAvailableModels` | The available-models catalog (cached, read-only); empty until loaded. |

## `@makinbakin/sdk/components`

Source: `packages/sdk/src/components/index.ts`.

```ts
import { PluginHeader, FacetFilter, AgentAvatar } from '@makinbakin/sdk/components'
```

| Component | Description |
| --- | --- |
| `AgentAvatar` | Round avatar image for an agent, falls back to initials. |
| `AgentFilter` | Multi-select facet filter scoped to agents. |
| `AgentSelect` | Single-agent picker dropdown for form fields. |
| `AgentDot` | Small status dot showing an agent's online/offline state. |
| `AgentStatus` | Compound agent status (dot + label + last-seen timestamp). |
| `BakinDrawer` | Right-side slide-out drawer with backdrop and focus trap. |
| `ColorPicker` | Color picker swatch grid for tag/agent color assignment. |
| `ConfirmDialog` | Controlled confirmation dialog for destructive actions (busy/error aware). |
| `ConfirmDialogProps` | — |
| `EmptyState` | Centered empty-state component with icon, title, and CTA. |
| `SearchUnavailable` | — |
| `ScoreOverlay` | — |
| `ScoreOverlayInfo` | — |
| `ErrorBanner` | Inline error banner with dismiss + retry actions. |
| `ErrorState` | Full-page error state with title, description, and retry button. |
| `FacetFilter` | Popover multi-select facet filter (column, owner, tag, etc.). |
| `FacetOption` | — |
| `IntegratedBrainstorm` | Chat + plan-proposal review panel for brainstorm sessions. |
| `BrainstormMessage` | — |
| `IntegratedBrainstormProps` | — |
| `BrainstormOnSend` | — |
| `SendContext` | — |
| `AssistantTransformed` | — |
| `BrainstormActivityInput` | — |
| `BrainstormActivityStorageInput` | — |
| `BrainstormActivityStorageRecord` | — |
| `BrainstormTimelineActivityInput` | — |
| `BrainstormTimelineMessageInput` | — |
| `brainstormActivityMessageFromCustom` | Convert a custom activity message back into a brainstorm activity. |
| `brainstormThreadId` | Compute the canonical thread ID for a brainstorm session. |
| `normalizeBrainstormActivityForStorage` | Normalize a brainstorm activity payload for persistence. |
| `normalizeBrainstormActivityMessageForStorage` | Normalize a single brainstorm message for persistence. |
| `readBrainstormSseResponse` | Read an SSE response stream into brainstorm activity events. |
| `runtimeChunkToBrainstormActivity` | Convert a runtime chat chunk to a brainstorm activity event. |
| `toBrainstormTimeline` | Fold a brainstorm session's events into a renderable timeline. |
| `MarkdownContent` | Render markdown content with syntax highlighting and link handling. |
| `MarkdownEditor` | Editable markdown text area with preview toggle. |
| `ModelSelect` | Model picker dropdown listing available models from the catalog. |
| `PageLayout` | Standard plugin page wrapper with header, content area, and toaster. |
| `PluginHeader` | Plugin page header with title, count badge, search, and action buttons. |
| `PluginSettingsRenderer` | Render a settings form from a PluginSettingsSchema definition. |
| `PluginSettingsSchema` | — |
| `SortableHead` | Sortable table column header with ascending/descending indicator. |
| `SortDir` | — |
| `UnderlineTabs` | Tab list with animated underline indicator. |
| `UnderlineTab` | — |
| `ChannelIcon` | Icon component for a notification channel (Discord, Slack, email, etc.). |

## `@makinbakin/sdk/ui`

Source: `packages/sdk/src/ui/index.ts`. Re-exports of [shadcn/ui](https://ui.shadcn.com) primitives bundled with Bakin's design tokens. For usage, see the upstream component docs.

```ts
import { Button, Card, Dialog, Input } from '@makinbakin/sdk/ui'
```

## `@makinbakin/sdk/slots`

Source: `packages/sdk/src/slots/index.tsx`.

| Slot system | Description |
| --- | --- |
| `registerSlot` | Register a component for a named slot. Lower `order` renders first; default `order` is 100. |
| `getSlotEntries` | Read the registered entries for a slot. Exported for tooling / tests. |
| `getSlotNamesOwnedBy` | Slot names with at least one entry owned by the given plugin (manifest drift checks). |
| `clearSlotsOwnedBy` | Remove every slot entry owned by the given plugin (hot-swap teardown). |
| `Slot` | Render all components registered for the named slot, in order. Extra props |

## `@makinbakin/sdk/types`

Source: `packages/sdk/src/types/index.ts`. The full plugin contract surface. Below: detailed field-level docs for the types most plugin authors directly implement, then summary tables grouped by domain.

```ts
import type { BakinPlugin, PluginContext, ExecToolDefinition } from '@makinbakin/sdk/types'
```

### Core types (full field docs)

## `@makinbakin/sdk/utils`

Source: `packages/sdk/src/utils/index.ts`.

| Utility | Description |
| --- | --- |
| `healthOk` | Build an `ok` health-check result. |
| `healthWarn` | Build a `warn` health-check result (optionally auto-fixable). |
| `healthError` | Build an `error` health-check result (optionally auto-fixable). |
| `healthFixed` | Build a `fixed` health-check result (the auto-repair just ran). |
| `cn` | Tailwind class merger (clsx + tailwind-merge). |
| `BadgeTone` | Semantic tone for an outline status badge. |
| `toneBadgeClass` | Classes for an outline status badge of the given tone — the |
| `isValidAssetId` | Pure assetId shape validators (see ./asset-id). |
| `yearMonthFromAssetId` | Pure assetId shape validators (see ./asset-id). |
| `formatAge` | Format a Date or ISO string as a relative age (e.g. "5m ago"). |
| `formatDateTime` | Format an ISO timestamp as a calendar-aware absolute date+time (e.g. "Today 3:45 PM", "Jan 5 9:02 AM"). |
| `formatDuration` | Format a millisecond count as an elapsed duration (e.g. "42s", "3m 5s"); null when undefined. |
| `formatSize` | Format a byte count as a human-readable size string (e.g. "1.2 MB"). |
| `isStale` | Returns true if a timestamp is older than a configurable staleness threshold. |
| `brainstormActivityMessageFromCustom` | Convert a custom activity message into a brainstorm activity input. |
| `runtimeChunkToBrainstormActivity` | Convert a runtime chat chunk into a brainstorm activity event. |
| `toBrainstormTimeline` | Fold brainstorm events into a renderable timeline. |
| `brainstormThreadId` | Compute the canonical thread id for a brainstorm session. |
| `normalizeBrainstormActivityForStorage` | Normalize a brainstorm activity payload for persistence. |
| `normalizeBrainstormActivityMessageForStorage` | Normalize a single brainstorm message for persistence. |
| `BrainstormActivityInput` | — |
| `BrainstormTimelineActivityInput` | — |
| `BrainstormTimelineMessageInput` | — |
| `BrainstormActivityStorageInput` | — |
| `BrainstormActivityStorageRecord` | — |
| `readBrainstormSseResponse` | Read an SSE response stream into brainstorm activity events. |

## `@makinbakin/sdk/metadata`

Source: `packages/sdk/src/metadata/index.ts`.

| Contract helper | Description |
| --- | --- |
| `ContractMetadata` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `ContractStability` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `ContractVisibility` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `CliCommandContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `DocsAwareAPIRoute` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `DocsExample` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `ExecToolContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `HookContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `HookKind` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `PublicContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `RouteContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `SchemaLike` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `SlotContract` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `SourceLocation` | `@makinbakin/sdk/metadata` — docs-aware contract helpers. |
| `defineApiRoute` | Legacy: declare an API route with docs metadata. Prefer `defineRoute` from `/routing`. |
| `defineCliCommandContract` | Define a CLI command contract for documentation. |
| `defineExecToolContract` | Define an MCP exec tool contract for documentation. |
| `defineHookContract` | Define a cross-plugin hook contract for documentation. |
| `definePluginRoute` | Legacy: declare a plugin route with docs metadata. Prefer `defineRoute` from `/routing`. |
| `defineRouteContract` | Define a generic route contract (shared shape for API + plugin routes). |
| `defineSlotContract` | Define a UI slot contract for documentation. |

## `@makinbakin/sdk/routing`

Source: `packages/sdk/src/routing/index.ts`.

| Routing | Description |
| --- | --- |
| `defineRoute` | Define a plugin HTTP route with typed input/output and handler. |
| `defineCoreRoute` | Define a core (non-plugin) HTTP route. |
| `definePlugin` | Compose a plugin's routes into a single definition for the server. |
| `HttpMethod` | — |
| `HttpStatus` | — |
| `RouteContext` | — |
| `PluginContextLite` | — |
| `CoreContext` | — |
| `JsonBodySpec` | — |
| `MultipartBodySpec` | — |
| `RawBodySpec` | — |
| `NoBodySpec` | — |
| `BodySpec` | — |
| `JsonResponseSpec` | — |
| `NoContentResponseSpec` | — |
| `NonJsonResponseSpec` | — |
| `ResponseSpec` | — |
| `ParsedInput` | — |
| `APIRoute` | — |
| `PluginWithRoutes` | — |
| `DefinePluginInput` | — |

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated Jul 5, 2026 · Bakin 0.0.0-dev</span>
</aside>
