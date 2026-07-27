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
| `registerPluginCleanup` | Register a cleanup callback fired when the plugin is unregistered. |
| `setNavBadge` | Set or clear a runtime badge on a plugin-owned nav item. |
| `getNavBadge` | Read the current badge for a nav item, or undefined if none. |
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
| `usePluginJsonFetch` | Cancellable JSON GET with a `{ data, loading, error, refresh }` lifecycle. |
| `UseJsonFetchResult` | — |
| `useOccurrences` | — |
| `ScheduleOccurrence` | — |
| `ScheduledDomainEvent` | — |
| `useTaskRunHistory` | Fetch dispatch run history for a task. |
| `TaskOutcome` | — |
| `TaskRunEntry` | — |
| `usePluginEvent` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `emitPluginEvent` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `PluginEventPayload` | Subscribe to a server-pushed plugin event over the shell's single connection. |
| `useFileDrop` | Headless drag-drop file intake (drag-over state + handlers + accept filter) — style your own zone. |
| `UseFileDropOptions` | — |
| `UseFileDropResult` | — |
| `useHistoryBack` | History-aware back for detail surfaces reachable from many places — real back() with a fallback route for cold deep-links. |
| `useHorizontalResize` | Resize a side-by-side split pane by dragging the divider between columns. |
| `useAvailableModels` | The available-models catalog (cached, read-only); empty until loaded. |
| `toNavigationOptions` | Split a browser-style URL string into TanStack navigate options (non-hook). |

## `@makinbakin/sdk/components`

Source: `packages/sdk/src/components/index.ts`.

```ts
import { PluginHeader, FacetFilter, AgentAvatar } from '@makinbakin/sdk/components'
```

