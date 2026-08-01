import { useState } from 'react'
import { Download, Loader2, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { toast, useJsonFetch } from '@makinbakin/sdk/hooks'
import { ConfirmDialog } from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription, AlertTitle, Badge, Button, Drawer, Input } from '@makinbakin/sdk/ui'

/**
 * The ecosystem lane inside the Capabilities tab (#687) — NOT a separate
 * tab. A slim paste-a-link CTA under the tab intro, the installed
 * ecosystem skills beneath it, and the curated grid follows on the page.
 * The trust preview opens in a DRAWER (the same overlay language as the
 * catalog's detail drawer); destructive removal stays in a ConfirmDialog.
 */

interface SkillPreviewWire {
  ref: string
  packageId: string
  skillName: string
  version: string
  description?: string
  sourceKind: string
  pinnedRef: string
  files: Array<{ path: string; bytes: number }>
  requirements: {
    secrets: Array<{ name: string; required: boolean; secretSlot?: string; help?: string }>
    prereqs: Array<{ name: string; probe: string; optional: boolean }>
    platforms?: string[]
    bins: Array<{ name: string; url?: string; willExecute: boolean }>
    npm: string[]
    models: Array<{ name: string; bytes: number }>
    dependencies: string[]
  }
  mentions: string[]
  warnings: string[]
  risk: Array<{ file: string; line: number; pattern: string; snippet: string }>
  hub?: { downloads?: number; stars?: number }
  verdictState: 'clean' | 'unscanned' | 'unverified' | 'none'
  consentToken: string
}

interface SkillsListResponse {
  managed: Array<{ skillName: string; packageId: string; version: string; source: string; hub: boolean; capability?: string }>
  unmanaged: Array<{ name: string; scope: string }>
}

function fmtBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * Source is a chip on the installed row, never a grouping. Only the curated
 * bits repo earns "official" — a third-party pack shipping its own manifest
 * is just a "pack" (labeling it official would overclaim).
 */
const OFFICIAL_SOURCE_PREFIX = 'github:markhayden/bakin-bits-official'

function sourceChip(source: string, hub: boolean): string {
  if (source.startsWith(OFFICIAL_SOURCE_PREFIX)) return 'official'
  if (source.startsWith('clawhub:')) return 'clawhub'
  if (source.startsWith('github:')) return 'github'
  if (!hub) return 'pack'
  return 'local'
}

function VerdictLine({ state }: { state: SkillPreviewWire['verdictState'] }) {
  if (state === 'clean') {
    return (
      <div className="flex items-center gap-bakin-2 text-bakin-typography-size-body text-bakin-signal-success">
        <ShieldCheck aria-hidden="true" className="size-bakin-4 shrink-0" /> ClawHub security verdict: clean
      </div>
    )
  }
  const copy = state === 'unscanned'
    ? 'ClawHub has NOT scanned this version — treat it as unverified.'
    : state === 'unverified'
      ? 'ClawHub security verdict unavailable — content is unverified.'
      : 'No hub verdict exists for this source — review the files below.'
  return (
    <div className="flex items-center gap-bakin-2 text-bakin-typography-size-body text-bakin-signal-attention">
      <ShieldAlert aria-hidden="true" className="size-bakin-4 shrink-0" /> {copy}
    </div>
  )
}

/** Mono detail line inside a trust alert (file paths, package names, probes). */
function TrustDetailLine({ children }: { children: React.ReactNode }) {
  return <div className="font-bakin-typography-family-mono text-bakin-typography-size-meta">{children}</div>
}

