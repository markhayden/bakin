'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from '@/components/markdown-content'
import { Trash2, ExternalLink, Download, Clock, User, Wrench, Tag } from 'lucide-react'
import type { AssetMeta } from '@/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface AssetDetailProps {
  asset: AssetMeta | null
  onClose: () => void
  onDelete: (path: string) => void
}

function AssetRenderer({ asset }: { asset: AssetMeta }) {
  const fileUrl = `/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}`

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
      return <TextRenderer fileUrl={fileUrl} mimeType={asset.mimeType} />

    case 'data':
      return <CodeRenderer fileUrl={fileUrl} />

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
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>
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
    return <div className="p-4 text-sm text-muted-foreground">Loading...</div>
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

export function AssetDetail({ asset, onClose, onDelete }: AssetDetailProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!asset) return null

  const fileUrl = `/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}`

  return (
    <Dialog open={!!asset} onOpenChange={() => { onClose(); setConfirmDelete(false) }}>
      <DialogContent className="bg-card border-border !max-w-[calc(100vw-2rem)] !w-full h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span>{asset.filename}</span>
            <Badge variant="outline" className="text-[10px] h-4">
              {asset.type}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          {/* Main content area */}
          <div className="flex-1 min-w-0 min-h-0">
            <AssetRenderer asset={asset} />
          </div>

          {/* Sidebar info */}
          <div className="lg:w-64 shrink-0 flex flex-col gap-3 text-sm overflow-y-auto">
            {/* Agent */}
            <div className="flex items-center gap-2">
              <User className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Agent:</span>
              <span className="text-foreground">{asset.metadata.agent}</span>
            </div>

            {/* Created */}
            <div className="flex items-center gap-2">
              <Clock className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Created:</span>
              <span className="text-foreground text-xs">
                {new Date(asset.metadata.created).toLocaleString()}
              </span>
            </div>

            {/* Tool */}
            {asset.metadata.tool && (
              <div className="flex items-center gap-2">
                <Wrench className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Tool:</span>
                <span className="text-foreground">{asset.metadata.tool}</span>
              </div>
            )}

            {/* Task link */}
            {asset.metadata.taskId && (
              <div className="flex items-center gap-2">
                <ExternalLink className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Task:</span>
                <a
                  href={`/tasks?taskId=${asset.metadata.taskId}`}
                  className="text-blue-400 hover:text-blue-300 text-xs"
                >
                  {asset.metadata.taskId.slice(0, 8)}...
                </a>
              </div>
            )}

            {/* Size */}
            <div className="text-xs text-muted-foreground">
              {formatSize(asset.size)} &middot; {asset.mimeType}
            </div>

            {/* Tags */}
            {asset.metadata.tags && asset.metadata.tags.length > 0 && (
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Tag className="size-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Tags</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {asset.metadata.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {asset.metadata.description && (
              <div className="text-xs text-muted-foreground border-t border-border pt-3 mt-1">
                {asset.metadata.description}
              </div>
            )}

            {/* Actions */}
            <div className="border-t border-border pt-3 mt-auto flex flex-col gap-2">
              <a
                href={fileUrl}
                download={asset.filename}
                className="flex items-center justify-center gap-1.5 text-xs text-foreground bg-zinc-800 hover:bg-zinc-700 rounded-md px-3 py-1.5 transition-colors"
              >
                <Download className="size-3.5" />
                Download
              </a>

              {confirmDelete ? (
                <div className="flex gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-1 text-xs h-7"
                    onClick={() => onDelete(asset.path)}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-md px-3 py-1.5 transition-colors"
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
