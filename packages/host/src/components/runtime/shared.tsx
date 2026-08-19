/**
 * Runtime hub — shared visual + language primitives.
 *
 * The hub's one job is honesty a person can act on: every capability mode
 * renders as plain language ("the runtime provides this" / "Bakin provides
 * this" / "not available — here's what happens instead"), never as a bare
 * enum. Keep every mode → word mapping HERE so the three tabs can't drift.
 *
 * It also owns the one card anatomy the Capabilities and Runtimes tabs share
 * (icon tile + title row + status badge + trailing meta + blurb). Both tabs
 * had hand-rolled it separately and had already drifted; one component is the
 * only thing that keeps them honest.
 */
import type { ComponentType, ReactNode } from 'react'
import { Inline, Stack } from '@makinbakin/sdk/layout'
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

export type EntityCardTone = 'neutral' | 'active'

export interface EntityCardBodyProps {
  icon: ComponentType<{ className?: string }>
  /** `active` tints the icon tile — the current runtime, never a status. */
  tone?: EntityCardTone
  title: ReactNode
  /** The tab renders the card at section level; nested surfaces pass 3. */
  headingLevel?: 2 | 3
  /** Status badge beside the title. */
  badge?: ReactNode
  /** Trailing identity line (package@version, adapter id). */
  meta?: ReactNode
  blurb?: ReactNode
  children?: ReactNode
}

/**
 * The shared card interior for the Capabilities and Runtimes rosters. The
 * container is the caller's (a Card, or the roster's approved raw button), so
 * this owns only what both must agree on.
 */
export function EntityCardBody({
  icon: Icon,
  tone = 'neutral',
  title,
  headingLevel = 2,
  badge,
  meta,
  blurb,
  children,
}: EntityCardBodyProps) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const active = tone === 'active'
  return (
    <Inline align="start" gap="item" wrap={false}>
      <span
        aria-hidden="true"
        className={`flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-control ${active ? 'bg-bakin-action-primary-background/10' : 'bg-bakin-canvas-default'}`}
      >
        <Icon className={`size-bakin-4 ${active ? 'text-bakin-action-primary-background' : 'text-bakin-text-muted'}`} />
      </span>
      <Stack gap="dense" className="flex-1">
        <Inline gap="dense" align="center">
          <Heading>{title}</Heading>
          {badge}
          {meta ? <span className="ml-auto text-bakin-typography-size-meta text-bakin-text-muted">{meta}</span> : null}
        </Inline>
        {blurb ? <p className="m-0 leading-relaxed text-bakin-text-muted">{blurb}</p> : null}
        {children}
      </Stack>
    </Inline>
  )
}
