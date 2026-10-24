'use client'

/**
 * `/team?recover=1` (self-healing PR1 slice 1.4b; rows 106–107): the roster
 * problems Health found — an entry without an id, a duplicated id — read
 * from the canonical cached report. The roster is the runtime's record;
 * Bakin names the entry and where it lives rather than editing it blind.
 */
import { useEffect, useState } from 'react'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Banner, Button, buttonVariants } from '@makinbakin/sdk/ui'

interface ReportLike {
  observations: Array<{ id: string; summary: string }>
  incidents: Array<{ id: string; title: string; observationIds: string[]; resources: Array<{ kind: string; id: string; label: string }> }>
}

export interface RosterProblem {
  title: string
  summary: string
  /** The agent the problem names, when it has an id. */
  agentId: string | null
}

export function useRosterProblems(): RosterProblem[] | null {
  const [problems, setProblems] = useState<RosterProblem[] | null>(null)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    void fetch('/api/plugins/health/doctor', { signal: controller.signal }).then(async (res) => {
      if (!active || !res.ok) { if (active) setProblems([]); return }
      const report = await res.json() as ReportLike
      if (!active) return
      setProblems(report.incidents
        .filter((incident) => incident.observationIds.some((id) => id.startsWith('team.agent-roster:')))
        .map((incident) => ({
          title: incident.title,
          summary: incident.observationIds.map((id) => report.observations.find((o) => o.id === id)?.summary).filter((s): s is string => Boolean(s)).join(' '),
          agentId: incident.resources.find((r) => r.kind === 'agent')?.id ?? null,
        })))
    }).catch(() => { if (active) setProblems([]) })
    return () => { active = false; controller.abort() }
  }, [])
  return problems
}

export function RosterRecoverBanner({ onDismiss }: { onDismiss: () => void }) {
  const problems = useRosterProblems()
  if (problems === null) return null
  const dismiss = <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
  if (problems.length === 0) {
    return <Banner tone="success" title="The roster is consistent" description="Every runtime agent has one stable id." action={dismiss} data-testid="roster-recover-banner" />
  }
  return (
    <Banner
      tone="attention"
      title={problems.length === 1 ? problems[0]!.title : `${problems.length} roster problems`}
      description={(
        <span>
          <ul className="list-disc pl-bakin-4">
            {problems.map((p) => (
              <li key={p.summary}>
                {p.summary}
                {p.agentId ? <> <PluginLink to={`/team/${encodeURIComponent(p.agentId)}`} className={buttonVariants({ size: 'xs', variant: 'link' })}>Open {p.agentId}</PluginLink></> : null}
              </li>
            ))}
          </ul>
          <span className="block">The roster belongs to the active runtime: fix the entry in its agent registry (or remove the duplicate agent here), then rerun Health.</span>
        </span>
      )}
      action={dismiss}
      data-testid="roster-recover-banner"
    />
  )
}
