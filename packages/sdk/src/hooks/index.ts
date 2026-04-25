/**
 * `@bakin/sdk/hooks` — React hooks plugin authors can use.
 *
 * Three groups, all re-exports so plugins have one import path:
 *   1. Bakin-wide hooks from `src/hooks/*` (SSE, search, query-state, debug, etc.)
 *   2. Cross-plugin hooks from `plugins/team/hooks/*` (agent data)
 *   3. Cross-plugin hooks from `plugins/workflows/hooks/*` (notification channels)
 */

// Group 1: Bakin-wide hooks
export { useAssets, useTrash } from '@/hooks/use-assets'
export { useContentStore } from '@/hooks/use-content-store'
export { useDebug } from '@/hooks/use-debug'
export { useFormGuard } from '@/hooks/use-form-guard'
export { useGatewayStatus } from '@/hooks/use-gateway-status'
export { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'
export { useScheduleJobs, useRunHistory } from '@/hooks/use-schedule'
export type { ScheduleJob, RunEntry } from '@/hooks/use-schedule'
export { useSearch, reorderBySearchResults } from '@/hooks/use-search'
export type { SearchResult, SearchResponse, UseSearchOptions, UseSearchReturn } from '@/hooks/use-search'
export { useSidebar } from '@/hooks/use-sidebar'
export { useSSE } from '@/hooks/use-sse'
export { toast, useToastStore } from '@/hooks/use-toast'
export { useVerticalResize } from '@/hooks/use-vertical-resize'

// Group 2: Agent data (from team plugin)
export {
  useAgentStore,
  useAgent,
  useAgentList,
  useAgentColor,
  useAgentDisplayName,
  useAgentIds,
  useMainAgentId,
  usePackageState,
  hexToMuted,
} from '@bakin/team/hooks/use-agent-store'

// Group 3: Notification channels (from workflows plugin)
export {
  useNotificationChannels,
  getChannelLabel,
  getChannelInitials,
} from '@bakin/workflows/hooks/use-notification-channels'

// Group 4: Router hooks (TanStack Router wrappers; Next.js-shape compatible)
export { useRouter, usePathname, useSearchParams, useParams } from './router'
