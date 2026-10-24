'use client'

/**
 * The recover view of a workflow record (self-healing PR1 slice 1.4b +
 * Codex r1 #7; rows 127–137): what Health found about THIS record, read
 * from the canonical cached report (never recomputed), and the editor that
 * fixes it in place — the raw file, opened where the finding points.
 */
import { useEffect, useState } from 'react'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Banner, Button, buttonVariants } from '@makinbakin/sdk/ui'
import { WorkflowRecoverEditor, type RecoverEditorFocus, type RecoverEditorTarget } from './workflow-recover-editor'

interface ReportLike {
  observations: Array<{ id: string; summary: string; evidence?: Record<string, unknown> }>
  incidents: Array<{ id: string; title: string; impact: string; declarationId?: string; observationIds: string[]; resources: Array<{ kind: string; id: string }> }>
}

/** The resource id the workflows health check gives a record (its `stablePart`) — the key the banner filters on. */
export function stableKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown'
}

export interface RecordFinding {
  title: string
  summary: string
  declarationId: string | null
  /** Where the finding points inside the file (the check's evidence). */
  focus: RecoverEditorFocus
}

const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const asLine = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)
const asSection = (value: unknown): 'frontmatter' | 'output_schema' | null => (value === 'frontmatter' || value === 'output_schema' ? value : null)

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
        .map((incident) => {
          const observations = incident.observationIds.map((id) => report.observations.find((o) => o.id === id)).filter((o): o is ReportLike['observations'][number] => Boolean(o))
          const evidence = observations.find((o) => o.evidence)?.evidence ?? {}
          return {
            title: incident.title,
            summary: observations.map((o) => o.summary).join(' ') || incident.impact,
            declarationId: incident.declarationId ?? null,
            focus: { path: asString(evidence.path), line: asLine(evidence.line), section: asSection(evidence.section) },
          }
        })
      setFindings(rows)
    }).catch(() => { if (active) setFindings([]) })
    return () => { active = false; controller.abort() }
  }, [resource?.kind, resource?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return findings
}

/** The findings banner, presentation only. */
export function RecoverFindingsBanner({ findings, editHref, editLabel, onDismiss }: {
  findings: RecordFinding[]
  /** A second place the record is edited (the canvas editor), when one exists. */
  editHref?: string
  editLabel?: string
  onDismiss: () => void
}) {
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
          <span className="block">Fix it in the editor below, save, and Health rechecks the record.</span>
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

export function WorkflowRecoverBanner({ resource, editHref, editLabel, onDismiss }: {
  resource: { kind: string; id: string }
  editHref?: string
  editLabel?: string
  onDismiss: () => void
}) {
  const findings = useRecordFindings(resource)
  if (findings === null) return null
  return <RecoverFindingsBanner findings={findings} editHref={editHref} editLabel={editLabel} onDismiss={onDismiss} />
}

/** The whole recover view: the findings, then the raw editor opened where the first finding points. */
export function WorkflowRecoverView({ resource, target, editHref, editLabel, onDismiss, onSaved }: {
  resource: { kind: string; id: string }
  target: RecoverEditorTarget
  editHref?: string
  editLabel?: string
  onDismiss: () => void
  onSaved?: () => void
}) {
  const findings = useRecordFindings(resource)
  if (findings === null) return null
  return (
    <div className="grid min-w-0 gap-bakin-3" data-testid="workflow-recover-view">
      <RecoverFindingsBanner findings={findings} editHref={editHref} editLabel={editLabel} onDismiss={onDismiss} />
      <WorkflowRecoverEditor target={target} focus={findings[0]?.focus ?? null} onSaved={onSaved} />
    </div>
  )
}
