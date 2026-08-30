/**
 * `@makinbakin/sdk/utils` — tiny utilities for plugin authors.
 *
 * `cn(...)` is the Tailwind class merger every shadcn-flavored component
 * needs. The `format*` helpers are re-exported from `@bakin/core/format`
 * so plugins have a single import path instead of reaching into `@/lib/*`.
 */

// The observation builders live in @bakin/core so adapter packages (which
// depend only on core) share the SAME clamped construction path as
// plugins. This module re-exports them unchanged — plugin authors keep
// importing from '@makinbakin/sdk/utils'.
export {
  healthError,
  healthHealthy,
  healthNotApplicable,
  healthObserved,
  healthResourceId,
  healthUnknown,
  healthWarning,
} from '@bakin/core/health/observation-builders'

/** Tailwind class merger (clsx + tailwind-merge). */
export { cn } from '@bakin/ui/utils'
// The one focus-ring spelling; see the Component Internals Contract in the UI overview.
export { focusRing, focusRingInset } from '@bakin/ui/utils'
// Clipboard write that works on the tailnet's plain-HTTP origin (where
// navigator.clipboard is undefined) — resolves true only on a real copy.
export { copyToClipboard } from '@bakin/ui'

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
