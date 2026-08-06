'use client'

import { Progress, type ProgressTone } from '../primitives/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { formatRelativeTime } from './relative-time'
import { formatTokenCount } from './turn-usage'

/**
 * The meter's wire shape — structurally identical to the SDK's
 * `RuntimeSessionContextStats` (the SDK type stays assignable to this one;
 * chat pins the relationship with a type-level test).
 */
export interface ContextMeterStats {
  /** Current context tokens; null = honestly unknown. */
  tokens: number | null
  /** The model's context window; null when unknown. */
  contextWindow: number | null
  /** Runtime-reported auto-compaction threshold; null when opaque. */
  compactionThreshold: number | null
  lastCompaction?: { at?: string; tokensBefore?: number; reason?: string }
}

const TOOLTIP =
  "How full this conversation's model context is — the runtime's own reading, updated when a reply finishes. " +
  'The tick marks where the runtime auto-compacts (when it reports one); it may compact before the hard limit.'

/**
 * Whether the meter will render ANYTHING for these stats — the single
 * source of truth consumers use to place content around it (a truthy
 * stats object can still render nothing: tokens null with no known
 * compaction — e.g. a stale store).
 */
export function contextMeterHasContent(stats?: ContextMeterStats | null): boolean {
  if (!stats) return false
  if (stats.tokens === null) return Boolean(stats.lastCompaction?.at)
  return true
}

/**
 * The compaction bar (#737): renders ONLY runtime truth. A slim Progress
 * bar (with a track marker for the compaction threshold) plus the exact
 * reading when tokens + window are both known, a number-only reading when
 * the window is unknown, an honest "context —" during a post-compaction
 * gap, and NOTHING when there's nothing honest to show. Highlight at
 * ≥70%, danger at ≥90%; the fill clamps at 100% — a reading can never
 * exceed the window (misreporting runtimes fail conformance, not the UI).
 */
export function ContextMeter({ stats }: { stats?: ContextMeterStats | null }) {
  if (!contextMeterHasContent(stats) || !stats) return null
  const { tokens, contextWindow, compactionThreshold, lastCompaction } = stats

  // Post-compaction gap: tokens unknown, but we can say WHY (hasContent
  // guaranteed a known compaction on this branch).
  if (tokens === null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span data-context-meter tabIndex={0} className="inline-flex items-center gap-bakin-2 text-bakin-text-muted" />}
          aria-label="Context size unknown after a compaction"
        >
          context — (compacted {formatRelativeTime(lastCompaction!.at!)})
        </TooltipTrigger>
        <TooltipContent>{TOOLTIP}</TooltipContent>
      </Tooltip>
    )
  }

  if (contextWindow === null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span data-context-meter tabIndex={0} className="text-bakin-text-muted" />}
          aria-label="Context size"
        >
          context {formatTokenCount(tokens)}
        </TooltipTrigger>
        <TooltipContent>{TOOLTIP}</TooltipContent>
      </Tooltip>
    )
  }

  // floor, not round: "(100%)" appears ONLY when tokens ≥ window, and the
  // danger band starts at a true 90 — a 89.5% reading must not cry wolf.
  const percent = Math.min(100, Math.floor((tokens / contextWindow) * 100))
  const tone: ProgressTone = percent >= 90 ? 'danger' : percent >= 70 ? 'attention' : 'primary'
  const tickPercent =
    compactionThreshold !== null && compactionThreshold > 0 && compactionThreshold <= contextWindow
      ? Math.min(99, Math.round((compactionThreshold / contextWindow) * 100))
      : null

  return (
    <Tooltip>
      <TooltipTrigger
        render={<div data-context-meter tabIndex={0} className="flex min-w-0 items-center gap-bakin-2 text-bakin-text-muted" />}
      >
        <Progress
          value={percent}
          max={100}
          tone={tone}
          size="sm"
          aria-label={`Context ${formatTokenCount(tokens)} of ${formatTokenCount(contextWindow)} (${percent}%)`}
          markers={tickPercent !== null ? [{ value: tickPercent, label: 'Runtime auto-compaction threshold' }] : undefined}
          className="w-20 flex-none"
        />
        <span>
          {formatTokenCount(tokens)} / {formatTokenCount(contextWindow)} ({percent}%)
        </span>
      </TooltipTrigger>
      <TooltipContent>{TOOLTIP}</TooltipContent>
    </Tooltip>
  )
}
