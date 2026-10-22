/**
 * `@makinbakin/sdk/hooks` — React hooks plugin authors can use.
 *
 * Group 1 (Bakin-wide: SSE, search, query-state, debug, operations, …) lives
 * HERE as the `./use-*` files. Groups 2–3 re-export cross-plugin hooks from
 * plugin source on purpose:
 *   2. `plugins/team/hooks/*` (agent data)
 *   3. `plugins/workflows/hooks/*` (notification channels)
 *
 * DELIBERATE ARRANGEMENT (audit P2 #5, decided 2026-07 in FW3): each of those
 * hooks' wire contract (the `/api/plugins/<id>/...` routes it fetches) is
 * owned by its plugin, so the implementation lives WITH that contract; the
 * SDK re-export exists so external authors get one import surface. The npm
 * publish build BUNDLES these sources into the package and
 * `assertNoForbiddenImports` (scripts/build-sdk-package.ts) fails the release
 * if any `@bakin/*` specifier survives — the published SDK is self-contained.
 * Moving the implementations into the SDK would decouple them from the routes
 * they call, which is the worse drift.
 */

// Group 1: Bakin-wide hooks

/** Access the global Zustand store for SSE-driven content state. */
export { useContentStore } from './use-content-store'
/** Sync a nav item's badge to a derived value; the recommended provider glue. */
export { useNavBadge } from './use-nav-badge'
/** Read/toggle the global debug (X-Ray) flag. */
export { useDebug } from './use-debug'
/** Cancellable JSON GET with a `{ data, loading, error, refresh }` lifecycle. */
export { useJsonFetch, usePluginJsonFetch } from './use-json-fetch'
export type { UseJsonFetchOptions, UseJsonFetchResult } from './use-json-fetch'
/** Subscribe to runtime connection status (online/offline, last heartbeat). */
export { useRuntimeStatus } from './use-runtime-status'
/** @deprecated Import URL-backed state from `@makinbakin/sdk/navigation`. */
export { useQueryState } from './use-query-state'
/** @deprecated Import URL-backed state from `@makinbakin/sdk/navigation`. */
export { useQueryArrayState } from './use-query-state'
/** List scheduled jobs with live updates. */
export { useScheduleJobs } from './use-schedule'
/** Fetch run history for a scheduled job. */
export { useRunHistory } from './use-schedule'
export { useOccurrences } from './use-schedule'
export type { ScheduleJob, RunEntry, ScheduleOccurrence, ScheduledDomainEvent } from './use-schedule'
/** Fetch dispatch run history for a task. */
export { useTaskRunHistory } from './use-task-run-history'
export type { TaskOutcome, TaskRunEntry } from './use-task-run-history'
/** Hybrid full-text + semantic search across plugins with facet filtering. */
export { useSearch } from './use-search'
/** Query-path warm signal ('cold' | 'warming' | 'warm') for search-bar UI. */
/** Re-rank a local list to match the order returned by a search query. */
export { reorderBySearchResults } from './use-search'
export type { SearchResult, SearchResponse, UseSearchOptions, UseSearchReturn } from './use-search'
/** Read sidebar open/closed state and toggle helper. */
export { useSidebar } from './use-sidebar'
/** Subscribe to a Server-Sent Events endpoint with auto-reconnect. */
export { useSSE } from './use-sse'
/** Subscribe to a server-pushed plugin event over the shell's single connection. */
export { usePluginEvent, emitPluginEvent, type PluginEventPayload } from './use-plugin-event'
/** A render-safe clock: the instant at mount, refreshed on an interval (default 60 s). */
export { useNow } from '@bakin/ui/behaviors'
/** useState that resets when a key changes — adjust state on a prop change without an effect. */
export { useKeyedState } from '@bakin/ui/behaviors'
/** Whether a CSS media query matches, as an external-store read (false without matchMedia). */
export { useMediaQuery } from '@bakin/ui/behaviors'
/** Follow one server operation live (rev/boot guards, reconcile, expired vs restarted vs unreachable). */
export { useOperation } from './use-operation'

