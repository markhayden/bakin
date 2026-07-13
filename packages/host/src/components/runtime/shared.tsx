/**
 * Runtime hub — shared visual + language primitives.
 *
 * The hub's one job is honesty a person can act on: every capability mode
 * renders as plain language ("the runtime provides this" / "Bakin provides
 * this" / "not available — here's what happens instead"), never as a bare
 * enum. Keep every mode → word mapping HERE so the three tabs can't drift.
 */
import { Badge } from '@/components/ui/badge'

export type CapabilityMode = 'native' | 'shimmed' | 'unavailable' | string

const MODE_LABEL: Record<string, string> = {
  native: 'Native',
  shimmed: 'Via Bakin',
  unavailable: 'Not available',
}

const MODE_CLASS: Record<string, string> = {
  native: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  shimmed: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  unavailable: 'border-border bg-muted/40 text-muted-foreground',
}

export function ModeBadge({ mode }: { mode: CapabilityMode }) {
  return (
    <Badge variant="outline" className={`shrink-0 ${MODE_CLASS[mode] ?? MODE_CLASS.unavailable}`}>
      {MODE_LABEL[mode] ?? mode}
    </Badge>
  )
}

/** One plain-language line per capability × mode — what it means for the user. */
export function capabilityStateCopy(key: string, mode: CapabilityMode, adapter: string, detail?: string): string {
  switch (key) {
    case 'toolCalling':
      return detail === 'in-process'
        ? 'Bakin tools run inside the server process — no gateway hop.'
        : detail === 'mcp'
          ? "Bakin tools reach agents over the runtime's MCP client."
          : 'Agents can call Bakin tools.'
    case 'delivery':
      if (mode === 'native') return "Messages, alerts, and approvals deliver through the runtime's channels."
      if (mode === 'shimmed') return 'Bakin delivers messages and approvals on behalf of the runtime.'
      return `Alerts and approvals appear in the app — ${adapter} has no channel delivery.`
    case 'imageGen':
      if (mode === 'native') return 'The runtime generates images with its own credentials.'
      if (mode === 'shimmed') return "Bakin generates images with your provider keys (Settings → Integrations & Keys)."
      return 'Add a provider key in Settings → Integrations & Keys to enable image generation.'
    case 'memory':
      return mode === 'native' ? 'Agent memory is readable for search and diagnostics.' : 'Agent memory is not readable on this runtime.'
    case 'sessions':
      return mode === 'native' ? 'Session history is readable for forensics and usage.' : 'Session history is not readable on this runtime.'
    case 'workspaceFiles':
      return mode === 'native' ? 'Agent workspace files (SOUL, AGENTS, skills) are managed by Bakin.' : 'Workspace files are not manageable on this runtime.'
    default:
      return ''
  }
}

export const MODE_LEGEND = 'Native — the runtime provides it. Via Bakin — Bakin fills the gap itself. Not available — degrades honestly, never silently.'

export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'ok'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : status === 'warn' || status === 'skipped'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
      : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
  return <Badge variant="outline" className={`shrink-0 ${cls}`}>{status}</Badge>
}