function PreviewDrawerBody({
  preview,
  drift,
  busy,
  error,
  onInstall,
  onCancel,
}: {
  preview: SkillPreviewWire
  drift: boolean
  busy: boolean
  error: string | null
  onInstall: (preview: SkillPreviewWire) => void
  onCancel: () => void
}) {
  const { requirements } = preview
  return (
    <div className="flex flex-col gap-bakin-4 p-bakin-4" data-testid="hub-preview-body">
      {drift && (
        <Alert tone="attention">
          <AlertDescription>
            The skill content changed since the last preview. Review again before installing.
          </AlertDescription>
        </Alert>
      )}

      {preview.description && (
        <p className="m-0 text-bakin-typography-size-body text-bakin-text-primary">{preview.description}</p>
      )}

      <VerdictLine state={preview.verdictState} />
      {preview.hub && (preview.hub.downloads !== undefined || preview.hub.stars !== undefined) && (
        <div className="text-bakin-typography-size-meta text-bakin-text-muted">
          {[
            preview.hub.downloads !== undefined ? `${preview.hub.downloads.toLocaleString()} downloads` : null,
            preview.hub.stars !== undefined ? `${preview.hub.stars.toLocaleString()} stars` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      {preview.risk.length > 0 && (
        <Alert tone="danger" data-testid="risk-warnings">
          <AlertTitle>This content instructs agents to run:</AlertTitle>
          <AlertDescription>
            {preview.risk.map((r, i) => (
              <TrustDetailLine key={i}>
                {r.file}:{r.line} [{r.pattern}] {r.snippet}
              </TrustDetailLine>
            ))}
            <div className="mt-bakin-1">Agents WILL execute skill instructions. Only proceed if you trust this source.</div>
          </AlertDescription>
        </Alert>
      )}

      {requirements.dependencies.length > 0 && (
        <Alert tone="danger" data-testid="dependency-warnings">
          <AlertTitle>This source also installs other packages (not previewed):</AlertTitle>
          <AlertDescription>
            {requirements.dependencies.map((d) => (
              <TrustDetailLine key={d}>{d}</TrustDetailLine>
            ))}
            <div className="mt-bakin-1">Their binaries, npm payloads, and models install with the same trust as this one.</div>
          </AlertDescription>
        </Alert>
      )}

      {(requirements.bins.length > 0 || requirements.npm.length > 0 || requirements.models.length > 0) && (
        <Alert tone="danger" data-testid="download-warnings">
          <AlertTitle>This source downloads and installs software:</AlertTitle>
          <AlertDescription>
            {requirements.bins.map((b) => (
              <TrustDetailLine key={b.name}>
                binary {b.name}{b.url ? ` from ${b.url}` : ''}{b.willExecute ? ' — WILL BE EXECUTED during install' : ''}
              </TrustDetailLine>
            ))}
            {requirements.npm.map((n) => (
              <TrustDetailLine key={n}>npm {n} — dependencies installed into Bakin</TrustDetailLine>
            ))}
            {requirements.models.map((m) => (
              <TrustDetailLine key={m.name}>model {m.name} ({Math.round(m.bytes / 1_000_000)} MB download)</TrustDetailLine>
            ))}
            <div className="mt-bakin-1">Installed binaries land on your agents&apos; PATH. Only proceed if you trust this publisher.</div>
          </AlertDescription>
        </Alert>
      )}

      {(requirements.secrets.length > 0 || requirements.prereqs.length > 0 || requirements.platforms) && (
        <div className="grid gap-bakin-1 text-bakin-typography-size-body">
          <div className="font-bakin-typography-weight-medium text-bakin-text-primary">Requirements (translated from upstream metadata)</div>
          {requirements.secrets.map((s) => (
            <TrustDetailLine key={s.name}>
              key&nbsp;&nbsp;{s.name}{s.required ? '' : ' (optional)'}
              {s.secretSlot && <span className="text-bakin-text-muted"> → {s.secretSlot}</span>}
              {s.help && <span className="text-bakin-text-muted"> — {s.help}</span>}
            </TrustDetailLine>
          ))}
          {requirements.prereqs.map((p) => (
            <TrustDetailLine key={p.probe}>
              bin&nbsp;&nbsp;{p.probe}{p.optional ? ' (optional)' : ''} <span className="text-bakin-text-muted">— checked, never auto-installed</span>
            </TrustDetailLine>
          ))}
          {requirements.platforms && <TrustDetailLine>os&nbsp;&nbsp;&nbsp;{requirements.platforms.join(', ')}</TrustDetailLine>}
        </div>
      )}

      {preview.mentions.length > 0 && (
        <div className="text-bakin-typography-size-meta text-bakin-text-muted">
          Mentions env-var-shaped strings (unmapped — no readiness claim): {preview.mentions.join(', ')}.
          Run <span className="font-bakin-typography-family-mono">bakin skills map</span> after install if this skill needs keys Bakin didn&apos;t recognize.
        </div>
      )}

      {preview.warnings.map((w, i) => (
        <div key={i} className="text-bakin-typography-size-meta text-bakin-signal-attention">⚠ {w}</div>
      ))}

      <div className="text-bakin-typography-size-body">
        <div className="mb-bakin-1 font-bakin-typography-weight-medium text-bakin-text-muted">Files ({preview.files.length})</div>
        <div className="max-h-48 overflow-y-auto">
          {preview.files.map((f) => (
            <TrustDetailLine key={f.path}>{f.path} <span className="text-bakin-text-muted">{fmtBytes(f.bytes)}</span></TrustDetailLine>
          ))}
        </div>
      </div>

      {error && <div className="text-bakin-typography-size-body text-bakin-signal-danger">{error}</div>}

      <div className="mt-bakin-2 flex justify-end gap-bakin-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onInstall(preview)} disabled={busy} data-testid="confirm-install">
          {busy ? <Loader2 className="size-bakin-4 animate-spin" /> : <Download className="size-bakin-4" />}
          Install
        </Button>
      </div>
    </div>
  )
}

export function HubSkillsSection() {
  const { data, error, refresh } = useJsonFetch<SkillsListResponse>('/api/skills')
  const [ref, setRef] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [preview, setPreview] = useState<SkillPreviewWire | null>(null)
  const [drift, setDrift] = useState(false)
  const [installBusy, setInstallBusy] = useState(false)
  const [drawerError, setDrawerError] = useState<string | null>(null)
  const [boxError, setBoxError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ skillName: string; packageId: string } | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)

  const closeDrawer = () => {
    setPreview(null)
    setDrift(false)
    setDrawerError(null)
  }

  const runPreview = async () => {
    const trimmed = ref.trim()
    // Enter can fire while a preview is already staging server-side.
    if (!trimmed || previewBusy) return
    setPreviewBusy(true)
    setBoxError(null)
    try {
      const res = await fetch('/api/skills/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: trimmed }),
      })
      const body = await res.json() as { ok: boolean; refused?: boolean; error?: string; preview?: SkillPreviewWire }
      if (!body.ok || !body.preview) {
        setBoxError(body.refused ? `Refused: ${body.error}` : body.error ?? `HTTP ${res.status}`)
        return
      }
      setDrift(false)
      setPreview(body.preview)
    } catch (err) {
      setBoxError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewBusy(false)
    }
  }

  const runInstall = async (p: SkillPreviewWire) => {
    setInstallBusy(true)
    setDrawerError(null)
    try {
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: ref.trim(), consentToken: p.consentToken }),
      })
      const body = await res.json() as {
        ok: boolean
        refused?: boolean
        drift?: boolean
        error?: string
        warnings?: string[]
        preview?: SkillPreviewWire
      }
      if (body.ok) {
        const needsKey = p.requirements.secrets.some((s) => s.required)
        toast(
          needsKey
            ? `${p.skillName} installed — add its key in Settings → Integrations & Keys to make it ready.`
            : `${p.skillName} installed.`,
          'success',
        )
        closeDrawer()
        setRef('')
        refresh()
        return
      }
      if (body.drift && body.preview) {
        setPreview(body.preview)
        setDrift(true)
        return
      }
      setDrawerError(body.refused ? `Refused: ${body.error}` : body.error ?? `HTTP ${res.status}`)
    } catch (err) {
      setDrawerError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallBusy(false)
    }
  }

  const runRemove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(removing.packageId)}`, { method: 'DELETE' })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (body.ok === false) {
        toast(`Remove failed: ${body.error}`, 'error')
      } else {
        toast(`${removing.skillName} removed.`, 'success')
      }
      setRemoving(null)
      refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setRemoveBusy(false)
    }
  }

  const installed = data?.managed ?? []

  return (
    <div className="grid gap-bakin-4">
      {/* GROUPING RULE (live-test feedback): installed vs. available — never
          by source. One "Installed" list holds curated packs AND hub
          installs (same engine underneath); source is just a chip. */}
      {installed.length > 0 && (
        <div>
          <div className="mb-bakin-2 text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">Installed</div>
          <div className="divide-y divide-bakin-border-subtle rounded-bakin-surface border border-bakin-border-subtle">
            {installed.map((row) => (
              <div key={row.packageId + row.skillName} className="flex items-center justify-between gap-bakin-2 p-bakin-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-bakin-2 text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">
                    {row.skillName} <span className="text-bakin-typography-size-meta text-bakin-text-muted">v{row.version}</span>
                    <Badge tone="neutral" variant="soft" size="xs">{sourceChip(row.source, row.hub)}</Badge>
                  </div>
                  <div className="truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{row.source}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoving({ skillName: row.skillName, packageId: row.packageId })}
                  aria-label={`Remove ${row.skillName}`}
                >
                  <Trash2 className="size-bakin-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Everything below this header is "get more" — the official catalog
          grid follows on the page, and the paste box covers the rest of
          the ecosystem. */}
      <div>
        <div className="mb-bakin-1 text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">Get more capabilities</div>
        <div className="mb-bakin-3 text-bakin-typography-size-meta text-bakin-text-muted">
          Official ones below install with one click and guided setup. Or bring any skill from the wider
          ecosystem — browse clawhub.ai (or a GitHub skills repo), copy the page link, paste it here.
          You&apos;ll review a full trust preview before anything installs.
        </div>
        <div className="flex gap-bakin-2">
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            aria-label="Skill link or reference to install"
            placeholder="https://clawhub.ai/owner/skills/name · github.com/… · clawhub:@owner/name"
            onKeyDown={(e) => { if (e.key === 'Enter') void runPreview() }}
            data-testid="hub-ref-input"
          />
          <Button onClick={() => void runPreview()} disabled={previewBusy || ref.trim() === ''} data-testid="hub-preview-button">
            {previewBusy ? <Loader2 className="size-bakin-4 animate-spin" /> : <Download className="size-bakin-4" />}
            Preview & install
          </Button>
        </div>
        {boxError && <div className="mt-bakin-2 text-bakin-typography-size-body text-bakin-signal-danger" data-testid="hub-box-error">{boxError}</div>}
        {error != null && <div className="mt-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">Installed-skills list unavailable: {String(error)}</div>}
      </div>

      <Drawer
        open={preview !== null}
        onOpenChange={(open) => { if (!open) closeDrawer() }}
        storageKey="explore-hub-skill"
        title={preview ? `Install ${preview.skillName} v${preview.version}?` : ''}
        description={preview?.ref ?? ''}
      >
        {preview && (
          <PreviewDrawerBody
            preview={preview}
            drift={drift}
            busy={installBusy}
            error={drawerError}
            onInstall={(p) => void runInstall(p)}
            onCancel={closeDrawer}
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.skillName ?? ''}?`}
        description="Unprojects the skill from the runtime and removes its package. Agents lose it immediately."
        confirmLabel="Remove"
        confirmVariant="destructive"
        busy={removeBusy}
        onConfirm={() => void runRemove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  )
}
