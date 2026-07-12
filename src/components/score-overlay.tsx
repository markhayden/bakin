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
  /**
   * Field names whose text contains the query terms (client-side
   * approximation — see `computeMatchedFields`). Empty array = nothing
   * matched textually, i.e. a pure semantic hit.
   */
  matchedFields?: string[]
}

/**
 * Which of a hit's fields textually contain any query term (case-
 * insensitive). An honest approximation for debug display — the engine
 * exposes no per-field match info; a hit with NO textual match is a
 * semantic (meaning-based) match and is labeled as such.
 */
export function computeMatchedFields(query: string, fields: Record<string, unknown>): string[] {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1)
  if (terms.length === 0) return []
  const matched: string[] = []
  for (const [name, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue
    const text = (typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase()
    if (terms.some((term) => text.includes(term))) matched.push(name)
  }
  return matched
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
      {info.matchedFields !== undefined && (
        <span className="text-zinc-300" data-testid="score-overlay-matched">
          {info.matchedFields.length > 0 ? `matched: ${info.matchedFields.join(', ')}` : 'semantic match'}
        </span>
      )}
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
