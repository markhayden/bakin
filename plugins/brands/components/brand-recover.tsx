'use client'

/**
 * `/brands/<id>?recover=1` — the operator's controls for a brand Health could
 * not repair on its own (self-healing PR1 slice 1.4a; row 189). Facts first
 * (manifest status, which references dangle and where, which open tasks use
 * the brand), then exactly the controls those facts allow: Detach per
 * dangling reference and for all; for an unreadable manifest, the raw file
 * beside "Recreate manifest" and the typed-confirm delete. Every control is
 * confirmed through ConfirmDialog / DangerZone; the integrity check reruns
 * right after. Composition: ListRowGroup (Lists/ListRows — Grouped),
 * ConfirmDialog (Feedback/ConfirmDialog), DangerZone (Feedback/DangerZone),
 * CodeBlock (Content/CodeBlock).
 */
import { useCallback, useEffect, useState } from 'react'
import { CodeBlock } from '@makinbakin/sdk/content'
import { Stack } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { ConfirmDialog, DangerZone, ListRow, ListRowGroup, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, SystemState, Text, buttonVariants } from '@makinbakin/sdk/ui'
import { ArrowLeft } from 'lucide-react'

const AFFECTED_CHECKS = ['brands.integrity']

export interface DanglingReference {
  assetId: string
  where: string
}

/** `GET /:brandId/recover` — mirrors the server's recovery facts. */
export interface BrandRecoveryReport {
  brandId: string
  /** `no-manifest`: the directory exists but `brand.json` does not (Recreate / Delete apply). */
  status: 'ok' | 'invalid' | 'no-manifest'
  name: string
  error?: string
  raw?: string | null
  dangling: DanglingReference[]
  tasks: Array<{ taskId: string; title: string; column: string; source?: 'own' | 'parent' | 'project' }>
  tasksKnown: boolean
}

export type BrandRecoverAction = 'detach' | 'recreate' | 'delete'

export interface BrandRecoverPanelProps {
  report: BrandRecoveryReport
  busy: BrandRecoverAction | null
  error: string | null
  onDetach: (assetIds: string[]) => void
  onRecreate: () => void
  onDelete: () => void
}

export function BrandRecoverPanel({ report, busy, error, onDetach, onRecreate, onDelete }: BrandRecoverPanelProps) {
  const [pending, setPending] = useState<null | { kind: 'detach'; assetIds: string[] } | { kind: 'recreate' }>(null)
  const { dangling, tasks } = report
  const unreadable = report.status === 'invalid' || report.status === 'no-manifest'
  return (
    <Stack gap="section">
      {error && <Banner tone="danger" title="The repair did not go through" description={error} />}

      <ListRowGroup label="What Health found" headerVariant="section">
        <ListRows variant="plain" size="sm">
          <ListRow className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <Badge tone={unreadable ? 'danger' : 'success'}>Manifest</Badge>
            <span className="min-w-0 break-words">
              {report.status === 'no-manifest'
                ? 'brand.json is missing: the brand directory exists (guidelines, lessons) but has no manifest.'
                : unreadable ? `brand.json is unreadable: ${report.error ?? 'unknown error'}` : 'brand.json is valid.'}
            </span>
          </ListRow>
          <ListRow className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <Badge tone={tasks.length > 0 ? 'attention' : 'neutral'}>In use</Badge>
            <span className="min-w-0 break-words">
              {!report.tasksKnown
                ? 'Whether open tasks use this brand could not be read.'
                : tasks.length === 0
                  ? 'No open task uses this brand right now.'
                  : (
                    <>
                      {tasks.length === 1 ? '1 open task uses this brand: ' : `${tasks.length} open tasks use this brand: `}
                      {tasks.map((task, index) => (
                        <span key={task.taskId}>
                          {index > 0 ? ', ' : ''}
                          <PluginLink to={`/tasks?taskId=${encodeURIComponent(task.taskId)}`} className={buttonVariants({ size: 'xs', variant: 'link' })}>{task.title || task.taskId}</PluginLink>
                          {task.source === 'parent' ? ' (through its parent task)' : task.source === 'project' ? ' (through its project)' : ''}
                        </span>
                      ))}
                    </>
                  )}
            </span>
          </ListRow>
        </ListRows>
      </ListRowGroup>

      {unreadable && typeof report.raw === 'string' && (
        <ListRowGroup label="The file as it is" headerVariant="section">
          <CodeBlock code={report.raw} label="brand.json" language="json" copyable />
        </ListRowGroup>
      )}

      {unreadable ? (
        <ListRowGroup label="Repairs" headerVariant="section">
          <ListRows variant="plain" size="sm" aria-label="Repairs">
            <ListRow className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
              <span className="min-w-0 flex-1">
                <Text as="span" weight="medium">Recreate manifest</Text>
                <Text as="span" tone="muted" className="block">
                  {report.status === 'no-manifest'
                    ? `A fresh brand.json named ${report.brandId} is written into the directory; palette, logos, groups and references start empty. Guidelines and lessons are untouched.`
                    : 'A fresh brand.json keeps the id, name, description and draft flag the old file still says; palette, logos, groups and references start empty. Guidelines and lessons are untouched.'}
                </Text>
              </span>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setPending({ kind: 'recreate' })}>
                {busy === 'recreate' ? 'Recreating…' : 'Recreate manifest'}
              </Button>
            </ListRow>
          </ListRows>
        </ListRowGroup>
      ) : dangling.length === 0 ? (
        <Banner tone="success" title="No dangling references" description={`Every asset ${report.name} references still exists.`} />
      ) : (
        <ListRowGroup label={`Dangling references (${dangling.length})`} headerVariant="section">
          <ListRows variant="plain" size="sm" aria-label="Dangling references">
            {dangling.map((ref) => (
              <ListRow key={`${ref.assetId}:${ref.where}`} className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
                <span className="min-w-0 flex-1">
                  <Text as="span" weight="medium" className="break-all">{ref.assetId}</Text>
                  <Text as="span" tone="muted" className="block">Referenced as {ref.where}; the asset no longer exists.</Text>
                </span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setPending({ kind: 'detach', assetIds: [ref.assetId] })}>Detach</Button>
              </ListRow>
            ))}
            {dangling.length > 1 && (
              <ListRow className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
                <span className="min-w-0 flex-1"><Badge tone="attention">All</Badge> <Text as="span" tone="muted">Detach every dangling reference at once.</Text></span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setPending({ kind: 'detach', assetIds: [...new Set(dangling.map((ref) => ref.assetId))] })}>Detach all</Button>
              </ListRow>
            )}
          </ListRows>
        </ListRowGroup>
      )}

      {unreadable && (
        <DangerZone
          title="Delete brand"
          description={`Remove brand ${report.brandId} and everything in its directory — guidelines and lessons included. ${tasks.length > 0 ? `${tasks.length} open task(s) lose their brand and wait at the gate until reassigned.` : 'No open task uses it.'}`}
          confirmLabel="Delete brand"
          confirmValue={report.brandId}
          confirmTitle="Delete this brand?"
          busy={busy === 'delete'}
          onConfirm={onDelete}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'recreate'
          ? 'Recreate the manifest?'
          : pending && pending.assetIds.length > 1 ? `Detach ${pending.assetIds.length} references?` : 'Detach this reference?'}
        description={pending?.kind === 'recreate'
          ? 'The unreadable brand.json is replaced by a fresh valid one. Only the id, name, description, draft flag and creation date it can still read are kept; palette, logos, groups and references start empty.'
          : "The brand stops naming the missing asset in its logos, groups and default references. The brand's own files are untouched."}
        confirmLabel={pending?.kind === 'recreate' ? 'Recreate' : 'Detach'}
        confirmTone={pending?.kind === 'recreate' ? 'primary' : 'danger'}
        busy={busy !== null}
        onConfirm={() => {
          if (pending?.kind === 'detach') onDetach(pending.assetIds)
          else if (pending?.kind === 'recreate') onRecreate()
          setPending(null)
        }}
        onCancel={() => setPending(null)}
      />
    </Stack>
  )
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
}

