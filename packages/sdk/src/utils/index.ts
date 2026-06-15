/**
 * `@makinbakin/sdk/utils` — tiny utilities for plugin authors.
 *
 * `cn(...)` is the Tailwind class merger every shadcn-flavored component
 * needs. The `format*` helpers are re-exported from `@bakin/core/format`
 * so plugins have a single import path instead of reaching into `@/lib/*`.
 */

import type { HealthCheckResult } from '../types'

/** Build an `ok` health-check result. */
export function healthOk(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
/** Build a `warn` health-check result (optionally auto-fixable). */
export function healthWarn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
/** Build an `error` health-check result (optionally auto-fixable). */
export function healthError(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'error', message, autoFixable }
}
/** Build a `fixed` health-check result (the auto-repair just ran). */
export function healthFixed(check: string, message: string): HealthCheckResult {
  return { check, status: 'fixed', message, autoFixable: true }
}

/** Tailwind class merger (clsx + tailwind-merge). */
export { cn } from '../../../../src/lib/utils'

/** Format a Date or ISO string as a relative age (e.g. "5m ago"). */
export { formatAge } from '@bakin/core/format'
/** Format an ISO timestamp as a calendar-aware absolute date+time (e.g. "Today 3:45 PM", "Jan 5 9:02 AM"). */
export { formatDateTime } from '@bakin/core/format'
/** Format a millisecond count as an elapsed duration (e.g. "42s", "3m 5s"); null when undefined. */
export { formatDuration } from '@bakin/core/format'
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
