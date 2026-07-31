/**
 * Human labels for memory tiers on the /memory dashboard.
 *
 * Tier identity is carried by the badge TEXT, not a color code — the per-tier
 * raw color families were retired for design-system parity with the
 * global-search type treatment (storybook refit T6.2/T6.5): tier pills render
 * as neutral StatusBadges and the label alone differentiates them.
 */
const TIER_LABELS: Record<string, string> = {
  session: 'Session',
  turn: 'Turn',
  checkpoint: 'Checkpoint',
  daily_note: 'Daily Note',
  dream: 'Dream',
  durable: 'Durable',
  audit: 'Audit',
}

/** Display name for a tier badge; unknown tiers show their raw id. */
export function tierDisplayName(tier: unknown): string {
  if (typeof tier !== 'string' || tier.length === 0) return 'Unknown'
  return TIER_LABELS[tier] ?? tier
}
