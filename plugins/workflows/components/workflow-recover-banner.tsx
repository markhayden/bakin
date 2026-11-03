'use client'

/**
 * The recover view of a workflow record (self-healing PR1 slice 1.4b +
 * Codex r1 #7 / r2 #10, #12; rows 127–137): what Health found about THIS
 * record, read from the canonical cached report (never recomputed), and the
 * editor that fixes it in place — the raw file, opened where the finding
 * points. Evidence states are kept apart: findings, verified-empty (the
 * originating check ran and has nothing on the record), UNVERIFIED (the
 * check has not observed yet), and UNAVAILABLE (the report could not be
 * read — the last known findings stay on screen, never "resolved").
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Banner, Button, buttonVariants } from '@makinbakin/sdk/ui'
import { WorkflowRecoverEditor, type RecoverEditorFocus, type RecoverEditorTarget, type WorkflowRecoverEditorHandle } from './workflow-recover-editor'

interface ReportLike {
  checks?: Array<{ checkId: string; latestExecution?: { outcome?: string } }>
  observations: Array<{ id: string; checkId?: string; status?: string; snapshot?: string; summary: string; evidence?: Record<string, unknown> }>
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

/** What the report says about this record beyond its findings. */
export interface RecordEvidence {
  /** The report could not be read; `findings` are the last known ones (or null when there never were any). */
  error: string | null
  /** The originating check has OBSERVED in the current report (an empty finding list means verified-empty only then). */
  verified: boolean
  onRetry?: () => void
}

const asString = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)
const asLine = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)
const asSection = (value: unknown): 'frontmatter' | 'output_schema' | null => (value === 'frontmatter' || value === 'output_schema' ? value : null)

/** The check that owns findings on this kind of record. */
export function checkIdForResource(kind: string): string | null {
  return kind === 'workflow' ? 'workflows.definitions' : kind === 'file' ? 'workflows.skills' : null
}

/** Pure: the record's findings and whether its check has observed in this report. */
export function recordFindingsFrom(report: ReportLike, resource: { kind: string; id: string }): { findings: RecordFinding[]; verified: boolean } {
  const findings = report.incidents
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
  return { findings, verified: checkVerified(report, checkIdForResource(resource.kind)) }
}

/**
 * Verified = the originating check OBSERVED in this report AND that run
 * inspected its data: a failed scan is an observed `unknown` row (row 138 —
 * "could not be inspected"), and a last-known row is stale evidence; neither
 * makes an empty finding list "resolved" (Codex r3 #2).
 */
export function checkVerified(report: ReportLike, checkId: string | null): boolean {
  if (checkId === null) return false
  const observed = (report.checks ?? []).some((check) => check.checkId === checkId && check.latestExecution?.outcome === 'observed')
  if (!observed) return false
  const rows = report.observations.filter((o) => (o.checkId ?? o.id.split(':')[0]) === checkId)
  return rows.length > 0 && !rows.some((o) => o.status === 'unknown' || o.snapshot === 'last_known')
}

/** Health's findings whose resources name this record (kind + stable id), with honest evidence states. */
export function useRecordFindings(resource: { kind: string; id: string } | null): { findings: RecordFinding[] | null; evidence: RecordEvidence } {
  const [state, setState] = useState<{ findings: RecordFinding[] | null; error: string | null; verified: boolean }>({ findings: null, error: null, verified: false })
  const generation = useRef(0)
  const kind = resource?.kind ?? null
  const id = resource?.id ?? null
  const read = useCallback(async () => {
    if (kind === null || id === null) return
    const mine = ++generation.current
    try {
      const res = await fetch('/api/plugins/health/doctor')
      if (mine !== generation.current) return
      if (!res.ok) { setState((previous) => ({ ...previous, error: `Health could not be read (${res.status}).` })); return }
      const report = await res.json() as ReportLike
      if (mine !== generation.current) return
      const next = recordFindingsFrom(report, { kind, id })
      setState({ findings: next.findings, error: null, verified: next.verified })
    } catch (err) {
      if (mine !== generation.current) return
      setState((previous) => ({ ...previous, error: `Health could not be read: ${err instanceof Error ? err.message : String(err)}` }))
    }
  }, [kind, id])
  useEffect(() => {
    void read()
    return () => { generation.current += 1 }
  }, [read])
  return { findings: state.findings, evidence: { error: state.error, verified: state.verified, onRetry: () => { void read() } } }
}

