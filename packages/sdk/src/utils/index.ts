/**
 * `@makinbakin/sdk/utils` — tiny utilities for plugin authors.
 *
 * `cn(...)` is the Tailwind class merger every shadcn-flavored component
 * needs. The `format*` helpers are re-exported from `@bakin/core/format`
 * so plugins have a single import path instead of reaching into `@/lib/*`.
 */
export { cn } from '../../../../src/lib/utils'
export { formatAge, formatSize, isStale } from '@bakin/core/format'
export {
  brainstormActivityMessageFromCustom,
  runtimeChunkToBrainstormActivity,
  toBrainstormTimeline,
} from '../../../../src/components/integrated-brainstorm/activity'
export {
  brainstormThreadId,
  normalizeBrainstormActivityForStorage,
  normalizeBrainstormActivityMessageForStorage,
} from '../../../../src/components/integrated-brainstorm/session'
export type {
  BrainstormActivityInput,
  BrainstormTimelineActivityInput,
  BrainstormTimelineMessageInput,
} from '../../../../src/components/integrated-brainstorm/activity'
export type {
  BrainstormActivityStorageInput,
  BrainstormActivityStorageRecord,
} from '../../../../src/components/integrated-brainstorm/session'
export { readBrainstormSseResponse } from '../../../../src/components/integrated-brainstorm/sse'
