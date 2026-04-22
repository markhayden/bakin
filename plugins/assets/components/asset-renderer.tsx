'use client'

/**
 * Asset preview renderers — dispatched by asset `type` and fed into the
 * shared `asset-preview` slot. Registered in `plugins/assets/client.tsx` so
 * the built-in renderers are available wherever `<Slot name="asset-preview">`
 * is rendered (today: `AssetDetail`). User plugins can `registerSlot` on the
 * same name with lower `order` to add their own renderers — e.g., a 3D model
 * preview for `.glb` / `.stl` / etc.
 */
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Skeleton } from '@bakin/sdk/ui'
import { MarkdownContent } from '@bakin/sdk/components'
import type { AssetMeta } from '@bakin/sdk/types'

export function AssetRenderer({ asset }: { asset: AssetMeta }) {
  const fileUrl = `/api/assets/${encodeURIComponent(asset.filename)}?v=${asset.mtimeMs || ''}`

  switch (asset.type) {
    case 'images':
      return (
        <div className="flex items-center justify-center bg-zinc-950 rounded-lg p-2 h-full overflow-auto">
          <img
            src={fileUrl}
            alt={asset.filename}
            className="max-w-full max-h-full object-contain rounded"
          />
        </div>
      )

    case 'video':
      return (
        <div className="bg-zinc-950 rounded-lg overflow-hidden h-full flex items-center">
          <video
            src={fileUrl}
            controls
            className="w-full max-h-full"
            preload="metadata"
          />
        </div>
      )

    case 'audio':
      return (
        <div className="bg-zinc-900 rounded-lg p-6 flex flex-col items-center gap-4">
          <div className="size-20 rounded-full bg-zinc-800 flex items-center justify-center">
            <span className="text-3xl">🎵</span>
          </div>
          <audio src={fileUrl} controls className="w-full" preload="metadata" />
        </div>
      )

    case 'text':
    case 'plans':
    case 'research':
      return <TextRenderer fileUrl={fileUrl} mimeType={asset.mimeType} />

    case 'data':
      return <CodeRenderer fileUrl={fileUrl} />

    case 'pdf':
      return (
        <div className="bg-zinc-950 rounded-lg h-full overflow-hidden">
          <embed src={fileUrl} type="application/pdf" className="w-full h-full" />
        </div>
      )

    default:
      return (
        <div className="bg-zinc-900 rounded-lg p-8 flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">
            Preview not available for this file type.
          </p>
          <a
            href={fileUrl}
            download={asset.filename}
            className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"
          >
            <Download className="size-4" />
            Download {asset.filename}
          </a>
        </div>
      )
  }
}

function TextRenderer({ fileUrl, mimeType }: { fileUrl: string; mimeType: string }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent('Failed to load content'))
  }, [fileUrl])

  if (content === null) {
    return <Skeleton className="h-40 w-full" />
  }

  if (mimeType === 'text/markdown') {
    return (
      <div className="bg-zinc-900/50 rounded-lg p-4 h-full overflow-y-auto">
        <MarkdownContent content={content} />
      </div>
    )
  }

  if (mimeType === 'text/yaml' || mimeType === 'application/yaml') {
    return (
      <pre className="bg-zinc-900 rounded-lg p-4 text-sm text-zinc-300 overflow-auto h-full font-mono">
        {content}
      </pre>
    )
  }

  return (
    <pre className="bg-zinc-900 rounded-lg p-4 text-sm text-zinc-300 overflow-auto h-full font-mono whitespace-pre-wrap">
      {content}
    </pre>
  )
}

function CodeRenderer({ fileUrl }: { fileUrl: string }) {
  const [content, setContent] = useState<string | null>(null)

  useEffect(() => {
    fetch(fileUrl)
      .then(r => r.text())
      .then(setContent)
      .catch(() => setContent('Failed to load content'))
  }, [fileUrl])

  if (content === null) {
    return <Skeleton className="h-40 w-full" />
  }

  // Try to pretty-print JSON
  let displayContent = content
  try {
    const parsed = JSON.parse(content)
    displayContent = JSON.stringify(parsed, null, 2)
  } catch { /* not JSON, show as-is */ }

  return (
    <pre className="bg-zinc-900 rounded-lg p-4 text-sm text-zinc-300 overflow-auto h-full font-mono">
      {displayContent}
    </pre>
  )
}