/** The findings banner, presentation only. */
export function RecoverFindingsBanner({ findings, evidence, editHref, editLabel, onDismiss }: {
  findings: RecordFinding[] | null
  evidence?: RecordEvidence
  /** A second place the record is edited (the canvas editor), when one exists. */
  editHref?: string
  editLabel?: string
  onDismiss: () => void
}) {
  const dismiss = <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
  const retry = evidence?.onRetry ? <Button variant="outline" size="sm" onClick={evidence.onRetry}>Try again</Button> : null
  const actions = (extra?: React.ReactNode) => <span className="flex gap-bakin-2">{extra}{retry}{dismiss}</span>
  if (evidence?.error && (findings === null || findings.length === 0)) {
    return (
      <Banner
        tone="danger"
        title="Health could not be read"
        description={`${evidence.error} Whatever was flagged on this record may still apply; the editor below still opens the file.`}
        action={actions()}
        data-testid="workflow-recover-banner"
        data-evidence="unavailable"
      />
    )
  }
  if (findings === null) return null
  if (findings.length === 0) {
    if (evidence && !evidence.verified) {
      return (
        <Banner
          tone="attention"
          title="Health has not verified this record yet"
          description="The check that covers it has not reported in the current Health report, or could not inspect the files on its last run, so nothing here is confirmed resolved. Run checks from Health, then come back."
          action={actions()}
          data-testid="workflow-recover-banner"
          data-evidence="unverified"
        />
      )
    }
    return <Banner tone="success" title="Health has nothing open on this record" description="Whatever was flagged has been resolved or no longer applies." action={dismiss} data-testid="workflow-recover-banner" data-evidence="verified-empty" />
  }
  return (
    <Banner
      tone="attention"
      title={findings.length === 1 ? findings[0]!.title : `Health flagged ${findings.length} problems on this record`}
      description={(
        <span>
          {evidence?.error ? <span className="block">{evidence.error} Showing the last findings Health reported.</span> : null}
          {findings.map((f) => <span key={f.summary} className="block pl-bakin-4">– {f.summary}</span>)}
          <span className="block">Fix it in the editor below, save, and Health rechecks the record.</span>
        </span>
      )}
      action={actions(editHref ? <PluginLink to={editHref} className={buttonVariants({ size: 'sm', variant: 'outline' })}>{editLabel ?? 'Open editor'}</PluginLink> : null)}
      data-testid="workflow-recover-banner"
      data-evidence={evidence?.error ? 'stale' : 'findings'}
    />
  )
}

export function WorkflowRecoverBanner({ resource, editHref, editLabel, onDismiss }: {
  resource: { kind: string; id: string }
  editHref?: string
  editLabel?: string
  onDismiss: () => void
}) {
  const { findings, evidence } = useRecordFindings(resource)
  if (findings === null && evidence.error === null) return null
  return <RecoverFindingsBanner findings={findings} evidence={evidence} editHref={editHref} editLabel={editLabel} onDismiss={onDismiss} />
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
  const { findings, evidence } = useRecordFindings(resource)
  const editor = useRef<WorkflowRecoverEditorHandle>(null)
  if (findings === null && evidence.error === null) return null
  // Dismiss goes through the editor's dirty-exit guard: a dirty draft asks first (Codex r2 #12).
  const dismiss = () => { if (editor.current) editor.current.requestExit(); else onDismiss() }
  return (
    <div className="grid min-w-0 gap-bakin-3" data-testid="workflow-recover-view">
      <RecoverFindingsBanner findings={findings} evidence={evidence} editHref={editHref} editLabel={editLabel} onDismiss={dismiss} />
      <WorkflowRecoverEditor ref={editor} target={target} focus={findings?.[0]?.focus ?? null} onSaved={onSaved} onExit={onDismiss} />
    </div>
  )
}
