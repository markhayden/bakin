/**
 * Derived-enrichment card (D8/T10): shows what the vision model saw in the
 * asset — caption, OCR text (collapsed), suggested tags (one-click apply),
 * summary/transcript — with inline edit (locks fields against machine
 * overwrites via userEdited) and a billed re-run.
 */
import { useState } from 'react'
import { Badge, Button } from '@makinbakin/sdk/ui'
import { Loader2, Pencil, RefreshCw, Tags } from 'lucide-react'
import { VERSIONED_API } from './asset-urls'

const PLUGIN_API = '/api/plugins/assets'
import type { VersionedAssetManifest } from './types'

export interface AssetEnrichmentView {
  status: 'pending' | 'done' | 'failed' | 'skipped'
  caption?: string
  ocrText?: string
  suggestedTags?: string[]
  summary?: string
  transcript?: string
  model?: string
  at?: string
  error?: string
  userEdited?: boolean
}

interface Props {
  manifest: VersionedAssetManifest & { enrichment?: AssetEnrichmentView }
  onChanged: () => void
}

export function EnrichmentCard({ manifest, onChanged }: Props) {
  const enrichment = manifest.enrichment
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftCaption, setDraftCaption] = useState('')
  const [ocrOpen, setOcrOpen] = useState(false)

  if (!enrichment) return null

  const rerun = async () => {
    setBusy(true)
    try {
      await fetch(`${PLUGIN_API}/enrich`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetId: manifest.assetId, force: true }),
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const saveCaption = async () => {
    setBusy(true)
    try {
      await fetch(`${VERSIONED_API}/${encodeURIComponent(manifest.assetId)}/enrichment`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caption: draftCaption }),
      })
      setEditing(false)
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const applyTags = async () => {
    if (!enrichment.suggestedTags?.length) return
    setBusy(true)
    try {
      await fetch(`${PLUGIN_API}/tags/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetIds: [manifest.assetId], add: enrichment.suggestedTags }),
      })
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-4 rounded-md border border-border p-3" data-testid="enrichment-card">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase text-muted-foreground">Derived metadata</h2>
        <div className="flex items-center gap-2">
          {enrichment.userEdited && <Badge variant="outline">edited</Badge>}
          <Badge variant={enrichment.status === 'failed' ? 'destructive' : 'secondary'} data-testid="enrichment-status">
            {enrichment.status}
          </Badge>
          <Button size="sm" variant="ghost" onClick={rerun} disabled={busy} title="Re-run vision enrichment (billed)" data-testid="enrichment-rerun">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          </Button>
        </div>
      </div>

      {enrichment.status === 'failed' && (
        <p className="mb-2 text-xs text-destructive" data-testid="enrichment-error">
          {enrichment.error ?? 'Enrichment failed'} — retry re-runs the vision call.
        </p>
      )}
      {enrichment.status === 'skipped' && enrichment.error && (
        <p className="mb-2 text-xs text-muted-foreground">{enrichment.error}</p>
      )}

      {editing ? (
        <div className="mb-2 flex items-center gap-2">
          <input
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm"
            value={draftCaption}
            onChange={(e) => setDraftCaption(e.target.value)}
            data-testid="enrichment-caption-input"
          />
          <Button size="sm" onClick={saveCaption} disabled={busy}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : enrichment.caption ? (
        <p className="mb-2 flex items-start gap-2 text-sm" data-testid="enrichment-caption">
          <span className="flex-1">{enrichment.caption}</span>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => { setDraftCaption(enrichment.caption ?? ''); setEditing(true) }}
            title="Edit caption (locks it against machine overwrites)"
            data-testid="enrichment-caption-edit"
          >
            <Pencil className="size-3.5" />
          </button>
        </p>
      ) : null}

      {enrichment.summary && <p className="mb-2 text-sm text-muted-foreground">{enrichment.summary}</p>}
      {enrichment.transcript && (
        <details className="mb-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Transcript</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">{enrichment.transcript}</pre>
        </details>
      )}

      {enrichment.ocrText && (
        <details className="mb-2 text-xs" open={ocrOpen} onToggle={(e) => setOcrOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-muted-foreground">Text found in media (OCR)</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground" data-testid="enrichment-ocr">{enrichment.ocrText}</pre>
        </details>
      )}

      {enrichment.suggestedTags && enrichment.suggestedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="enrichment-tags">
          {enrichment.suggestedTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
          <Button size="sm" variant="ghost" onClick={applyTags} disabled={busy} title="Apply suggested tags to the asset">
            <Tags className="mr-1 size-3.5" /> Apply
          </Button>
        </div>
      )}

      {(enrichment.model || enrichment.at) && (
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          {enrichment.model}{enrichment.at ? ` · ${new Date(enrichment.at).toLocaleString()}` : ''}
        </p>
      )}
    </div>
  )
}
