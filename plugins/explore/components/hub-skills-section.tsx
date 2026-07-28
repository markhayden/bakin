import { useState } from 'react'
import { Download, Loader2, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { BakinDrawer, ConfirmDialog } from '@makinbakin/sdk/components'
import { toast, useJsonFetch } from '@makinbakin/sdk/hooks'
import { Button, Input } from '@makinbakin/sdk/ui'

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
    secrets: Array<{ name: string; required: boolean; help?: string }>
    prereqs: Array<{ name: string; probe: string; optional: boolean }>
    platforms?: string[]
  }
  mentions: string[]
  warnings: string[]
  risk: Array<{ file: string; line: number; pattern: string; snippet: string }>
  hub?: { downloads?: number; stars?: number }
  verdictState: 'clean' | 'unverified' | 'none'
  consentToken: string
}

interface SkillsListResponse {
  managed: Array<{ skillName: string; packageId: string; version: string; source: string; hub: boolean; capability?: string }>
  unmanaged: Array<{ name: string; scope: string }>
}

function fmtBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function VerdictLine({ state }: { state: SkillPreviewWire['verdictState'] }) {
  if (state === 'clean') {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-500">
        <ShieldCheck className="size-4" /> ClawHub security verdict: clean
      </div>
    )
  }
  const copy = state === 'unverified'
    ? 'ClawHub security verdict unavailable — content is unverified.'
    : 'No hub verdict exists for this source — review the files below.'
  return (
    <div className="flex items-center gap-2 text-sm text-amber-500">
      <ShieldAlert className="size-4" /> {copy}
    </div>
  )
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
    <div className="flex flex-col gap-4 p-4" data-testid="hub-preview-body">
      {drift && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          The skill content changed since the last preview. Review again before installing.
        </div>
      )}

      {preview.description && <p className="text-sm text-foreground/90">{preview.description}</p>}

      <VerdictLine state={preview.verdictState} />
      {preview.hub && (preview.hub.downloads !== undefined || preview.hub.stars !== undefined) && (
        <div className="text-xs text-muted-foreground">
          {[
            preview.hub.downloads !== undefined ? `${preview.hub.downloads.toLocaleString()} downloads` : null,
            preview.hub.stars !== undefined ? `${preview.hub.stars.toLocaleString()} stars` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      {preview.risk.length > 0 && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400" data-testid="risk-warnings">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <ShieldAlert className="size-4" /> This content instructs agents to run:
          </div>
          {preview.risk.map((r, i) => (
            <div key={i} className="font-mono text-xs">
              {r.file}:{r.line} [{r.pattern}] {r.snippet}
            </div>
          ))}
          <div className="mt-1 text-xs">Agents WILL execute skill instructions. Only proceed if you trust this source.</div>
        </div>
      )}

      {(requirements.secrets.length > 0 || requirements.prereqs.length > 0 || requirements.platforms) && (
        <div className="space-y-1 text-sm">
          <div className="font-medium">Requirements (translated from upstream metadata)</div>
          {requirements.secrets.map((s) => (
            <div key={s.name} className="font-mono text-xs">
              key&nbsp;&nbsp;{s.name}{s.required ? '' : ' (optional)'}
              {s.help && <span className="text-muted-foreground"> — {s.help}</span>}
            </div>
          ))}
          {requirements.prereqs.map((p) => (
            <div key={p.probe} className="font-mono text-xs">
              bin&nbsp;&nbsp;{p.probe}{p.optional ? ' (optional)' : ''} <span className="text-muted-foreground">— checked, never auto-installed</span>
            </div>
          ))}
          {requirements.platforms && <div className="font-mono text-xs">os&nbsp;&nbsp;&nbsp;{requirements.platforms.join(', ')}</div>}
        </div>
      )}

      {preview.mentions.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Mentions env-var-shaped strings (unmapped — no readiness claim): {preview.mentions.join(', ')}.
          Run <span className="font-mono">bakin skills map</span> after install if this skill needs keys Bakin didn&apos;t recognize.
        </div>
      )}

      {preview.warnings.map((w, i) => (
        <div key={i} className="text-xs text-amber-500">⚠ {w}</div>
      ))}

      <div className="text-sm">
        <div className="mb-1 font-medium text-muted-foreground">Files ({preview.files.length})</div>
        <div className="max-h-48 overflow-y-auto">
          {preview.files.map((f) => (
            <div key={f.path} className="font-mono text-xs">{f.path} <span className="text-muted-foreground">{fmtBytes(f.bytes)}</span></div>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-red-500">{error}</div>}

      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onInstall(preview)} disabled={busy} data-testid="confirm-install">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
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
    if (!trimmed) return
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

  const hubSkills = data?.managed.filter((row) => row.hub) ?? []

  return (
    <div className="space-y-4">
      {/* CTA: bring skills from anywhere. Curated cards follow on the page. */}
      <div className="rounded-lg border p-4">
        <div className="mb-1 text-sm font-medium">Install from ClawHub, GitHub, or any skills repo</div>
        <div className="mb-3 text-xs text-muted-foreground">
          Browse clawhub.ai (or a GitHub skills repo), copy the page link, paste it here. You&apos;ll review a
          full trust preview before anything installs; nothing from a skill ever runs at install time.
        </div>
        <div className="flex gap-2">
          <Input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="https://clawhub.ai/owner/skills/name · github.com/… · clawhub:@owner/name"
            onKeyDown={(e) => { if (e.key === 'Enter') void runPreview() }}
            data-testid="hub-ref-input"
          />
          <Button onClick={() => void runPreview()} disabled={previewBusy || ref.trim() === ''} data-testid="hub-preview-button">
            {previewBusy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Preview & install
          </Button>
        </div>
        {boxError && <div className="mt-2 text-sm text-red-500" data-testid="hub-box-error">{boxError}</div>}
        {error != null && <div className="mt-2 text-xs text-muted-foreground">Installed-skills list unavailable: {String(error)}</div>}
      </div>

      {hubSkills.length > 0 && (
        <div>
          <div className="mb-2 text-sm font-medium">From the ecosystem</div>
          <div className="divide-y rounded-lg border">
            {hubSkills.map((row) => (
              <div key={row.packageId + row.skillName} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {row.skillName} <span className="text-xs text-muted-foreground">v{row.version}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-muted-foreground">{row.source}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoving({ skillName: row.skillName, packageId: row.packageId })}
                  aria-label={`Remove ${row.skillName}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <BakinDrawer
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
      </BakinDrawer>

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