/** Self-update verification after a restart handoff (#1007 D7.11). */
export { useSelfUpdateVerification } from './use-self-update-verification'
export type { SelfUpdateHandoff, SelfUpdateVerificationState } from './use-self-update-verification'
/** Call a converted long-running route and get its `{ operationId, bootId }`. */
export { startOperation } from './use-operation'
/** Thrown by `startOperation` when the route refuses; carries its status and JSON body. */
export { OperationStartError } from './use-operation'
export type { UseOperationOptions, UseOperationResult } from './use-operation'
/** @deprecated Import history-aware back from `@makinbakin/sdk/navigation`. */
export { useHistoryBack } from './use-history-back'
/** Fire a toast notification (success/error/info). */
export { toast } from './use-toast'
/** Subscribe to the toast store for custom toast UIs. */
export { useToastStore } from './use-toast'
/** Send an OS notification (no-op when disabled or the tab is focused); the click navigates client-side. */
export { sendBrowserNotification } from '../internal/browser-notify'
/** Resize a side-by-side split pane by dragging the divider between columns. */
export { useHorizontalResize } from './use-horizontal-resize'

// Group 2: Agent data (from team plugin)

/** Access the agent registry store (Zustand). */
export { useAgentStore } from '@bakin/team/hooks/use-agent-store'
/** Look up a single agent by ID. */
export { useAgent } from '@bakin/team/hooks/use-agent-store'
/** The identity the kit avatar renders for a registered agent (display-name override, headshot, colour). */
export { useAgentIdentity } from '@bakin/team/hooks/use-agent-store'
/** List all registered agents. */
export { useAgentList } from '@bakin/team/hooks/use-agent-store'
/** Get an agent's brand color (hex string). */
export { useAgentColor } from '@bakin/team/hooks/use-agent-store'
/** Get an agent's display name (fallback to ID). */
export { useAgentDisplayName } from '@bakin/team/hooks/use-agent-store'
/** List all registered agent IDs. */
export { useAgentIds } from '@bakin/team/hooks/use-agent-store'
/** Get the ID of the designated main/orchestrator agent. */
export { useMainAgentId } from '@bakin/team/hooks/use-agent-store'
/** Read agent-package install state (managed/unmanaged). */
export { usePackageState } from '@bakin/team/hooks/use-agent-store'
/** Convert a hex color to a muted variant for backgrounds. */
export { hexToMuted } from '@bakin/team/hooks/use-agent-store'

// Group 3: Notification channels (from workflows plugin)

/** List configured notification channels (Discord, Slack, email, etc.). */
export { useNotificationChannels } from '@bakin/workflows/hooks/use-notification-channels'
/** Get a human-readable label for a channel ID. */
export { getChannelLabel } from '@bakin/workflows/hooks/use-notification-channels'
/** Get initials for a channel (e.g. "Discord" → "D"). */
export { getChannelInitials } from '@bakin/workflows/hooks/use-notification-channels'

// Group 3b: Model catalog

/** The available-models catalog (cached, read-only); empty until loaded. */
export { useAvailableModels, toModelSelectOptions } from './use-available-models'
export type { EligibleModelOption } from './use-available-models'

// Group 4: Router compatibility adapters; new work uses the navigation entrypoint.

/** @deprecated Import browser navigation from `@makinbakin/sdk/navigation`. */
export { useRouter } from './router'
/** @deprecated Import browser navigation from `@makinbakin/sdk/navigation`. */
export { usePathname } from './router'
/** @deprecated Import browser navigation from `@makinbakin/sdk/navigation`. */
export { useSearchParams } from './router'
/** @deprecated Import browser navigation from `@makinbakin/sdk/navigation`. */
export { useParams } from './router'
/** @deprecated Import browser navigation from `@makinbakin/sdk/navigation`. */
export { toNavigationOptions } from './router'
