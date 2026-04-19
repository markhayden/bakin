/**
 * Per-tier visual identity for the /memory dashboard.
 *
 * Each tier gets a color family that shows up in three places:
 *   - `accent`: the 4px left-edge border on result cards (quick scan signal)
 *   - `badge`:  the tier pill background/foreground (so the label matches)
 *   - `bg`:     a very subtle card tint on hover so related rows read as a group
 *
 * Classes are full Tailwind strings (not interpolated) so the JIT compiler
 * picks them up at build time. Changing a tier color means editing this file —
 * nothing else needs to know.
 */
export interface TierStyle {
  /** 4px left-edge accent — the primary "what tier is this" signal. */
  accent: string
  /** Tier pill — background + foreground + subtle border. */
  badge: string
  /** Subtle card tint applied when the row is clickable. */
  bg: string
  /** Solid-fill class for status dots / legend swatches. */
  dot: string
  /** Human label for the tier badge. */
  label: string
}

export const TIER_STYLES: Record<string, TierStyle> = {
  session: {
    accent: 'border-l-blue-500',
    badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30',
    bg: 'hover:bg-blue-500/5',
    dot: 'bg-blue-500',
    label: 'Session',
  },
  turn: {
    accent: 'border-l-violet-500',
    badge: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30',
    bg: 'hover:bg-violet-500/5',
    dot: 'bg-violet-500',
    label: 'Turn',
  },
  checkpoint: {
    accent: 'border-l-amber-500',
    badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
    bg: 'hover:bg-amber-500/5',
    dot: 'bg-amber-500',
    label: 'Checkpoint',
  },
  daily_note: {
    accent: 'border-l-emerald-500',
    badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
    bg: 'hover:bg-emerald-500/5',
    dot: 'bg-emerald-500',
    label: 'Daily Note',
  },
  dream: {
    accent: 'border-l-indigo-500',
    badge: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30',
    bg: 'hover:bg-indigo-500/5',
    dot: 'bg-indigo-500',
    label: 'Dream',
  },
  durable: {
    accent: 'border-l-cyan-500',
    badge: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30',
    bg: 'hover:bg-cyan-500/5',
    dot: 'bg-cyan-500',
    label: 'Durable',
  },
  audit: {
    accent: 'border-l-rose-500',
    badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30',
    bg: 'hover:bg-rose-500/5',
    dot: 'bg-rose-500',
    label: 'Audit',
  },
}

const UNKNOWN_STYLE: TierStyle = {
  accent: 'border-l-muted-foreground/40',
  badge: 'bg-muted text-muted-foreground border-muted-foreground/20',
  bg: 'hover:bg-muted/50',
  dot: 'bg-muted-foreground/60',
  label: 'Unknown',
}

export function tierStyle(tier: unknown): TierStyle {
  if (typeof tier !== 'string') return UNKNOWN_STYLE
  return TIER_STYLES[tier] ?? { ...UNKNOWN_STYLE, label: tier }
}
