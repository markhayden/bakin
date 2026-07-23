/**
 * `@makinbakin/sdk/utils` — tiny utilities for plugin authors.
 *
 * `cn(...)` is the Tailwind class merger every shadcn-flavored component
 * needs. The `format*` helpers are re-exported from `@bakin/core/format`
 * so plugins have a single import path instead of reaching into `@/lib/*`.
 */

import type {
  ErrorObservationInput,
  HealthNonEmptyArray,
  HealthObservationInput,
  HealthyObservationInput,
  NotApplicableHealthCheckRunInput,
  ObservedHealthCheckRunInput,
  UnknownObservationInput,
  WarningObservationInput,
} from '../types'

// The observation builders live in @bakin/core so adapter packages (which
// depend only on core) share the SAME clamped construction path as
// plugins. This module re-exports them unchanged — plugin authors keep
// importing from '@makinbakin/sdk/utils'.
export {
  healthError,
  healthHealthy,
  healthNotApplicable,
  healthObserved,
  healthUnknown,
  healthWarning,
} from '../../../core/src/health/observation-builders'

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

// Conversation kit server-side helpers (the brainstorm helpers they
// superseded were deleted with IntegratedBrainstorm, 2026-07).
/** Canonical thread id for embedded conversation surfaces (scope:entity:agent). */
export { conversationThreadId } from '../../../../src/components/conversation/thread-id'
/** Record one streamed turn's chunks into persistable ConversationMessage rows. */
export { createTurnRecorder, SUMMARY_MAX_CHARS, PREVIEW_MAX_CHARS } from '../../../../src/components/conversation/turn-recorder'
export type { TurnRecorder } from '../../../../src/components/conversation/turn-recorder'

/** Structured-value (JSON → human) renderers — labeled prose, one-line summary, tool-envelope unwrap. */
export { humanizeKey, formatStructured, summarizeStructured, unwrapToolResult, type FormatStructuredOptions } from '@bakin/core/format'

/** Fetch a plugin's own API route (`/api/plugins/<id>/<path>`) with JSON defaults. */
export { pluginFetch, pluginApiUrl } from './plugin-fetch'
