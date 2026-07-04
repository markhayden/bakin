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

/** Semantic tone for an outline status badge. */
export type BadgeTone = 'success' | 'pending' | 'error' | 'muted' | 'info'

// Full literal class strings (not template-constructed) so Tailwind's content
// scanner detects them — `@source` covers this file. Maps the codebase's
// `bg-X-500/10 text-X-400 border-X-500/20` outline-badge idiom onto five tones.
const TONE_BADGE_CLASS: Record<BadgeTone, string> = {
  success: 'bg-green-500/10 text-green-400 border-green-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error: 'bg-red-500/10 text-red-400 border-red-500/20',
  muted: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  info: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

/**
 * Classes for an outline status badge of the given tone — the
 * `bg-X-500/10 text-X-400 border-X-500/20` idiom, used with `<Badge variant="outline">`.
 */
export function toneBadgeClass(tone: BadgeTone): string {
  return TONE_BADGE_CLASS[tone]
}

/** Pure assetId shape validators (see ./asset-id). */
export { isValidAssetId, yearMonthFromAssetId } from './asset-id'

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
