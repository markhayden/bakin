/**
 * Runtime hub — shared visual + language primitives.
 *
 * The hub's one job is honesty a person can act on: every capability mode
 * renders as plain language ("the runtime provides this" / "Bakin provides
 * this" / "not available — here's what happens instead"), never as a bare
 * enum. Keep every mode → word mapping HERE so the three tabs can't drift.
 */
import { StatusBadge as StatusBadgePattern, type StatusTone } from '@makinbakin/sdk/patterns'

export type CapabilityMode = 'native' | 'shimmed' | 'unavailable' | string

const MODE_LABEL: Record<string, string> = {
  native: 'Native',
  shimmed: 'Via Bakin',
  unavailable: 'Not available',
}

const MODE_TONE: Record<string, StatusTone> = {
  native: 'success',
  shimmed: 'accent',
  unavailable: 'neutral',
}

export function ModeBadge({ mode }: { mode: CapabilityMode }) {
  return (
    <StatusBadgePattern tone={MODE_TONE[mode] ?? 'neutral'} variant="soft" className="shrink-0">
      {MODE_LABEL[mode] ?? mode}
    </StatusBadgePattern>
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
  const tone: StatusTone = status === 'ok'
    ? 'success'
    : status === 'warn' || status === 'skipped'
      ? 'attention'
      : 'danger'
  return <StatusBadgePattern tone={tone} variant="soft" className="shrink-0">{status}</StatusBadgePattern>
}
