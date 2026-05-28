/**
 * `@makinbakin/sdk/utils` — tiny utilities for plugin authors.
 *
 * `cn(...)` is the Tailwind class merger every shadcn-flavored component
 * needs. The `format*` helpers are re-exported from `@bakin/core/format`
 * so plugins have a single import path instead of reaching into `@/lib/*`.
 */

/** Tailwind class merger (clsx + tailwind-merge). */
export { cn } from '../../../../src/lib/utils'

/** Format a Date or ISO string as a relative age (e.g. "5m ago"). */
export { formatAge } from '@bakin/core/format'
/** Format a byte count as a human-readable size string (e.g. "1.2 MB"). */
export { formatSize } from '@bakin/core/format'
/** Returns true if a timestamp is older than a configurable staleness threshold. */
export { isStale } from '@bakin/core/format'

/** Convert a custom activity message into a brainstorm activity input. */
export { brainstormActivityMessageFromCustom } from '../../../../src/components/integrated-brainstorm/activity'
/** Convert a runtime chat chunk into a brainstorm activity event. */
export { runtimeChunkToBrainstormActivity } from '../../../../src/components/integrated-brainstorm/activity'
/** Fold brainstorm events into a renderable timeline. */
export { toBrainstormTimeline } from '../../../../src/components/integrated-brainstorm/activity'
/** Compute the canonical thread id for a brainstorm session. */
export { brainstormThreadId } from '../../../../src/components/integrated-brainstorm/session'
/** Normalize a brainstorm activity payload for persistence. */
export { normalizeBrainstormActivityForStorage } from '../../../../src/components/integrated-brainstorm/session'
/** Normalize a single brainstorm message for persistence. */
export { normalizeBrainstormActivityMessageForStorage } from '../../../../src/components/integrated-brainstorm/session'

export type {
  BrainstormActivityInput,
  BrainstormTimelineActivityInput,
  BrainstormTimelineMessageInput,
} from '../../../../src/components/integrated-brainstorm/activity'
export type {
  BrainstormActivityStorageInput,
  BrainstormActivityStorageRecord,
} from '../../../../src/components/integrated-brainstorm/session'

/** Read an SSE response stream into brainstorm activity events. */
export { readBrainstormSseResponse } from '../../../../src/components/integrated-brainstorm/sse'
