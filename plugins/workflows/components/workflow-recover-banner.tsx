'use client'

/**
 * The recover view's banner on a workflow page (self-healing PR1 slice 1.4b;
 * rows 127–137): what Health found about THIS record, read from the
 * canonical cached report (never recomputed), with the one place to fix it.
 */
import { useEffect, useState } from 'react'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Banner, Button, buttonVariants } from '@makinbakin/sdk/ui'

interface ReportLike {
  observations: Array<{ id: string; summary: string }>
  incidents: Array<{ id: string; title: string; impact: string; observationIds: string[]; resources: Array<{ kind: string; id: string }> }>
}

/** The resource id the workflows health check gives a record (its `stablePart`) — the key the banner filters on. */
export function stableKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown'
}

export interface RecordFinding {
  title: string
  summary: string
}

/** Health's findings whose resources name this record (kind + stable id). */
export function useRecordFindings(resource: { kind: string; id: string } | null): RecordFinding[] | null {
  const [findings, setFindings] = useState<RecordFinding[] | null>(null)
  useEffect(() => {
    if (!resource) return
    let active = true
    const controller = new AbortController()
    void fetch('/api/plugins/health/doctor', { signal: controller.signal }).then(async (res) => {
      if (!active || !res.ok) { if (active) setFindings([]); return }
      const report = await res.json() as ReportLike
      if (!active) return
      const rows = report.incidents
        .filter((incident) => incident.resources.some((r) => r.kind === resource.kind && r.id === resource.id))
        .map((incident) => ({
          title: incident.title,
          summary: incident.observationIds.map((id) => report.observations.find((o) => o.id === id)?.summary).filter((s): s is string => Boolean(s)).join(' ') || incident.impact,
        }))
      setFindings(rows)
    }).catch(() => { if (active) setFindings([]) })
    return () => { active = false; controller.abort() }
  }, [resource?.kind, resource?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return findings
}

export function WorkflowRecoverBanner({ resource, editHref, editLabel, where, onDismiss }: {
  resource: { kind: string; id: string }
  /** Where the record is edited; omitted when the fix is on disk (skills). */
  editHref?: string
  editLabel?: string
  /** For records without an editor: the path to fix by hand. */
  where?: string
  onDismiss: () => void
}) {
  const findings = useRecordFindings(resource)
  if (findings === null) return null
  const dismiss = <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
  if (findings.length === 0) {
    return <Banner tone="success" title="Health has nothing open on this record" description="Whatever was flagged has been resolved or no longer applies." action={dismiss} data-testid="workflow-recover-banner" />
  }
  return (
    <Banner
      tone="attention"
      title={findings.length === 1 ? findings[0]!.title : `Health flagged ${findings.length} problems on this record`}
      description={(
        <span>
          <ul className="list-disc pl-bakin-4">{findings.map((f) => <li key={f.summary}>{f.summary}</li>)}</ul>
          {where ? <span className="block">Fix it in <code>{where}</code>, then rerun Health.</span> : null}
        </span>
      )}
      action={(
        <span className="flex gap-bakin-2">
          {editHref ? <PluginLink to={editHref} className={buttonVariants({ size: 'sm', variant: 'outline' })}>{editLabel ?? 'Open editor'}</PluginLink> : null}
          {dismiss}
        </span>
      )}
      data-testid="workflow-recover-banner"
    />
  )
}
