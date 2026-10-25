'use client'

/**
 * `/assets/<id>?recover=1` — the operator's controls for an asset Health
 * could not repair on its own (self-healing PR1 slice 1.4a; rows 180–182).
 * The page states the facts first (what is on disk, what the manifest says),
 * then offers exactly the repairs those facts allow; trash is the
 * consequence-first last resort. Composition: ListRowGroup (Lists/ListRows —
 * Grouped), ConfirmDialog (Feedback/ConfirmDialog) and DangerZone
 * (Feedback/DangerZone); nothing is hand-rolled.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '@makinbakin/sdk/navigation'
import { Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, DangerZone, ListRow, ListRowGroup, ListRows, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, SystemState, Text } from '@makinbakin/sdk/ui'
import { ArrowLeft } from 'lucide-react'
import { VERSIONED_API } from './asset-urls'
import type { AssetRecoveryReport } from './types'

/** The checks a recovery control may have resolved — rerun right after it runs (return verification). */
const AFFECTED_CHECKS = ['assets.assets']

export type AssetRecoverAction = 'rebuild' | 'detach' | 'detach-references' | `restore:${string}` | 'trash'

export interface AssetRecoverPanelProps {
  report: AssetRecoveryReport
  busy: AssetRecoverAction | null
  error: string | null
  onRebuild: () => void
  onDetachMissing: () => void
  /** Spec §3.9: the asset's task and every brand stop pointing at it. */
  onDetachReferences: () => void
  onRestoreExport: (name: string) => void
  onTrash: () => void
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Presentational: the facts and the controls. The page owns the requests. */
export function AssetRecoverPanel({ report, busy, error, onRebuild, onDetachMissing, onDetachReferences, onRestoreExport, onTrash }: AssetRecoverPanelProps) {
  const [pending, setPending] = useState<null | { action: Exclude<AssetRecoverAction, 'trash'>; title: string; description: string; tone: 'primary' | 'danger'; run: () => void }>(null)
  const manifestOk = report.manifest.status === 'ok'
  const presentVersions = report.versions.filter((v) => v.present)
  const missingVersions = report.versions.filter((v) => !v.present)
  const missingExports = report.exports.filter((e) => !e.present)
  const canRebuild = !manifestOk && report.versionFiles.length > 0
  const canDetach = manifestOk && presentVersions.length > 0 && (missingVersions.length > 0 || missingExports.length > 0 || (report.manifest.status === 'ok' && !report.manifest.currentVersionPresent))
  const restorable = manifestOk ? report.exports.filter((e) => e.present) : []
  const references = report.references
  const referenceLabels = [
    ...(references?.task ? [`task ${references.task.title ?? references.task.taskId}${references.task.open === false ? ' (closed)' : ''}`] : []),
    ...(references?.brands ?? []).map((ref) => `brand ${ref.brandId} (${ref.where})`),
  ]
  const canDetachReferences = referenceLabels.length > 0

  const manifestSummary = report.manifest.status === 'missing'
    ? 'manifest.json is missing.'
    : report.manifest.status === 'invalid'
      ? `manifest.json is invalid: ${report.manifest.reason}`
      : `manifest.json is valid — current version v${report.manifest.currentVersion}${report.manifest.currentVersionPresent ? '' : ' (its file is missing)'}.`

  const confirm = (next: NonNullable<typeof pending>) => setPending(next)

  return (
    <Stack gap="section">
      {error && <Banner tone="danger" title="The repair did not go through" description={error} />}

      <ListRowGroup label="What Health found" headerVariant="section">
        <ListRows variant="plain" size="sm">
          <ListRow className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <Badge tone={manifestOk ? 'success' : 'danger'}>Manifest</Badge>
            <span className="min-w-0 break-words">{manifestSummary}</span>
          </ListRow>
          <ListRow className="flex min-w-0 flex-wrap items-center gap-bakin-2">
            <Badge tone="neutral">Files on disk</Badge>
            <span className="min-w-0 break-words">
              {report.filesOnDisk.length === 0 ? 'The directory is empty.' : report.filesOnDisk.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ')}
            </span>
          </ListRow>
          {manifestOk && (
            <ListRow className="flex min-w-0 flex-wrap items-center gap-bakin-2">
              <Badge tone={missingVersions.length > 0 ? 'danger' : 'success'}>Versions</Badge>
              <span className="min-w-0 break-words">
                {report.versions.map((v) => `v${v.version} ${v.present ? 'present' : 'MISSING'}`).join(', ')}
              </span>
            </ListRow>
          )}
          {manifestOk && report.exports.length > 0 && (
            <ListRow className="flex min-w-0 flex-wrap items-center gap-bakin-2">
              <Badge tone={missingExports.length > 0 ? 'attention' : 'success'}>Exports</Badge>
              <span className="min-w-0 break-words">
                {report.exports.map((e) => `${e.name} (from v${e.fromVersion}) ${e.present ? 'present' : 'MISSING'}`).join(', ')}
              </span>
            </ListRow>
          )}
        </ListRows>
      </ListRowGroup>

      <ListRowGroup label="Repairs" headerVariant="section">
        <ListRows variant="plain" size="sm" aria-label="Repairs">
          <ListRow className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
            <span className="min-w-0 flex-1">
              <Text as="span" weight="medium">Rebuild manifest from files</Text>
              <Text as="span" tone="muted" className="block">
                {canRebuild
                  ? `Write a fresh manifest from the ${report.versionFiles.length} version file${report.versionFiles.length === 1 ? '' : 's'} on disk (v${report.versionFiles.map((v) => v.version).join(', v')}); the newest becomes current. Descriptions, tags and the task link are not recoverable.`
                  : manifestOk ? 'The manifest is valid — nothing to rebuild.' : 'No version files (v<N>.<ext>) are on disk to rebuild from.'}
              </Text>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!canRebuild || busy !== null}
              onClick={() => confirm({ action: 'rebuild', tone: 'primary', title: 'Rebuild the manifest?', description: 'A new manifest.json is written from the files on disk. Nothing on disk is deleted or changed.', run: onRebuild })}
            >
              {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild manifest'}
            </Button>
          </ListRow>
          <ListRow className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
            <span className="min-w-0 flex-1">
              <Text as="span" weight="medium">Detach missing versions</Text>
              <Text as="span" tone="muted" className="block">
                {canDetach
                  ? `Forget ${missingVersions.length} missing version${missingVersions.length === 1 ? '' : 's'}${missingExports.length > 0 ? ` and ${missingExports.length} missing export${missingExports.length === 1 ? '' : 's'}` : ''}; v${Math.max(...presentVersions.map((v) => v.version))} becomes current if the current one is gone.`
                  : !manifestOk ? 'Needs a valid manifest first.' : presentVersions.length === 0 ? 'Every version file is gone — move the asset to the trash instead.' : 'Every recorded version and export is present.'}
              </Text>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!canDetach || busy !== null}
              onClick={() => confirm({ action: 'detach', tone: 'danger', title: 'Detach the missing versions?', description: 'The manifest stops listing versions and exports whose files are gone. The files themselves were already lost; this makes the asset consistent again.', run: onDetachMissing })}
            >
              {busy === 'detach' ? 'Detaching…' : 'Detach missing'}
            </Button>
          </ListRow>
          <ListRow className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
            <span className="min-w-0 flex-1">
              <Text as="span" weight="medium">Detach references</Text>
              <Text as="span" tone="muted" className="block">
                {canDetachReferences
                  ? `Still referenced by ${referenceLabels.join(', ')}. The task and every brand stop pointing at this asset; nothing on disk is deleted.`
                  : references && !references.known
                    ? 'Whether a task or brand still references this asset could not be fully read.'
                    : 'Nothing references this asset.'}
              </Text>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={!canDetachReferences || busy !== null}
              onClick={() => confirm({ action: 'detach-references', tone: 'danger', title: 'Detach every reference?', description: `${referenceLabels.join(', ')} will no longer point at ${report.assetId}. Branded work and the task lose this asset; the files stay where they are.`, run: onDetachReferences })}
            >
              {busy === 'detach-references' ? 'Detaching…' : 'Detach references'}
            </Button>
          </ListRow>
          {restorable.map((exp) => (
            <ListRow key={exp.name} className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
              <span className="min-w-0 flex-1">
                <Text as="span" weight="medium">Restore a version from export “{exp.name}”</Text>
                <Text as="span" tone="muted" className="block">The export (derived from v{exp.fromVersion}) becomes a new current version.</Text>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => confirm({ action: `restore:${exp.name}`, tone: 'primary', title: `Restore from “${exp.name}”?`, description: 'The export file is copied in as a new version and made current. Existing versions are untouched.', run: () => onRestoreExport(exp.name) })}
              >
                {busy === `restore:${exp.name}` ? 'Restoring…' : 'Restore from export'}
              </Button>
            </ListRow>
          ))}
        </ListRows>
      </ListRowGroup>

      <DangerZone
        title="Move to trash"
        description={`Move asset ${report.assetId} and everything in its directory to the trash. Tasks and brands that reference it lose it; the trash keeps it for 7 days.`}
        confirmLabel="Move to trash"
        confirmValue={report.assetId}
        confirmTitle="Move this asset to the trash?"
        busy={busy === 'trash'}
        onConfirm={onTrash}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        description={pending?.description}
        confirmLabel="Continue"
        confirmTone={pending?.tone ?? 'primary'}
        busy={pending !== null && busy === pending.action}
        onConfirm={() => { pending?.run(); setPending(null) }}
        onCancel={() => setPending(null)}
      />
    </Stack>
  )
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`
}

/** The page: loads the facts, runs the control the operator chose, re-verifies through Health. */
export function AssetRecoverPage({ assetId, onExit }: { assetId: string; onExit: () => void }) {
  const router = useRouter()
  const [report, setReport] = useState<AssetRecoveryReport | null>(null)
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState<AssetRecoverAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const base = `${VERSIONED_API}/${encodeURIComponent(assetId)}`

  const load = useCallback(async () => {
    const res = await fetch(`${base}/recover`)
    if (res.status === 404) { setMissing(true); return }
    if (!res.ok) { setError(await readError(res)); return }
    setReport(await res.json() as AssetRecoveryReport)
  }, [base])

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await fetch(`${base}/recover`).catch(() => null)
      if (!active || !res) return
      if (res.status === 404) { setMissing(true); return }
      if (!res.ok) { setError(await readError(res)); return }
      const next = await res.json() as AssetRecoveryReport
      if (active) setReport(next)
    })()
    return () => { active = false }
  }, [base])

  const run = async (action: AssetRecoverAction, request: () => Promise<Response>) => {
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
  const post = (path: string, body?: unknown) => fetch(`${base}${path}`, { method: 'POST', ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })

  const header = (
    <PageHeader
      navigation={(
        <Button size="icon-sm" variant="ghost" className="rounded-bakin-pill" onClick={onExit} aria-label="Back to asset">
          <ArrowLeft />
        </Button>
      )}
      eyebrow="Assets / recover"
      title="Recover asset"
      description={assetId}
    />
  )

  if (missing) {
    return (
      <Page data-testid="asset-recover">
        {header}
        <PageBody state={<SystemState kind="error" title="Nothing to recover" description="No directory exists for this asset any more. If Health still lists it, rerun the check." action={<Button variant="outline" onClick={() => router.push('/assets')}>Open assets</Button>} />} />
      </Page>
    )
  }
  if (!report) {
    return (
      <Page data-testid="asset-recover">
        {header}
        <PageBody state={error ? <SystemState kind="error" title="Could not read the asset directory" description={error} action={<Button variant="outline" onClick={() => { setError(null); void load() }}>Try again</Button>} /> : <SystemState kind="loading" title="Reading the asset directory" description="The manifest, files and versions will be listed here." />} />
      </Page>
    )
  }
  return (
    <Page data-testid="asset-recover">
      {header}
      <PageBody>
        <AssetRecoverPanel
          report={report}
          busy={busy}
          error={error}
          onRebuild={() => void run('rebuild', () => post('/recover/rebuild')).then((ok) => { if (ok) void load() })}
          onDetachMissing={() => void run('detach', () => post('/recover/detach-missing')).then((ok) => { if (ok) void load() })}
          onDetachReferences={() => void run('detach-references', () => post('/recover/detach-references')).then((ok) => { if (ok) void load() })}
          onRestoreExport={(name) => void run(`restore:${name}`, () => post('/recover/restore-export', { name })).then((ok) => { if (ok) void load() })}
          onTrash={() => void run('trash', () => fetch(base, { method: 'DELETE' })).then((ok) => { if (ok) router.push('/assets') })}
        />
      </PageBody>
    </Page>
  )
}
