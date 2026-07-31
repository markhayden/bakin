/**
 * ContextMeter (#737) — the compaction bar, chat-owned. The frozen
 * `@makinbakin/sdk/components` barrel dropped it in the storybook refit
 * (audit §4.2: deleted with the last legacy consumers, never promoted to
 * public kit), so the chat plugin — its one real consumer — owns it as a
 * domain component composed from the focused SDK entrypoints.
 *
 * Renders ONLY runtime truth (sessions.contextStats): a slim kit
 * `Progress` bar (with a track marker for the compaction threshold)
 * plus the exact reading when tokens + window are both known, a
 * number-only reading when the window is unknown, an honest "context —"
 * during a post-compaction gap, and NOTHING when there's nothing honest
 * to show. Highlight at ≥70%, danger at ≥90%; a tick marks the
 * runtime-reported compaction threshold when the runtime knows one
 * (codex-native compaction is opaque — no tick, never a guessed one).
 * The fill clamps at 100% — a reading can never exceed the window
 * (misreporting runtimes fail conformance, not the UI).
 */
import { formatRelativeTime, formatTokenCount } from '@makinbakin/sdk/conversation'
import type { RuntimeSessionContextStats } from '@makinbakin/sdk/types'
import { Progress, type ProgressTone } from '@makinbakin/sdk/ui'

/**
 * Wire DTO for the meter — the runtime contract type under the meter's
 * historical name (the old kit mirror was pinned mutually assignable;
 * aliasing removes the third copy).
 */
export type ContextMeterStats = RuntimeSessionContextStats

const TOOLTIP =
  "How full this chat's model context is — the runtime's own reading, updated when a reply finishes. " +
  'The tick marks where the runtime auto-compacts (when it reports one); it may compact before the hard limit.'

/**
 * Whether the meter will render ANYTHING for these stats — the single
 * source of truth consumers use to place separators around it (a truthy
 * stats object can still render nothing: tokens null with no known
 * compaction — e.g. a stale store).
 */
export function contextMeterHasContent(stats?: ContextMeterStats | null): boolean {
  if (!stats) return false
  if (stats.tokens === null) return Boolean(stats.lastCompaction?.at)
  return true
}

export function ContextMeter({ stats }: { stats?: ContextMeterStats | null }) {
  if (!contextMeterHasContent(stats) || !stats) return null
  const { tokens, contextWindow, compactionThreshold, lastCompaction } = stats

  // Post-compaction gap: tokens unknown, but we can say WHY (hasContent
  // guaranteed a known compaction on this branch).
  if (tokens === null) {
    return (
      <span
        data-context-meter
        title={TOOLTIP}
        aria-label="Context size unknown after a compaction"
        className="inline-flex items-center gap-1.5 text-bakin-text-muted/80"
      >
        context — (compacted {formatRelativeTime(lastCompaction!.at!)})
      </span>
    )
  }

  if (contextWindow === null) {
    return (
      <span data-context-meter title={TOOLTIP} aria-label="Context size" className="text-bakin-text-muted/80">
        context {formatTokenCount(tokens)}
      </span>
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
    <div
      data-context-meter
      title={TOOLTIP}
      className="flex min-w-0 items-center gap-1.5 text-bakin-text-muted/80"
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
    </div>
  )
}
