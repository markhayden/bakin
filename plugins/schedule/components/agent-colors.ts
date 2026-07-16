/**
 * Agent visual identity for the calendar views — the ONE color table
 * (previously duplicated between calendar-weekly's AGENT_STYLES and
 * calendar-monthly's AGENT_DOT_GLOW, which had drifted).
 *
 * Inline style objects carry gradients/glows (Tailwind can't do arbitrary
 * values); class strings stay literal so the JIT scanner sees them.
 */
export interface AgentStyle {
  border: string
  bg: string         // Tailwind bg for the card surface
  glow: string       // box-shadow color token (rgba)
  accent: string     // text color for the time pill
  dot: string        // status dot color
  gradient: string   // CSS gradient for the top accent bar
}

export const AGENT_STYLES: Record<string, AgentStyle> = {
  main:     { border: 'border-blue-500/30',    bg: 'bg-blue-500/[0.06]',    glow: 'rgba(96,165,250,0.10)',  accent: 'text-blue-400',    dot: 'bg-blue-400',    gradient: 'linear-gradient(135deg, rgba(96,165,250,0.4), rgba(96,165,250,0.08))' },
  chef:     { border: 'border-green-500/30',   bg: 'bg-green-500/[0.06]',   glow: 'rgba(74,222,128,0.10)',  accent: 'text-green-400',   dot: 'bg-green-400',   gradient: 'linear-gradient(135deg, rgba(74,222,128,0.4), rgba(74,222,128,0.08))' },
  pixel:    { border: 'border-violet-500/30',  bg: 'bg-violet-500/[0.06]',  glow: 'rgba(167,139,250,0.10)', accent: 'text-violet-400',  dot: 'bg-violet-400',  gradient: 'linear-gradient(135deg, rgba(167,139,250,0.4), rgba(167,139,250,0.08))' },
  rolo:     { border: 'border-orange-500/30',  bg: 'bg-orange-500/[0.06]',  glow: 'rgba(251,146,60,0.10)',  accent: 'text-orange-400',  dot: 'bg-orange-400',  gradient: 'linear-gradient(135deg, rgba(251,146,60,0.4), rgba(251,146,60,0.08))' },
  patch:    { border: 'border-zinc-500/30',    bg: 'bg-zinc-500/[0.06]',    glow: 'rgba(161,161,170,0.10)', accent: 'text-zinc-400',    dot: 'bg-zinc-400',    gradient: 'linear-gradient(135deg, rgba(161,161,170,0.4), rgba(161,161,170,0.08))' },
  explorer: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.06]', glow: 'rgba(52,211,153,0.10)',  accent: 'text-emerald-400', dot: 'bg-emerald-400', gradient: 'linear-gradient(135deg, rgba(52,211,153,0.4), rgba(52,211,153,0.08))' },
  trainer:  { border: 'border-cyan-500/30',    bg: 'bg-cyan-500/[0.06]',    glow: 'rgba(34,211,238,0.10)',  accent: 'text-cyan-400',    dot: 'bg-cyan-400',    gradient: 'linear-gradient(135deg, rgba(34,211,238,0.4), rgba(34,211,238,0.08))' },
  coach:    { border: 'border-amber-500/30',   bg: 'bg-amber-500/[0.06]',   glow: 'rgba(251,191,36,0.10)',  accent: 'text-amber-400',   dot: 'bg-amber-400',   gradient: 'linear-gradient(135deg, rgba(251,191,36,0.4), rgba(251,191,36,0.08))' },
}

export const FALLBACK_STYLE = AGENT_STYLES.patch!

export function agentStyle(agentId: string | undefined): AgentStyle {
  return AGENT_STYLES[agentId || ''] || FALLBACK_STYLE
}

/** Stronger-alpha glow for the month view's tiny dots. */
export function agentDotGlow(agentId: string | undefined): string {
  return agentStyle(agentId).glow.replace('0.10)', '0.35)')
}
