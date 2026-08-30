/**
 * Derived-enrichment card (D8/T10): shows what the vision model saw in the
 * asset — caption, OCR text (collapsed), suggested tags (one-click apply),
 * summary/transcript — with inline edit (locks fields against machine
 * overwrites via userEdited) and a billed re-run.
 */
import { useState } from 'react'
import { DisclosurePanel, Panel, Section } from '@makinbakin/sdk/layout'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Input,
  Spinner,
  Text,
} from '@makinbakin/sdk/ui'
import { Pencil, RefreshCw, Sparkles, Tags } from 'lucide-react'
import { VERSIONED_API, TAGS_API, ENRICH_API } from './asset-urls'
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
      await fetch(ENRICH_API, {
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
      await fetch(`${TAGS_API}/apply`, {
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
          className="flex min-w-0 items-center gap-bakin-2 text-bakin-typography-size-body"
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
           
            data-testid="enrichment-rerun"
          >
            {busy ? <Spinner /> : <RefreshCw />}
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
        <Text size="meta" tone="muted" as="p" className="leading-relaxed">
          {enrichment.error}
        </Text>
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
          <Text size="body" as="p" className="min-w-0 flex-1 leading-relaxed">
            {enrichment.caption}
          </Text>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => { setDraftCaption(enrichment.caption ?? ''); setEditing(true) }}
            aria-label="Edit derived caption"
           
            data-testid="enrichment-caption-edit"
          >
            <Pencil />
          </Button>
        </div>
      ) : null}

      {enrichment.summary ? (
        <Text size="body" tone="muted" as="p" className="leading-relaxed">
          {enrichment.summary}
        </Text>
      ) : null}
      {enrichment.transcript && (
        <DisclosurePanel variant="ghost" summary="Transcript">
          <Panel variant="code" scroll padding="compact" aria-label="Transcript" className="max-h-48 text-bakin-text-muted">
            <pre>{enrichment.transcript}</pre>
          </Panel>
        </DisclosurePanel>
      )}

      {enrichment.ocrText && (
        <DisclosurePanel
          variant="ghost"
          summary="Text found in media (OCR)"
          open={ocrOpen}
          onToggle={(event) => setOcrOpen(event.currentTarget.open)}
        >
          <Panel variant="code" scroll padding="compact" aria-label="Text found in media" data-testid="enrichment-ocr" className="max-h-48 text-bakin-text-muted">
            <pre>{enrichment.ocrText}</pre>
          </Panel>
        </DisclosurePanel>
      )}

      {enrichment.suggestedTags && enrichment.suggestedTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-bakin-2" data-testid="enrichment-tags">
          {enrichment.suggestedTags.map((tag) => (
            <Badge key={tag} tone="neutral" variant="soft" size="xs">{tag}</Badge>
          ))}
          <Button size="xs" variant="ghost" onClick={applyTags} disabled={busy}>
            <Tags /> Apply
          </Button>
        </div>
      )}

      {(enrichment.model || enrichment.at) && (
        <Text size="meta" tone="muted" as="p">
          {enrichment.model}{enrichment.at ? ` · ${new Date(enrichment.at).toLocaleString()}` : ''}
        </Text>
      )}
    </Section>
  )
}