export function BrandRecoverPage({ brandId, brandName, onExit, onDeleted }: { brandId: string; brandName?: string; onExit: () => void; onDeleted?: () => void }) {
  const [report, setReport] = useState<BrandRecoveryReport | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<BrandRecoverAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/plugins/brands/${encodeURIComponent(brandId)}`

  const load = useCallback(async () => {
    const res = await fetch(`${base}/recover`)
    if (res.status === 404) { setMissing(true); return }
    if (!res.ok) { setError(await readError(res)); return }
    setReport(await res.json() as BrandRecoveryReport)
  }, [base])

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await fetch(`${base}/recover`).catch(() => null)
      if (!active || !res) return
      if (res.status === 404) { setMissing(true); return }
      if (!res.ok) { setError(await readError(res)); return }
      const next = await res.json() as BrandRecoveryReport
      if (active) setReport(next)
    })()
    return () => { active = false }
  }, [base])

  const run = async (action: BrandRecoverAction, request: () => Promise<Response>): Promise<boolean> => {
    setBusy(action)
    setError(null)
    try {
      const res = await request()
      if (!res.ok) { setError(await readError(res)); return false }
      // Return verification: the originating check reruns now, not on the next sweep.
      void fetch('/api/plugins/health/doctor/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkIds: AFFECTED_CHECKS }) }).catch(() => undefined)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setBusy(null)
    }
  }

  const detach = async (assetIds: string[]) => {
    if (await run('detach', () => fetch(`${base}/recover/detach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetIds }) }))) await load()
  }
  const recreate = async () => {
    if (await run('recreate', () => fetch(`${base}/recover/recreate`, { method: 'POST' }))) await load()
  }
  const remove = async () => {
    if (await run('delete', () => fetch(base, { method: 'DELETE' }))) (onDeleted ?? onExit)()
  }

  const title = `Recover ${report?.name ?? brandName ?? brandId}`
  const header = (
    <PageHeader
      navigation={(
        <Button size="icon-sm" variant="ghost" className="rounded-bakin-pill" onClick={onExit} aria-label="Back to brand">
          <ArrowLeft />
        </Button>
      )}
      eyebrow="Branding / recover"
      title={title}
      description="What Health found on this brand, and the controls that fix it."
    />
  )

  if (missing) {
    return (
      <Page data-testid="brand-recover">
        {header}
        <PageBody state={<SystemState kind="error" title="Nothing to recover" description="No record exists for this brand any more. If Health still lists it, rerun the check." action={<Button variant="outline" onClick={onExit}>Back</Button>} />} />
      </Page>
    )
  }
  if (!report) {
    return (
      <Page data-testid="brand-recover">
        {header}
        <PageBody state={error ? <SystemState kind="error" title="Could not read the brand" description={error} action={<Button variant="outline" onClick={() => { setError(null); void load() }}>Try again</Button>} /> : <SystemState kind="loading" title="Reading the brand" />} />
      </Page>
    )
  }
  return (
    <Page data-testid="brand-recover">
      {header}
      <PageBody>
        <BrandRecoverPanel report={report} busy={busy} error={error} onDetach={(ids) => void detach(ids)} onRecreate={() => void recreate()} onDelete={() => void remove()} />
      </PageBody>
    </Page>
  )
}
