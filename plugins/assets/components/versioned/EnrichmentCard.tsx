/**
 * Derived-enrichment card (D8/T10): shows what the vision model saw in the
 * asset — caption, OCR text (collapsed), suggested tags (one-click apply),
 * summary/transcript — with inline edit (locks fields against machine
 * overwrites via userEdited) and a billed re-run.
 */
import { useState } from 'react'
import { Panel, Section } from '@makinbakin/sdk/layout'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
} from '@makinbakin/sdk/ui'
import { Loader2, Pencil, RefreshCw, Sparkles, Tags } from 'lucide-react'
import { VERSIONED_API } from './asset-urls'

const PLUGIN_API = '/api/plugins/assets'
import type { VersionedAssetManifest } from './types'

interface Props {
  manifest: VersionedAssetManifest
  onChanged: () => void
}

export function EnrichmentCard({ manifest, onChanged }: Props) {
  const enrichment = manifest.enrichment
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftCaption, setDraftCaption] = useState('')
  const [ocrOpen, setOcrOpen] = useState(false)

  if (!enrichment) return null

  const statusTone = enrichment.status === 'failed'
    ? 'danger'
    : enrichment.status === 'done'
      ? 'success'
      : enrichment.status === 'pending'
        ? 'attention'
        : 'neutral'

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
    <Section
      as="div"
      spacing="compact"
      divider="top"
      className="@container/enrichment"
      data-testid="enrichment-card"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-2">
        <h3
          className="m-0 flex min-w-0 items-center gap-bakin-2 text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary"
        >
          <Sparkles className="size-bakin-3 shrink-0 text-bakin-signal-accent" /> Enrichment
        </h3>
        <div className="flex items-center gap-bakin-2">
          {enrichment.userEdited ? <Badge tone="accent" variant="soft" size="xs">edited</Badge> : null}
          <Badge tone={statusTone} variant="soft" size="xs" data-testid="enrichment-status">
            {enrichment.status}
          </Badge>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={rerun}
            disabled={busy}
            aria-label="Re-run derived metadata analysis"
            title="Re-run vision enrichment (billed)"
            data-testid="enrichment-rerun"
          >
            {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {enrichment.status === 'failed' && (
        <Alert tone="danger" data-testid="enrichment-error">
          <AlertTitle>Enrichment failed</AlertTitle>
          <AlertDescription>
            {enrichment.error ?? 'Enrichment failed'} — retry re-runs the vision call.
          </AlertDescription>
        </Alert>
      )}
      {enrichment.status === 'skipped' && enrichment.error && (
        <p className="m-0 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
          {enrichment.error}
        </p>
      )}

      {editing ? (
        <div className="flex min-w-0 flex-col gap-bakin-2 @md/enrichment:flex-row @md/enrichment:items-center">
          <Input
            aria-label="Derived caption"
            className="min-w-0 flex-1"
            value={draftCaption}
            onChange={(e) => setDraftCaption(e.target.value)}
            data-testid="enrichment-caption-input"
          />
          <div className="flex items-center gap-bakin-2">
            <Button size="sm" onClick={saveCaption} disabled={busy}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : enrichment.caption ? (
        <div className="flex min-w-0 items-start gap-bakin-3" data-testid="enrichment-caption">
          <p className="m-0 min-w-0 flex-1 text-bakin-typography-size-body leading-relaxed text-bakin-text-primary">
            {enrichment.caption}
          </p>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => { setDraftCaption(enrichment.caption ?? ''); setEditing(true) }}
            aria-label="Edit derived caption"
            title="Edit caption (locks it against machine overwrites)"
            data-testid="enrichment-caption-edit"
          >
            <Pencil />
          </Button>
        </div>
      ) : null}

      {enrichment.summary ? (
        <p className="m-0 text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
          {enrichment.summary}
        </p>
      ) : null}
      {enrichment.transcript && (
        <details className="text-bakin-typography-size-meta">
          <summary className="cursor-pointer text-bakin-text-muted">Transcript</summary>
          <Panel variant="code" scroll padding="compact" aria-label="Transcript" className="mt-bakin-2 max-h-48 text-bakin-text-muted">
            <pre>{enrichment.transcript}</pre>
          </Panel>
        </details>
      )}

      {enrichment.ocrText && (
        <details className="text-bakin-typography-size-meta" open={ocrOpen} onToggle={(e) => setOcrOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="cursor-pointer text-bakin-text-muted">Text found in media (OCR)</summary>
          <Panel variant="code" scroll padding="compact" aria-label="Text found in media" data-testid="enrichment-ocr" className="mt-bakin-2 max-h-48 text-bakin-text-muted">
            <pre>{enrichment.ocrText}</pre>
          </Panel>
        </details>
      )}

      {enrichment.suggestedTags && enrichment.suggestedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-bakin-2" data-testid="enrichment-tags">
          {enrichment.suggestedTags.map((tag) => (
            <Badge key={tag} tone="neutral" variant="soft" size="xs">{tag}</Badge>
          ))}
          <Button size="xs" variant="ghost" onClick={applyTags} disabled={busy} title="Apply suggested tags to the asset">
            <Tags /> Apply
          </Button>
        </div>
      )}

      {(enrichment.model || enrichment.at) && (
        <p className="m-0 text-bakin-typography-size-meta text-bakin-text-muted">
          {enrichment.model}{enrichment.at ? ` · ${new Date(enrichment.at).toLocaleString()}` : ''}
        </p>
      )}
    </Section>
  )
}
