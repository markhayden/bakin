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
| `getPluginRoute` | Look up a specific client route by plugin id + path. |
| `getPluginRoutes` | Get all registered client routes (across all plugins). |
| `ClientRouteEntry` | — |
| `MatchedPluginRoute` | — |
| `PluginRegistration` | — |
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
import { useSearch, useAssets, useDebug } from '@makinbakin/sdk/hooks'
```

### Data & State

| Hook | Description |
| --- | --- |
| `useAssets` | Fetch and filter the asset library with live SSE updates. |
| `useTrash` | Fetch trashed assets eligible for restore or permanent delete. |
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
| `usePackageState` | Read agent-package install state (managed/adopted/unmanaged). |
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
| `EmptyState` | Centered empty-state component with icon, title, and CTA. |
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
| `registerSlot` | Register a component for a named slot. Lower `order` renders first; entries |
| `getSlotEntries` | Read the registered entries for a slot. Exported for tooling / tests. |
| `clearSlotsOwnedBy` | Remove every slot entry owned by the given plugin. Used by |
| `Slot` | Render all components registered for the named slot, in order. Extra props |

## `@makinbakin/sdk/types`

Source: `packages/sdk/src/types/index.ts`. The full plugin contract surface. Below: detailed field-level docs for the types most plugin authors directly implement, then summary tables grouped by domain.

```ts
import type { BakinPlugin, PluginContext, ExecToolDefinition } from '@makinbakin/sdk/types'
```

### Core types (full field docs)

#### `BakinPlugin`

The main plugin interface. The default export of a plugin's `index.ts`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique plugin identifier (matches manifest `id`). |
| `name` | `string` | Display name. |
| `version` | `string` | Plugin version (semver). |
| `activate` | `(ctx: PluginContext) => void \| Promise&lt;void>` | Called once at plugin load. Register routes/tools/nav/etc. here. |
| `onReady?` | `() => void \| Promise&lt;void>` | Called after all plugins have activated. Useful for cross-plugin setup. |
| `onShutdown?` | `() => void \| Promise&lt;void>` | Called when the server shuts down or the plugin is hot-swapped out. |
| `onSettingsChange?` | `(settings: Record&lt;string, unknown>) => void \| Promise&lt;void>` | Called when this plugin's settings are persisted. |
| `onUninstall?` | `(ctx: PluginContext) => void \| Promise&lt;void>` | Called when the plugin is uninstalled — clean up persisted data here. |
| `settingsSchema?` | `PluginSettingsSchema` | Settings schema rendered on this plugin's settings page. |
| `navItems?` | `NavItem[]` | Convenience: nav items to auto-register at activation. |
| `contentFiles?` | `ContentFile[]` | Convenience: static content files declared at construction. |

#### `PluginContext`

The activation context passed to a plugin's `activate(ctx)` method.

| Field | Type | Description |
| --- | --- | --- |
| `storage` | `StorageAdapter` | Plugin-scoped filesystem storage adapter. |
| `events` | `EventBus` | Cross-plugin event bus. |
| `pluginId` | `string` | ID of the plugin this context belongs to. |
| `runtime` | `AgentRuntimeAdapter` | Agent runtime adapter (agents, messaging, channels, cron, skills). |
| `tasks` | `TaskService` | Task CRUD service. |
| `assets` | `AssetsAPI` | Assets API for asset metadata + file lookups. |
| `registerNav` | `(items: NavItem[]) => void` | Register sidebar navigation items. |
| `registerRoute` | `(route: APIRoute) => void` | Register an HTTP route under `/api/plugins/{pluginId}`. |
| `registerSlot` | `(registration: UISlotRegistration) => void` | Register a component for a named slot (legacy — prefer `&lt;Slot>` from `/slots`). |
| `registerExecTool` | `(tool: ExecToolDefinition) => void` | Register an MCP exec tool agents can call. |
| `registerSkill` | `(skill: SkillDefinition) => void` | Register a runtime skill (capability definition). |
| `registerWorkflow` | `(definition: WorkflowDefinitionInput, opts?: { readOnly?: boolean }) => void` | Register a workflow definition (or template) the plugin ships. |
| `registerNodeType` | `(def: PluginNodeTypeInput&lt;T>) => string` | Register a custom workflow node type (step kind). |
| `registerNotificationChannel` | `(def: PluginNotificationChannelInput) => string` | Register a notification channel the runtime can deliver to. |
| `registerHealthCheck` | `(def: PluginHealthCheckInput) => string` | Register a health check that runs on `bakin doctor`. |
| `watchFiles` | `(patterns: string[]) => void` | Subscribe to file globs for live updates (Chokidar-based). |
| `getSettings` | `() => T` | Read this plugin's persisted settings. |
| `updateSettings` | `(patch: Record&lt;string, unknown>) => void` | Patch this plugin's persisted settings. |
| `activity` | `ActivityAPI` | Activity feed + audit log API. |
| `log?` | `PluginLogger` | Plugin-scoped structured logger. Optional — falls back to console. |
| `hooks` | `HookAPI` | Cross-plugin hook registry. |
| `search` | `SearchAPI` | Search API for indexing and querying. |

#### `PluginManifest`

The `bakin-plugin.json` manifest. Required for every plugin.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique plugin identifier (kebab-case). |
| `name` | `string` | Human-readable plugin name. |
| `version` | `string` | Plugin version (semver). |
| `bakin` | `string` | Minimum Bakin version this plugin supports. |
| `description` | `string` | One-line summary shown in the plugin manager. |
| `entry` | `PluginEntryPoints` | Server + optional client entry-point file paths. |
| `contentFiles?` | `string[]` | Static content files the plugin ships (rendered as docs/pages). |
| `secrets?` | `SecretDeclaration[]` | Environment-variable secrets the plugin requires. |
| `tests?` | `string` | Path to a test entry-point (for `bakin plugins test`). |
| `dependencies?` | `string[]` | Other plugin IDs this plugin depends on. |
| `permissions?` | `PluginPermission[]` | Capabilities this plugin requests access to. |
| `runtimeCapabilities?` | `RuntimeCapability[]` | Runtime features this plugin needs to function. |
| `contributes?` | `PluginContributions` | Everything the plugin adds to the host (routes, tools, settings, etc.). |
| `devWatch?` | `string[]` | File globs that trigger a hot reload in dev. |
| `signature?` | `PluginManifestSignature` | Optional Ed25519 signature for authenticity. |

#### `PluginContributions`

The full contributions block in `bakin-plugin.json` — everything a plugin adds to the host.

| Field | Type | Description |
| --- | --- | --- |
| `apiRoutes?` | `ApiRouteContribution[]` | HTTP routes the plugin exposes under `/api/plugins/{id}/...`. |
| `clientRoutes?` | `ClientRouteContribution[]` | Client-side routes the plugin renders (sidebar nav targets). |
| `execTools?` | `ExecToolContribution[]` | MCP exec tools agents can call. |
| `cliCommands?` | `CliCommandContribution[]` | CLI commands the plugin contributes to the `bakin` binary. |
| `settings?` | `SettingsContribution[]` | Settings keys this plugin owns in the settings UI. |
| `docs?` | `DocsContribution` | Optional docs page slug. |

#### `ExecToolDefinition`

MCP exec tool definition registered via `ctx.registerExecTool()`.

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Tool name. Convention: `bakin_exec_{pluginId}_{action}`. |
| `description` | `string` | Description shown to the agent (used for tool selection). |
| `label?` | `string` | Optional UI label for the activity feed. |
| `activityDuplicate?` | `boolean` | If true, this tool can fire multiple times in a single agent turn. |
| `parameters` | `ZodRawShape` | Zod raw shape describing the tool's parameters. |
| `handler` | `(params: Record&lt;string, unknown>, agent: string, ctx?: PluginToolContext) => Promise&lt;ExecToolResult>` | Handler that executes the tool. |
| `source?` | `string` | Optional source-file path for generated docs. |

#### `PluginToolContext`

Context passed to an exec tool handler. Subset of PluginContext sans UI registration.

| Field | Type | Description |
| --- | --- | --- |
| `storage` | `StorageAdapter` | Plugin-scoped storage adapter. |
| `events` | `EventBus` | Cross-plugin event bus. |
| `pluginId` | `string` | ID of the plugin owning this tool. |
| `runtime` | `AgentRuntimeAdapter` | Agent runtime adapter (messaging, agents, channels, cron). |
| `tasks` | `TaskService` | Task CRUD service. |
| `search` | `SearchAPI` | Search API. |
| `assets` | `AssetsAPI` | Assets API. |
| `hooks` | `HookAPI` | Hook registry. |
| `activity` | `ActivityAPI` | Activity feed and audit log. |
| `getSettings` | `() => T` | Read this plugin's persisted settings. |

#### `NavItem`

Sidebar navigation item registered by a plugin via `ctx.registerNav()`.

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique nav item id (used for active-state tracking). |
| `label` | `string` | Display label in the sidebar. |
| `icon` | `string` | Lucide icon name (e.g. "tasks", "calendar"). |
| `href` | `string` | Target route path. |
| `order?` | `number` | Sort order within the parent group. Lower renders first. |
| `children?` | `NavItem[]` | Optional nested nav items for groups. |
| `alwaysExpanded?` | `boolean` | If true, the group cannot be collapsed. |

#### `APIRoute`

HTTP route handler registered by a plugin via `ctx.registerRoute()`.

| Field | Type | Description |
| --- | --- | --- |
| `path` | `string` | Route path relative to `/api/plugins/{pluginId}`. |
| `method` | `HttpMethod` | HTTP method. |
| `handler` | `(req: Request, ctx: PluginContext) => Response \| Promise&lt;Response>` | Request handler. Receives a standard Request and the plugin context. |
| `summary?` | `string` | One-line summary for docs. |
| `description?` | `string` | Full description for docs. |
| `params?` | `string` | Path param descriptor (e.g. ":id"). |
| `input?` | `SchemaLike` | Input schema for validation and docs. |
| `output?` | `SchemaLike` | Output schema for docs. |
| `visibility?` | `ContractVisibility` | Visibility tier (public/internal/experimental). |
| `stability?` | `ContractStability` | Stability tier. |
| `examples?` | `DocsExample[]` | Reference examples for the docs site. |
| `source?` | `SourceLocation` | Source location for generated docs back-references. |
| `permissions?` | `string[]` | Permissions required to call this route. |

#### `PluginSettingsSchema`

Plugin settings schema — declares fields rendered on the settings page.

| Field | Type | Description |
| --- | --- | --- |
| `fields` | `SettingsField[]` | Ordered list of settings fields for the form. |

#### `HealthCheckResult`

Result row returned by a health check (doctor).

| Field | Type | Description |
| --- | --- | --- |
| `check` | `string` | Stable check identifier. |
| `status` | `'ok' \| 'warn' \| 'error' \| 'fixed'` | Severity of the result. |
| `message` | `string` | Human-readable message describing the finding. |
| `autoFixable` | `boolean` | Whether the issue can be auto-fixed by an attached repair handler. |

#### `BakinConfig`

The `bakin.config.ts` shape — root configuration for a Bakin installation.

| Field | Type | Description |
| --- | --- | --- |
| `plugins` | `PluginEntry[]` | Plugins to load at startup. |
| `theme?` | `Record&lt;string, string>` | Theme overrides for CSS custom properties. |
| `storage?` | `{ /** Override the default content directory. */ contentDir?: string }` | Storage configuration. |

### Shared Primitives

| Type | Description |
| --- | --- |
| `HttpMethod` | HTTP method literal used in route and contribution definitions. |
| `ContractVisibility` | Visibility tier for a documented contract (route, hook, tool, etc.). |
| `ContractStability` | Stability tier for a documented contract. |
| `SchemaLike` | Minimal interface a validation schema must satisfy (Zod-compatible). |
| `SourceLocation` | Pointer to a symbol's source file location, used in generated docs. |
| `DocsExample` | Reference example for a documented contract (request/response or code snippet). |

### Manifest Contracts

| Type | Description |
| --- | --- |
| `PluginPermission` | Capability a plugin can request in its manifest (gates access to APIs). |
| `RuntimeCapability` | Runtime feature a plugin declares it needs (used by doctor/health checks). |
| `PluginEntryPoints` | Server and client entry-point file paths for a plugin. |
| `SecretDeclaration` | Secret (env var) a plugin declares it needs (rendered in setup/health). |
| `ApiRouteContribution` | Manifest declaration of an HTTP route the plugin exposes. |
| `JsonSchemaContribution` | Raw JSON Schema object embedded in API contributions. |
| `ApiParameterContribution` | Path/query/header/cookie parameter declaration for an API route. |
| `ApiRequestBodyContribution` | Request body declaration for an API route. |
| `ApiResponseContribution` | Response declaration for one HTTP status code on an API route. |
| `ClientRouteContribution` | Manifest declaration of a client-side route the plugin contributes. |
| `ExecToolContribution` | Manifest declaration of an MCP exec tool the plugin exposes. |
| `CliCommandContribution` | Manifest declaration of a CLI command the plugin contributes. |
| `SettingsContribution` | Manifest declaration of a settings key the plugin owns. |
| `DocsContribution` | Manifest declaration of the plugin's docs page slug. |
| `PluginManifestSignature` | Optional Ed25519 signature block proving manifest authenticity. |

### Storage & Events

| Type | Description |
| --- | --- |
| `StorageStat` | File metadata returned by storage adapter `stat()`. |
| `StorageAdapter` | Plugin-scoped filesystem adapter passed via `ctx.storage`. |
| `EventBus` | Cross-plugin event bus. Emit and subscribe by pattern. |
| `ActivityAPI` | Activity feed + structured audit log API exposed on the plugin context. |
| `PluginLogger` | Plugin-scoped structured logger (writes to server log + stdout). |
| `HookAPI` | Cross-plugin RPC/event/waterfall hook registry. |
| `HookRegistrationMetadata` | Optional documentation metadata for a registered hook. |
| `HookKind` | Hook semantics: single-return RPC, fire-and-forget event, or input transform waterfall. |

### UI & Navigation

| Type | Description |
| --- | --- |
| `UISlotRegistration` | Slot registration record: place a component at a named extension point. |
| `ContentFile` | Static content file shipped with a plugin (e.g. README, docs page). |

### Runtime

| Type | Description |
| --- | --- |
| `RuntimeAgent` | An agent registered with the runtime (OpenClaw, etc.). |
| `RuntimeChannel` | A messaging channel (Discord, Slack, email, etc.) registered with the runtime. |
| `RuntimeMessageToolsMode` | Whether to expose runtime-native tools for this agent turn. |
| `RuntimeMessageToolPolicy` | Per-turn policy for which runtime tools the agent may call. |
| `RuntimeMessageArgs` | Arguments for a single message dispatched to an agent. |
| `RuntimeMessageResult` | Result returned by a non-streaming runtime message. |
| `RuntimeToolActivity` | Tool call/result event surfaced during a streaming agent turn. |
| `RuntimeChatChunk` | One chunk in a streaming agent response (text, tool, status, done, error). |
| `CronJob` | A cron-scheduled job tracked by the runtime. |
| `CronRun` | Execution record for a single cron job run. |
| `RuntimeSkill` | A skill (runtime-side capability) registered with an agent. |
| `WorkspaceFile` | A file in an agent's runtime workspace. |
| `AgentRuntimeAdapter` | Provider-agnostic interface for agent runtime adapters (OpenClaw, etc.). |

### Tasks

| Type | Description |
| --- | --- |
| `TaskLogEntry` | One entry in a task's activity log. |
| `Task` | A task on the Bakin board. |
| `TaskSource` | Identifies the plugin/entity that originated a task. |
| `TaskColumns` | The seven task board columns. |
| `TaskBoard` | The full task board snapshot (columns + timestamp). |
| `ColumnId` | Valid task column identifier (keyof TaskColumns). |
| `TaskCreateInput` | Payload for `tasks.create()`. |
| `TaskUpdateInput` | Patch payload for `tasks.update()`. Nullable fields explicitly clear. |
| `TaskService` | CRUD service for tasks, exposed via `ctx.tasks`. |

### Search

| Type | Description |
| --- | --- |
| `SearchSchemaField` | Field schema entry for a search content type. |
| `SearchIndexDefinition` | Named index definition (embedder + chunker config) for a content type. |
| `SearchContentTypeDefinition` | Full content-type definition: schema, indexes, facets, reindex generator. |
| `FilePatternMapper` | File glob + mappers used by file-backed search content types. |
| `FileBackedContentTypeDefinition` | File-backed content type: indexes documents derived from on-disk files. |
| `SearchQueryParams` | Query payload for `search.query()` — filters, facets, paging, strategy. |
| `SearchResult` | A single search hit with score and field projection. |
| `SearchResponse` | Full search response: results, aggregations, and query metadata. |
| `SearchHealthSnapshot` | Health snapshot reported by the search adapter (per-table state). |
| `SearchTransformOp` | Atomic transform operation applied to an indexed document. |
| `SearchAPI` | Search API exposed via `ctx.search` — index, query, transform documents. |

### Assets

| Type | Description |
| --- | --- |
| `AssetVariantMeta` | Auto-generated variant (thumbnail/optimized/webp) for an asset. |
| `AssetMeta` | Full asset record: file info + sidecar metadata + auto-generated variants. |
| `TrashedAssetMeta` | Asset record while in trash (with deleted/expires timestamps). |
| `AssetFileRef` | Compact reference to an asset by filename — used in channel deliveries. |
| `AssetsAPI` | Assets API exposed via `ctx.assets` — read-only asset lookups. |

### Exec Tools & Workflows

| Type | Description |
| --- | --- |
| `ExecToolResult` | Result returned from an exec tool handler. |
| `SkillDefinition` | Runtime skill definition registered via `ctx.registerSkill()`. |
| `WorkflowLayoutInput` | Layout hints for a workflow's canvas rendering. |
| `WorkflowDefinitionInput` | Plugin-contributed workflow definition input shape. |
| `FormFieldType` | Field types supported by FormField. |
| `FormField` | Form field descriptor for plugin-contributed workflow nodes. |
| `EdgeRules` | Edge constraints for a plugin-contributed workflow node type. |
| `PluginNodeTypeInput` | Workflow node type contributed by a plugin (custom step kind). |
| `PluginNotificationChannelInput` | Notification channel definition contributed by a plugin. |

### Health

| Type | Description |
| --- | --- |
| `HealthRepairSafety` | Repair safety tier: safe (auto), manual (needs review), destructive (data-affecting). |
| `HealthRepairChange` | Single change a repair plan will apply. |
| `HealthRepairPlanItem` | One item in a repair plan: what will change and why. |
| `HealthRepairApplyResult` | Result of applying a single repair plan item. |
| `HealthRepairHandler` | Two-phase repair handler attached to a health check. |
| `PluginHealthCheckInput` | Health check registration input passed to `ctx.registerHealthCheck()`. |

### Settings

| Type | Description |
| --- | --- |
| `StringSettingsField` | Single-line text settings field. |
| `NumberSettingsField` | Numeric settings field with optional default. |
| `BooleanSettingsField` | Boolean toggle settings field. |
| `SelectSettingsField` | Dropdown settings field with predefined options. |
| `ListSettingsField` | Repeatable list settings field with per-item shape. |
| `SettingsField` | Union of all supported settings field types. |

### Workflows

| Type | Description |
| --- | --- |
| `WorkflowDefinition` | A workflow definition stored on disk (YAML or programmatic). |
| `WorkflowInstance` | A running instance of a workflow attached to a task. |
| `WorkflowStep` | One step in a workflow definition or instance. |
| `WorkflowTemplate` | Alias for WorkflowDefinition when used as a reusable template. |

### Calendar & Memory

| Type | Description |
| --- | --- |
| `CalendarEvent` | Single calendar event (time + text). |
| `CalendarDay` | One day on an agent's calendar (date + list of events). |
| `RecurringEvent` | A recurring event (cron expression + display text). |
| `MemoryEntry` | Single memory entry (decision, learned-thing, or freeform note). |
| `MemoryDay` | Memory entries grouped by day. |
| `Heartbeat` | Agent heartbeat snapshot (status + current task + timestamp). |

### Projects & Models

| Type | Description |
| --- | --- |
| `ProjectMeta` | Project metadata loaded from a markdown project file. |
| `AvailableModel` | A model available in the models catalog (LLM, image, or video). |

### Configuration

| Type | Description |
| --- | --- |
| `PluginEntry` | A plugin entry in `bakin.config.ts`. |

## `@makinbakin/sdk/utils`

Source: `packages/sdk/src/utils/index.ts`.

| Utility | Description |
| --- | --- |
| `cn` | Tailwind class merger (clsx + tailwind-merge). |
| `formatAge` | Format a Date or ISO string as a relative age (e.g. "5m ago"). |
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
  <span>Generated May 27, 2026 · Bakin 0.0.0-dev</span>
</aside>
