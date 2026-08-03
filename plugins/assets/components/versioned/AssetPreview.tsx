'use client'

/**
 * Renders the current version of an asset inline, by type — images, video,
 * audio, PDF (embedded), markdown (rendered), and text/data (with an editor
 * for editable mime types). Editing saves the result as a NEW version via the
 * /versioned/:assetId/version upload route (history stays immutable).
 */
import { useEffect, useState } from 'react'
import { Download, Pencil, Save, X } from 'lucide-react'
import { Button, Textarea } from '@makinbakin/sdk/ui'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { isEditableMimeType } from '../../lib/constants'
import { AssetTypeIcon } from './atoms'
import { assetVersionUrl, VERSIONED_API } from './asset-urls'

const EXT_BY_MIME: Record<string, string> = {
  'text/markdown': 'md', 'text/plain': 'txt', 'application/rtf': 'rtf',
  'text/yaml': 'yaml', 'application/yaml': 'yaml', 'application/json': 'json',
  'text/csv': 'csv', 'text/tab-separated-values': 'tsv', 'application/xml': 'xml',
}

interface AssetPreviewProps {
  assetId: string
  type: string
  mimeType: string
  version: number
  currentFile: string
  onImageClick?: () => void
  onSaved?: () => void
}

export function AssetPreview({ assetId, type, mimeType, version, currentFile, onImageClick, onSaved }: AssetPreviewProps) {
  // Version-specific path (/v/<n>) so the selected version actually renders —
  // a query cache-bust on the bare assetId always served the current version.
  const fileUrl = assetVersionUrl(assetId, version)

  if (type === 'images') {
    return (
      <div className="flex max-h-[76vh] items-center justify-center rounded-bakin-surface bg-bakin-surface-default p-2" data-testid="preview-image">
        <img src={fileUrl} alt={assetId} onClick={onImageClick}
          className={`max-h-[74vh] max-w-full rounded-bakin-control object-contain ${onImageClick ? 'cursor-zoom-in' : ''}`} />
      </div>
    )
  }
  if (type === 'video') {
    return (
      <div className="overflow-hidden rounded-bakin-surface bg-bakin-surface-default" data-testid="preview-video">
        <video src={fileUrl} controls preload="metadata" className="max-h-[76vh] w-full" />
      </div>
    )
  }
  if (type === 'audio') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-bakin-surface bg-bakin-surface-default p-6" data-testid="preview-audio">
        <div className="flex size-20 items-center justify-center rounded-bakin-pill bg-bakin-border-subtle/30 text-3xl">🎵</div>
        <audio src={fileUrl} controls preload="metadata" className="w-full" />
      </div>
    )
  }
  if (type === 'pdf') {
    return (
      <div className="h-[78vh] overflow-hidden rounded-bakin-surface bg-bakin-surface-default" data-testid="preview-pdf">
        <embed src={fileUrl} type="application/pdf" className="h-full w-full" />
      </div>
    )
  }
  if (type === 'text' || type === 'plans' || type === 'research' || type === 'data') {
    return (
      <TextPreview
        assetId={assetId}
        fileUrl={fileUrl}
        mimeType={mimeType}
        currentFile={currentFile}
        onSaved={onSaved}
      />
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-bakin-surface bg-bakin-surface-default p-8 text-center" data-testid="preview-download">
      <AssetTypeIcon type={type} className="size-10" />
      <p className="text-sm text-bakin-text-muted">Preview not available for this type.</p>
      <a href={fileUrl} download className="flex items-center gap-1 text-sm text-bakin-signal-accent hover:underline">
        <Download className="size-4" /> Download
      </a>
    </div>
  )
}

function TextPreview({ assetId, fileUrl, mimeType, currentFile, onSaved }: {
  assetId: string; fileUrl: string; mimeType: string; currentFile: string; onSaved?: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editable = isEditableMimeType(mimeType)

  // Deliberately NOT `useJsonFetch`: this loads the raw text body, and the
  // SDK hook is JSON-only.
  useEffect(() => {
    let cancelled = false
    setContent(null)
    fetch(fileUrl)
      .then(r => r.text())
      .then(t => { if (!cancelled) setContent(t) })
      .catch(() => { if (!cancelled) setContent('Failed to load content') })
    return () => { cancelled = true }
  }, [fileUrl])

  const startEdit = () => { setDraft(content ?? ''); setError(null); setEditing(true) }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const ext = currentFile.includes('.') ? currentFile.split('.').pop()! : (EXT_BY_MIME[mimeType] || 'txt')
      const form = new FormData()
      form.append('file', new File([new Blob([draft], { type: mimeType })], `edit.${ext}`, { type: mimeType }))
      const res = await fetch(`${VERSIONED_API}/${encodeURIComponent(assetId)}/version`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error || `Save failed (${res.status})`)
      }
      setEditing(false)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (content === null) return <div className="h-40 animate-pulse rounded-bakin-surface bg-bakin-surface-default/60" data-testid="preview-loading" />

  if (editing) {
    return (
      <div className="rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-2" data-testid="preview-editor">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-[72vh] w-full resize-none font-mono text-sm"
          spellCheck={false}
        />
        {error && <p className="px-1 pt-1 text-xs text-bakin-signal-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}><X className="size-4" /> Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving} data-testid="save-version">
            <Save className="size-4" /> {saving ? 'Saving…' : 'Save as new version'}
          </Button>
        </div>
      </div>
    )
  }

  let display = content
  if (mimeType === 'application/json') {
    try { display = JSON.stringify(JSON.parse(content), null, 2) } catch { /* show raw */ }
  }

  return (
    <div className="relative rounded-bakin-surface bg-bakin-surface-default" data-testid="preview-text">
      {editable && (
        <Button size="sm" variant="outline" className="absolute right-2 top-2 z-10 h-7 text-xs" onClick={startEdit} data-testid="edit-asset">
          <Pencil className="size-3.5" /> Edit
        </Button>
      )}
      {mimeType === 'text/markdown' ? (
        <div className="max-h-[76vh] overflow-y-auto p-4"><MarkdownContent content={content} /></div>
      ) : (
        <pre className="max-h-[76vh] overflow-auto whitespace-pre-wrap p-4 font-mono text-sm text-bakin-text-primary">{display}</pre>
      )}
    </div>
  )
}