| Component | Description |
| --- | --- |
| `AgentAvatar` | Round avatar image for an agent, falls back to initials. |
| `AgentFilter` | Multi-select facet filter scoped to agents. |
| `AgentSelect` | Single-agent (or team, #189) picker dropdown for form fields. |
| `TEAM_VALUE_PREFIX` | Single-agent (or team, #189) picker dropdown for form fields. |
| `isTeamValue` | Single-agent (or team, #189) picker dropdown for form fields. |
| `teamIdFromValue` | Single-agent (or team, #189) picker dropdown for form fields. |
| `AgentDot` | Small status dot showing an agent's online/offline state. |
| `AgentStatus` | Compound agent status (dot + label + last-seen timestamp). |
| `AssetPicker` | Modal asset chooser (thumbnail grid + search + upload-new) over the assets plugin — never a raw id select. |
| `AssetPickerProps` | — |
| `AssetPickerAsset` | — |
| `BakinDrawer` | Right-side slide-out drawer with backdrop and focus trap. |
| `ColorPicker` | Color picker swatch grid for tag/agent color assignment. |
| `ConfirmDialog` | Controlled confirmation dialog for destructive actions (busy/error aware; optional typed confirmation via `confirmValue`). |
| `ConfirmDialogProps` | — |
| `DangerZone` | Red-bordered destructive settings section with typed-confirmation delete — bottom of every settings surface. |
| `DangerZoneProps` | — |
| `EmptyState` | Centered empty-state component with icon, title, and CTA. |
| `SaveBar` | Sticky save/discard bar for staged-draft pages (THE dirty-state pattern) + `useUnsavedGuard`. |
| `useUnsavedGuard` | Sticky save/discard bar for staged-draft pages (THE dirty-state pattern) + `useUnsavedGuard`. |
| `SaveBarProps` | — |
| `useUnsavedChangesGuard` | Full navigation guard for dirty surfaces: beforeunload + TanStack history block + anchor interception + exit dialog. |
| `UnsavedChangesGuardOptions` | — |
| `SectionCard` | Titled card with icon + a one-line "why this matters" description — the standard section wrapper. |
| `SectionCardProps` | — |
| `SegmentedControl` | THE segmented control / mode toggle (Edit\|Preview, Board\|Log, time windows) — tablist semantics, neutral active segment. |
| `SegmentedControlProps` | — |
| `SegmentedControlOption` | — |
| `StatTile` | THE metric tile — icon + uppercase micro-label + tabular big number, optional sub/meter. |
| `StatTileProps` | — |
| `StatusBadge` | THE status chip — one tone scale (neutral/success/warning/destructive/accent) for every state badge. |
| `StatusBadgeProps` | — |
| `StatusTone` | — |
| `SearchUnavailable` | — |
| `ScoreOverlay` | — |
| `computeMatchedFields` | — |
| `SearchPartialChip` | — |
| `SearchPartialMeta` | — |
| `SearchDegradedChip` | Amber "search down — basic text matching" chip for surfaces with a substring fallback. |
| `ScoreOverlayInfo` | — |
| `ErrorBanner` | Inline error banner with dismiss + retry actions. |
| `ErrorState` | Full-page error state with title, description, and retry button. |
| `FacetFilter` | Popover multi-select facet filter (column, owner, tag, etc.). |
| `FacetOption` | — |
| `MarkdownContent` | Render markdown content with syntax highlighting and link handling. |
| `MarkdownEditor` | Editable markdown text area with preview toggle. |
| `ModelSelect` | Model picker dropdown listing available models from the catalog. |
| `PageLayout` | Standard plugin page wrapper with header, content area, and toaster. |
| `PluginLink` | Client-side link for runtime-registered plugin and cross-plugin routes. |
| `PluginLinkProps` | — |
| `PluginHeader` | Plugin page header with title, count badge, search, and action buttons. |
| `PluginHeaderProps` | — |
| `PluginSettingsRenderer` | Render a settings form from a PluginSettingsSchema definition. |
| `PluginSettingsSchema` | — |
| `SortableHead` | Sortable table column header with ascending/descending indicator. |
| `SortDir` | — |
| `UnderlineTabs` | Tab list with animated underline indicator. |
| `UnderlineTab` | — |
| `TurnOutputView` | THE single renderer for normalized turn chunks (text/tool/status/error) — turn-output surfaces consume this, never hand-rolled format heuristics. |
| `TurnToolChip` | THE single renderer for normalized turn chunks (text/tool/status/error) — turn-output surfaces consume this, never hand-rolled format heuristics. |
| `foldTurnChunks` | THE single renderer for normalized turn chunks (text/tool/status/error) — turn-output surfaces consume this, never hand-rolled format heuristics. |
| `TurnOutputViewProps` | — |
| `TurnToolChipState` | — |
| `TurnTextSegment` | — |
| `FoldedTurnOutput` | — |
| `foldConversation` | — |
| `ConversationMessage` | — |
| `ConversationTurn` | — |
| `ConversationToolCall` | — |
| `TurnItem` | — |
| `TurnStatus` | — |
| `DisplayAttachment` | — |
| `FoldOptions` | — |
| `Conversation` | — |
| `ConversationProps` | — |
| `AgentTurn` | — |
| `ThinkingIndicator` | — |
| `CopyButton` | — |
| `TurnTimestamp` | — |
| `AgentTurnProps` | — |
| `UserMessage` | — |
| `UserMessageProps` | — |
| `ActivityGroup` | — |
| `ToolCallRow` | — |
| `formatDuration` | — |
| `humanizeActivity` | — |
| `ActivityGroupProps` | — |
| `ToolCallDrawer` | — |
| `ToolCallDrawerProps` | — |
| `Composer` | — |
| `writeComposerDraft` | — |
| `ComposerProps` | — |
| `ComposerAttachments` | — |
| `ComposerAttachmentItem` | — |
| `ComposerHandle` | — |
| `QueuedMessageList` | — |
| `ConversationQueuedItem` | — |
| `formatTokenCount` | — |
| `formatUsageCost` | — |
| `ConversationTurnUsage` | — |
| `ContextMeter` | — |
| `contextMeterHasContent` | — |
| `ContextMeterStats` | — |
| `ConversationPanel` | — |
| `ConversationPanelProps` | — |
| `useConversationThread` | — |
| `ConversationThread` | — |
| `ConversationThreadLoad` | — |
| `ConversationThreadOptions` | — |
| `attentionForDone` | — |
| `badgeFor` | — |
| `visibleIdFromLocation` | — |
| `withUnreadPrefix` | — |
| `AttentionActions` | — |
| `ConversationAttentionContext` | — |
| `ConversationDonePayload` | — |
| `playReplyChime` | — |
| `ConversationReplyToast` | — |
| `useConversationAttention` | — |
| `ConversationAttentionConfig` | — |
| `ConversationAttentionTotals` | — |
| `ConversationEmptyState` | — |
| `ConversationEmptyStateProps` | — |
| `formatRelativeTime` | — |
| `formatAbsoluteTime` | — |
| `ChannelIcon` | Icon component for a notification channel (Discord, Slack, email, etc.). |
| `ChartDataTable` | Exact table/disclosure shared by visual chart summaries. |
| `ChartDataTableProps` | — |
| `ChartDatum` | — |
| `ChartSeries` | — |
| `LineChart` | Multi-series SVG line chart with keyboard-equivalent marks. |
| `LineChartProps` | — |
| `BarChart` | Grouped or stacked SVG bar chart with keyboard-equivalent marks. |
| `BarChartProps` | — |
| `StackedColumnChart` | Stacked column chart with legend toggle + per-column pointer/keyboard breakdown. |
| `StackedColumnChartProps` | — |
| `StackedColumnDatum` | — |
| `Sparkline` | Tiny inline SVG trend line for embedding beside a stat. |
| `SparklineProps` | — |
| `ChartExplainer` | One-line "what am I looking at / when to worry" chart footer. |
| `CHART_SERIES_COLORS` | CVD-validated series palette + deterministic entity→color assignment. |
| `CHART_OTHER_COLOR` | CVD-validated series palette + deterministic entity→color assignment. |
| `CHART_MAX_SERIES` | CVD-validated series palette + deterministic entity→color assignment. |
| `assignSeriesColors` | CVD-validated series palette + deterministic entity→color assignment. |

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

### Health

| Type | Description |
| --- | --- |
| `JsonValue` | Canonical Health contracts shared by plugin authors, adapters, core, HTTP |
| `JsonObject` | — |
| `HealthNonEmptyArray` | A tuple used wherever an empty list would make the contract ambiguous. |
| `HealthObservationStatus` | — |
| `HealthDisposition` | — |
| `HealthReportStatus` | — |
| `HEALTH_INCIDENT_CLASSES` | Producer-stamped behavior class (#690) — what KIND of problem an incident |
| `HealthIncidentClass` | — |
| `HealthSensitivity` | Health sensitivity mode (#690): how loudly findings surface. `developer` |
| `HealthOwnerKind` | — |
| `HealthOwner` | Core-stamped owner of a registration or canonical finding. |
| `HealthGroup` | Stable subsystem grouping supplied by a registration. |
| `HealthResourceKind` | — |
| `HealthResource` | Stable reference to a resource affected by an incident. |
| `HealthRepairResolution` | — |
| `HealthNavigateResolution` | — |
| `HealthInstructionsResolution` | — |
| `HealthRerunResolution` | — |
| `HealthResolution` | — |
| `HealthIncidentBaseInput` | — |
| `AdvisoryIncidentInput` | — |
| `WatchIncidentInput` | — |
| `ActionIncidentInput` | — |
| `HealthIncidentInput` | — |
| `HealthObservationBaseInput` | — |
| `HealthyObservationInput` | — |
| `WarningObservationInput` | — |
| `ErrorObservationInput` | — |
| `UnknownObservationInput` | — |
| `HealthObservationInput` | Status-discriminated producer observation; illegal combinations do not typecheck. |
| `ObservedHealthCheckRunInput` | — |
| `NotApplicableHealthCheckRunInput` | — |
| `HealthCheckRunInput` | — |
| `HealthCheckRunContext` | Cancellation context supplied by core when it executes a health check. |
| `HealthCheckRegistrationInput` | Plugin- or adapter-authored check definition; core supplies owner metadata. |
| `HealthRepairSafety` | — |
| `HealthRepairChange` | — |
| `HealthRepairTarget` | — |
| `HealthRepairPrecondition` | — |
| `HealthRepairPlanItem` | — |
| `HealthRepairPlan` | — |
| `HealthRepairApplyRequest` | — |
| `HealthRepairApplyResult` | — |
| `HealthRepairActionDefinition` | Owner-local repair action registered separately from diagnostic checks. |
| `CanonicalHealthyObservation` | — |
| `CanonicalWarningObservation` | — |
| `CanonicalErrorObservation` | — |
| `CanonicalUnknownObservation` | — |
| `HealthObservation` | Validated, core-stamped observation retained in immutable check snapshots. |
| `HealthCheckExecutionError` | — |
| `HealthCheckExecution` | — |
| `HealthIncident` | — |
| `HealthCheckSnapshot` | — |
| `HealthCheckState` | Cached state for one currently registered check. |
| `SearchReadinessStatus` | — |
| `SearchStageStatus` | — |
| `SearchReadinessStageKey` | — |
| `SearchReadinessStage` | — |
| `SearchReadiness` | — |
| `HealthReportCheckSummary` | — |
| `HealthReportIncidentSummary` | — |
| `HealthReportSummary` | — |
| `HealthFullSweep` | — |
| `HealthReportSubsystems` | — |
| `HealthReport` | — |

## `@makinbakin/sdk/utils`

Source: `packages/sdk/src/utils/index.ts`.

| Utility | Description |
| --- | --- |
| `healthError` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthHealthy` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthNotApplicable` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthObserved` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthResourceId` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthUnknown` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `healthWarning` | `@makinbakin/sdk/utils` — tiny utilities for plugin authors. |
| `cn` | Tailwind class merger (clsx + tailwind-merge). |
| `copyToClipboard` | — |
| `BadgeTone` | Semantic tone for an outline status badge. |
| `toneBadgeClass` | Classes for an outline status badge of the given tone — the |
| `isValidAssetId` | Pure assetId shape validators (see ./asset-id). |
| `yearMonthFromAssetId` | Pure assetId shape validators (see ./asset-id). |
| `formatAge` | Format a Date or ISO string as a relative age (e.g. "5m ago"). |
| `formatDateTime` | Format an ISO timestamp as a calendar-aware absolute date+time (e.g. "Today 3:45 PM", "Jan 5 9:02 AM"). |
| `formatDuration` | Format a millisecond count as an elapsed duration (e.g. "42s", "3m 5s"); null when undefined. |
| `formatSize` | Format a byte count as a human-readable size string (e.g. "1.2 MB"). |
| `isStale` | Returns true if a timestamp is older than a configurable staleness threshold. |
| `conversationThreadId` | Canonical thread id for embedded conversation surfaces (scope:entity:agent). |
| `createTurnRecorder` | Record one streamed turn's chunks into persistable ConversationMessage rows. |
| `SUMMARY_MAX_CHARS` | Record one streamed turn's chunks into persistable ConversationMessage rows. |
| `PREVIEW_MAX_CHARS` | Record one streamed turn's chunks into persistable ConversationMessage rows. |
| `TurnRecorder` | — |
| `humanizeKey` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `formatStructured` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `summarizeStructured` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `unwrapToolResult` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `FormatStructuredOptions` | Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. |
| `pluginFetch` | Fetch a plugin's own API route (`/api/plugins/&lt;id>/&lt;path>`) with JSON defaults. |
| `pluginApiUrl` | Fetch a plugin's own API route (`/api/plugins/&lt;id>/&lt;path>`) with JSON defaults. |

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
  <span>Generated Jul 26, 2026 · Bakin 0.0.0-dev</span>
</aside>
