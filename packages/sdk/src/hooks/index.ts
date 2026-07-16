/**
 * `@makinbakin/sdk/hooks` — React hooks plugin authors can use.
 *
 * Three groups, all re-exports so plugins have one import path:
 *   1. Bakin-wide hooks from `src/hooks/*` (SSE, search, query-state, debug, etc.)
 *   2. Cross-plugin hooks from `plugins/team/hooks/*` (agent data)
 *   3. Cross-plugin hooks from `plugins/workflows/hooks/*` (notification channels)
 *
 * DELIBERATE ARRANGEMENT (audit P2 #5, decided 2026-07 in FW3): groups 2-3
 * reach into plugin source on purpose. Each hook's wire contract (the
 * `/api/plugins/<id>/...` routes it fetches) is owned by its plugin, so the
 * implementation lives WITH that contract; the SDK re-export exists so
 * external authors get one import surface. The npm publish build BUNDLES
 * these sources into the package and `assertNoForbiddenImports`
 * (scripts/build-sdk-package.ts) fails the release if any `@bakin/*`
 * specifier survives — the published SDK is self-contained. Moving the
 * implementations into the SDK would decouple them from the routes they
 * call, which is the worse drift.
 */

// Group 1: Bakin-wide hooks

/** Access the global Zustand store for SSE-driven content state. */
export { useContentStore } from '@/hooks/use-content-store'
/** Sync a nav item's badge to a derived value; the recommended provider glue. */
export { useNavBadge } from '@/hooks/use-nav-badge'
/** Read/toggle the global debug (X-Ray) flag. */
export { useDebug } from '@/hooks/use-debug'
/** Guard a form against unmounting while submission is in flight. */
export { useFormGuard } from '@/hooks/use-form-guard'
/** Cancellable JSON GET with a `{ data, loading, error, refresh }` lifecycle. */
export { useJsonFetch, usePluginJsonFetch } from '@/hooks/use-json-fetch'
export type { UseJsonFetchResult } from '@/hooks/use-json-fetch'
/** Subscribe to runtime connection status (online/offline, last heartbeat). */
export { useRuntimeStatus } from '@/hooks/use-runtime-status'
/** Bind a single component-state value to a URL query param. */
export { useQueryState } from '@/hooks/use-query-state'
/** Bind a multi-value (array) component state to a URL query param. */
export { useQueryArrayState } from '@/hooks/use-query-state'
/** List scheduled jobs with live updates. */
export { useScheduleJobs } from '@/hooks/use-schedule'
/** Fetch run history for a scheduled job. */
export { useRunHistory } from '@/hooks/use-schedule'
export { useOccurrences } from '@/hooks/use-schedule'
export type { ScheduleJob, RunEntry, ScheduleOccurrence } from '@/hooks/use-schedule'
/** Fetch dispatch run history for a task. */
export { useTaskRunHistory } from '@/hooks/use-task-run-history'
export type { TaskOutcome, TaskRunEntry } from '@/hooks/use-task-run-history'
/** Hybrid full-text + semantic search across plugins with facet filtering. */
export { useSearch } from '@/hooks/use-search'
/** Query-path warm signal ('cold' | 'warming' | 'warm') for search-bar UI. */
/** Re-rank a local list to match the order returned by a search query. */
export { reorderBySearchResults } from '@/hooks/use-search'
export type { SearchResult, SearchResponse, UseSearchOptions, UseSearchReturn } from '@/hooks/use-search'
/** Read sidebar open/closed state and toggle helper. */
export { useSidebar } from '@/hooks/use-sidebar'
/** Subscribe to a Server-Sent Events endpoint with auto-reconnect. */
export { useSSE } from '@/hooks/use-sse'
/** Subscribe to a server-pushed plugin event over the shell's single connection. */
export { usePluginEvent, emitPluginEvent, type PluginEventPayload } from '@/hooks/use-plugin-event'
/** Headless drag-drop file intake (drag-over state + handlers + accept filter) — style your own zone. */
export { useFileDrop } from '@/hooks/use-file-drop'
export type { UseFileDropOptions, UseFileDropResult } from '@/hooks/use-file-drop'
/** History-aware back for detail surfaces reachable from many places — real back() with a fallback route for cold deep-links. */
export { useHistoryBack } from '@/hooks/use-history-back'
/** Fire a toast notification (success/error/info). */
export { toast } from '@/hooks/use-toast'
/** Subscribe to the toast store for custom toast UIs. */
export { useToastStore } from '@/hooks/use-toast'
/** Imperatively resize a vertical pane via mouse drag handle. */
export { useVerticalResize } from '@/hooks/use-vertical-resize'
/** Resize a side-by-side split pane by dragging the divider between columns. */
export { useHorizontalResize } from '@/hooks/use-horizontal-resize'

// Group 2: Agent data (from team plugin)

/** Access the agent registry store (Zustand). */
export { useAgentStore } from '@bakin/team/hooks/use-agent-store'
/** Look up a single agent by ID. */
export { useAgent } from '@bakin/team/hooks/use-agent-store'
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
export { useAvailableModels } from '@/hooks/use-available-models'

// Group 4: Router hooks (TanStack Router wrappers; Next.js-shape compatible)

/** Access the TanStack Router instance for imperative navigation. */
export { useRouter } from './router'
/** Current URL pathname (Next.js-shape compatible). */
export { usePathname } from './router'
/** Current URL search params as a URLSearchParams instance. */
export { useSearchParams } from './router'
/** Current route's typed path parameters. */
export { useParams } from './router'
