import { useState } from 'react'
import { Download, Loader2, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { CodeBlock } from '@makinbakin/sdk/content'
import { toast, useJsonFetch } from '@makinbakin/sdk/hooks'
import {
  ConfirmDialog,
  KeyValue,
  ListRow,
  ListRowActions,
  ListRows,
  StatusBadge,
  type KeyValueItem,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Drawer,
  Input,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@makinbakin/sdk/ui'
import { describeRequestError } from '../lib/request-error'

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
 * Preview and install reach ClawHub/GitHub, so they get a ceiling rather than
 * an open-ended wait; `AbortSignal.timeout` tears down the whole exchange,
 * body read included, not just the headers.
 */
const LIST_TIMEOUT_MS = 15_000
const PREVIEW_TIMEOUT_MS = 60_000
const INSTALL_TIMEOUT_MS = 120_000
const REMOVE_TIMEOUT_MS = 60_000

/** Deadline rejections arrive as DOMExceptions — surface them as a real error. */

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

/**
 * The verdict is the headline trust signal on an install-consent surface, so
 * it must never depend on colour alone — and never on a colour class that does
 * not exist. `text-bakin-signal-success`/`-attention` are NOT in the kit
 * stylesheet (only accent/danger/highlight/info are), so the old hand-rolled
 * lines rendered in inherited body colour with a bare glyph as the only cue.
 * StatusBadge and Alert carry real tones plus their own non-colour framing.
 */
function VerdictLine({ state }: { state: SkillPreviewWire['verdictState'] }) {
  if (state === 'clean') {
    return (
      <StatusBadge tone="success" variant="soft" icon={ShieldCheck} data-testid="hub-verdict">
        ClawHub security verdict: clean
      </StatusBadge>
    )
  }
  const copy = state === 'unscanned'
    ? 'ClawHub has NOT scanned this version — treat it as unverified.'
    : state === 'unverified'
      ? 'ClawHub security verdict unavailable — content is unverified.'
      : 'No hub verdict exists for this source — review the files below.'
  return (
    <Alert tone="attention" data-testid="hub-verdict">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>Unverified content</AlertTitle>
      <AlertDescription>{copy}</AlertDescription>
    </Alert>
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
  const downloadLines = [
    ...requirements.bins.map((b) =>
      `binary ${b.name}${b.url ? ` from ${b.url}` : ''}${b.willExecute ? ' — WILL BE EXECUTED during install' : ''}`),
    ...requirements.npm.map((n) => `npm ${n} — dependencies installed into Bakin`),
    ...requirements.models.map((m) => `model ${m.name} (${Math.round(m.bytes / 1_000_000)} MB download)`),
  ]
  // Requirements used to align their columns with &nbsp; padding, which drifts
  // apart at any font or zoom change. KeyValue owns the alignment instead.
  const requirementItems: KeyValueItem[] = [
    ...requirements.secrets.map((s) => ({
      label: `key ${s.name}${s.required ? '' : ' (optional)'}`,
      value: [s.secretSlot, s.help].filter(Boolean).join(' — ') || null,
      mono: true,
      breakValue: true,
    })),
    ...requirements.prereqs.map((p) => ({
      label: `bin ${p.probe}${p.optional ? ' (optional)' : ''}`,
      value: 'checked, never auto-installed',
    })),
    ...(requirements.platforms ? [{ label: 'os', value: requirements.platforms.join(', ') }] : []),
  ]
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
        <p className="text-bakin-typography-size-body text-bakin-text-primary">{preview.description}</p>
      )}

      <VerdictLine state={preview.verdictState} />
      {preview.hub && (preview.hub.downloads !== undefined || preview.hub.stars !== undefined) && (
        <KeyValue
          layout="inline"
          items={[
            ...(preview.hub.downloads !== undefined
              ? [{ label: 'Downloads', value: preview.hub.downloads.toLocaleString(), numeric: true }]
              : []),
            ...(preview.hub.stars !== undefined
              ? [{ label: 'Stars', value: preview.hub.stars.toLocaleString(), numeric: true }]
              : []),
          ]}
        />
      )}

      {preview.risk.length > 0 && (
        <Alert tone="danger" data-testid="risk-warnings">
          <AlertTitle>This content instructs agents to run:</AlertTitle>
          <AlertDescription>
            <CodeBlock
              label="Risky instructions"
              wrap
              code={preview.risk.map((r) => `${r.file}:${r.line} [${r.pattern}] ${r.snippet}`).join('\n')}
            />
            <div className="mt-bakin-1">Agents WILL execute skill instructions. Only proceed if you trust this source.</div>
          </AlertDescription>
        </Alert>
      )}

      {requirements.dependencies.length > 0 && (
        <Alert tone="danger" data-testid="dependency-warnings">
          <AlertTitle>This source also installs other packages (not previewed):</AlertTitle>
          <AlertDescription>
            <CodeBlock label="Additional packages" wrap code={requirements.dependencies.join('\n')} />
            <div className="mt-bakin-1">Their binaries, npm payloads, and models install with the same trust as this one.</div>
          </AlertDescription>
        </Alert>
      )}

      {downloadLines.length > 0 && (
        <Alert tone="danger" data-testid="download-warnings">
          <AlertTitle>This source downloads and installs software:</AlertTitle>
          <AlertDescription>
            <CodeBlock label="Downloaded software" wrap code={downloadLines.join('\n')} />
            <div className="mt-bakin-1">Installed binaries land on your agents&apos; PATH. Only proceed if you trust this publisher.</div>
          </AlertDescription>
        </Alert>
      )}

      {requirementItems.length > 0 && (
        <div className="grid gap-bakin-1">
          <h3>Requirements (translated from upstream metadata)</h3>
          <KeyValue layout="columns" items={requirementItems} />
        </div>
      )}

      {preview.mentions.length > 0 && (
        <div className="text-bakin-typography-size-meta text-bakin-text-muted">
          Mentions env-var-shaped strings (unmapped — no readiness claim): {preview.mentions.join(', ')}.
          Run <span className="font-bakin-typography-family-mono">bakin skills map</span> after install if this skill needs keys Bakin didn&apos;t recognize.
        </div>
      )}

      {preview.warnings.length > 0 && (
        <Alert tone="attention" data-testid="hub-preview-warnings">
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ListRows variant="plain" size="sm">
              {preview.warnings.map((w, i) => <ListRow key={i}>{w}</ListRow>)}
            </ListRows>
          </AlertDescription>
        </Alert>
      )}

      {/* Every file, never a clipped window: the drawer already scrolls, and
          a nested `max-h` scroller here used to hide the remaining count
          outright on the one surface where "what am I installing" is the
          whole question. */}
      <div className="grid gap-bakin-1">
        <h3>Files ({preview.files.length})</h3>
        <CodeBlock
          label={`Files in ${preview.skillName}`}
          wrap
          code={preview.files.map((f) => `${f.path}  ${fmtBytes(f.bytes)}`).join('\n')}
        />
      </div>

      {error && (
        <Alert tone="danger" data-testid="hub-drawer-error">
          <AlertTitle>The skill was not installed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

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
  const { data, error, refresh } = useJsonFetch<SkillsListResponse>('/api/skills', { timeoutMs: LIST_TIMEOUT_MS })
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
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
      })
      const body = await res.json() as { ok: boolean; refused?: boolean; error?: string; preview?: SkillPreviewWire }
      if (!body.ok || !body.preview) {
        setBoxError(body.refused ? `Refused: ${body.error}` : body.error ?? `HTTP ${res.status}`)
        return
      }
      setDrift(false)
      setPreview(body.preview)
    } catch (err) {
      setBoxError(describeRequestError(err))
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
        signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
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
      setDrawerError(describeRequestError(err))
    } finally {
      setInstallBusy(false)
    }
  }

  const runRemove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    try {
      const res = await fetch(`/api/packages/${encodeURIComponent(removing.packageId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(REMOVE_TIMEOUT_MS),
      })
      const body = await res.json() as { ok?: boolean; error?: string }
      if (body.ok === false) {
        toast(`Remove failed: ${body.error}`, 'error')
      } else {
        toast(`${removing.skillName} removed.`, 'success')
      }
      setRemoving(null)
      refresh()
    } catch (err) {
      toast(describeRequestError(err), 'error')
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
        <div className="grid gap-bakin-2">
          <h3>Installed</h3>
          <ListRows variant="bordered" size="sm">
            {installed.map((row) => (
              <ListRow key={row.packageId + row.skillName}>
                <div className="min-w-0">
                  <div className="flex items-center gap-bakin-2 text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">
                    {row.skillName} <span className="text-bakin-typography-size-meta text-bakin-text-muted">v{row.version}</span>
                    <Badge tone="neutral" variant="soft" size="xs">{sourceChip(row.source, row.hub)}</Badge>
                  </div>
                  {/* The ref truncates in this narrow panel; the tooltip is the
                      only place the full source stays readable. */}
                  <Tooltip>
                    <TooltipTrigger
                      render={<span />}
                      className="block min-w-0 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted"
                    >
                      {row.source}
                    </TooltipTrigger>
                    <TooltipContent>{row.source}</TooltipContent>
                  </Tooltip>
                </div>
                <ListRowActions>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving({ skillName: row.skillName, packageId: row.packageId })}
                    aria-label={`Remove ${row.skillName}`}
                  >
                    <Trash2 className="size-bakin-4" />
                  </Button>
                </ListRowActions>
              </ListRow>
            ))}
          </ListRows>
        </div>
      )}

      {/* Everything below this header is "get more" — the official catalog
          grid follows on the page, and the paste box covers the rest of
          the ecosystem. */}
      <div className="grid gap-bakin-2">
        <h3>Get more capabilities</h3>
        <div className="text-bakin-typography-size-meta text-bakin-text-muted">
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
        {boxError && (
          <Alert tone="danger" data-testid="hub-box-error">
            <AlertTitle>That link could not be previewed</AlertTitle>
            <AlertDescription>{boxError}</AlertDescription>
          </Alert>
        )}
        {/* A failed list read is a failure, not a hint: as muted meta text it
            was indistinguishable from the blurb above it, so an outage read as
            "you have nothing installed". */}
        {error != null && (
          <Alert tone="attention" data-testid="hub-list-error">
            <AlertTitle>Installed skills could not be listed</AlertTitle>
            <AlertDescription>
              {String(error)} — anything already installed is still installed; this list is just unavailable.
            </AlertDescription>
          </Alert>
        )}
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
