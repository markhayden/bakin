'use client'

/**
 * ContextMeter (#737) — the compaction bar. Renders ONLY runtime truth
 * (sessions.contextStats): a slim fill bar with the exact reading when
 * tokens + window are both known, a number-only reading when the window
 * is unknown, an honest "context —" during a post-compaction gap, and
 * NOTHING when there's nothing honest to show. Amber at ≥70%, red at
 * ≥90%; a tick marks the runtime-reported compaction threshold when the
 * runtime knows one (codex-native compaction is opaque — no tick, never
 * a guessed one). The fill clamps at 100% — a reading can never exceed
 * the window (misreporting runtimes fail conformance, not the UI).
 */
import { formatRelativeTime } from './relative-time'
import { formatTokenCount } from './turn-usage'

/** Mirror of RuntimeSessionContextStats (SDK-flavored, wire DTO). */
export interface ContextMeterStats {
  tokens: number | null
  contextWindow: number | null
  compactionThreshold: number | null
  lastCompaction?: { at?: string; tokensBefore?: number; reason?: string }
  model?: string
}

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
        className="inline-flex items-center gap-1.5 text-muted-foreground/80"
      >
        context — (compacted {formatRelativeTime(lastCompaction!.at!)})
      </span>
    )
  }

  if (contextWindow === null) {
    return (
      <span data-context-meter title={TOOLTIP} aria-label="Context size" className="text-muted-foreground/80">
        context {formatTokenCount(tokens)}
      </span>
    )
  }

  // floor, not round: "(100%)" appears ONLY when tokens ≥ window, and the
  // red band starts at a true 90 — a 89.5% reading must not cry wolf.
  const percent = Math.min(100, Math.floor((tokens / contextWindow) * 100))
  const fillClass =
    percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-primary'
  const tickPercent =
    compactionThreshold !== null && compactionThreshold > 0 && compactionThreshold <= contextWindow
      ? Math.min(99, Math.round((compactionThreshold / contextWindow) * 100))
      : null

  return (
    <span
      data-context-meter
      title={TOOLTIP}
      aria-label={`Context ${formatTokenCount(tokens)} of ${formatTokenCount(contextWindow)} (${percent}%)`}
      className="inline-flex items-center gap-1.5 text-muted-foreground/80"
    >
      <span className="relative inline-block h-1.5 w-20 overflow-hidden rounded-full bg-foreground/10 align-middle">
        <span
          data-context-fill
          className={`absolute inset-y-0 left-0 rounded-full ${fillClass}`}
          style={{ width: `${percent}%` }}
        />
        {tickPercent !== null ? (
          <span
            data-context-tick
            className="absolute inset-y-0 w-px bg-foreground/50"
            style={{ left: `${tickPercent}%` }}
          />
        ) : null}
      </span>
      <span>
        {formatTokenCount(tokens)} / {formatTokenCount(contextWindow)} ({percent}%)
      </span>
    </span>
  )
}
