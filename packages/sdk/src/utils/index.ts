/**
 * `@bakin/sdk/utils` — tiny utilities for plugin authors.
 *
 * `cn(...)` is the Tailwind class merger every shadcn-flavored component
 * needs. The `format*` helpers are re-exported from `@bakin/core/format`
 * so plugins have a single import path instead of reaching into `@/lib/*`.
 */
export { cn } from '@/lib/utils'
export { formatAge, formatSize, isStale } from '@bakin/core/format'
export {
  brainstormActivityMessageFromCustom,
  runtimeChunkToBrainstormActivity,
  toBrainstormTimeline,
} from '@/components/integrated-brainstorm/activity'
export {
  brainstormThreadId,
  normalizeBrainstormActivityForStorage,
  normalizeBrainstormActivityMessageForStorage,
} from '@/components/integrated-brainstorm/session'
export type {
  BrainstormActivityInput,
  BrainstormTimelineActivityInput,
  BrainstormTimelineMessageInput,
} from '@/components/integrated-brainstorm/activity'
export type {
  BrainstormActivityStorageInput,
  BrainstormActivityStorageRecord,
} from '@/components/integrated-brainstorm/session'
export { readBrainstormSseResponse } from '@/components/integrated-brainstorm/sse'
