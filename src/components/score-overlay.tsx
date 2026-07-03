/**
 * Search-relevance debug overlay (spec req 2 / D17). Renders the fused
 * score plus ONE badge per leg in `scoreBreakdown` — whatever legs the
 * adapter reports, by their neutral names. No engine-specific key sniffing:
 * the engine returns `full_text` plus the table's declared leg names.
 *
 * Embedding legs report -cosine_distance (higher = better, but negative);
 * they render as cosine similarity (1 + score) so they read as a normal
 * 0..1 relevance. Detection is by sign: negative = distance-based leg.
 */

const LEG_COLORS = [
  'text-cyan-400',
  'text-purple-400',
  'text-pink-400',
  'text-emerald-400',
  'text-orange-400',
  'text-sky-400',
] as const

export interface ScoreOverlayInfo {
  /** Fused (RRF/RSF) score. */
  score: number
  /** Per-leg scores keyed by neutral leg name (from the adapter). */
  indexScores?: Record<string, number>
}

function legLabel(leg: string): string {
  // Compact display: 'full_text' → FT; 'assets_visual' → VISUAL; keep short legs.
  if (leg === 'full_text') return 'FT'
  const tail = leg.split('_').pop() ?? leg
  return tail.slice(0, 6).toUpperCase()
}

export function ScoreOverlay({ info, className = '' }: { info: ScoreOverlayInfo; className?: string }) {
  const legs = Object.entries(info.indexScores ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
  return (
    <div
      className={`flex flex-col gap-0.5 rounded bg-black/80 px-1.5 py-1 font-mono text-[9px] ${className}`}
      data-testid="score-overlay"
    >
      <span className="text-amber-400">RRF {info.score.toFixed(4)}</span>
      {legs.map(([leg, raw], i) => {
        // Negative = distance-based embedding leg → show similarity (1 + raw).
        const value = raw < 0 ? 1 + raw : raw
        return (
          <span key={leg} className={LEG_COLORS[i % LEG_COLORS.length]} title={leg}>
            {legLabel(leg)} {value.toFixed(4)}
          </span>
        )
      })}
    </div>
  )
}
