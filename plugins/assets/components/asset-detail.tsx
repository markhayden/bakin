'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { MarkdownContent } from '@/components/markdown-content'
import { MarkdownEditor } from '@/components/markdown-editor'
import { ASSET_TYPES, isEditableMimeType } from '../lib/constants'
import { Trash2, ExternalLink, Download, Clock, User, Wrench, Tag, Layers, Eye, Pencil, Check, X, Unlink } from 'lucide-react'
import { formatSize } from '@/lib/format'
import { DeleteAssetDialog } from './delete-asset-dialog'
import type { AssetMeta } from '@/types'

interface AssetDetailProps {
  asset: AssetMeta | null
  onClose: () => void
  onDelete: (path: string) => void
  onRelink?: () => void
  onPathChange?: (newPath: string) => void
}

function AssetRenderer({ asset }: { asset: AssetMeta }) {
  const fileUrl = `/api/plugins/assets/file?path=${encodeURIComponent(asset.path)}&v=${asset.mtimeMs || ''}`

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

/**
 * Standalone modal that fetches asset metadata by path and renders AssetDetail.
 * Usable from any context (e.g. task drawer) without needing the full assets page.
 */
export function AssetDetailModal({ assetPath, onClose }: { assetPath: string; onClose: () => void }) {
  const [asset, setAsset] = useState<AssetMeta | null>(null)

  useEffect(() => {
    if (!assetPath) { setAsset(null); return }
    fetch(`/api/plugins/assets/?path=${encodeURIComponent(assetPath)}`)
      .then(r => r.ok ? r.json() : { assets: [] })
      .then(d => setAsset(d.assets?.[0] ?? null))
      .catch(() => setAsset(null))
  }, [assetPath])

  return (
    <AssetDetail
      asset={asset}
      onClose={onClose}
      onDelete={async (path) => {
        await fetch(`/api/plugins/assets?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
        onClose()
      }}
      showOpenInAssets
    />
  )
}

function mimeToFormat(mime: string): 'markdown' | 'yaml' | 'json' | 'text' {
  if (mime === 'text/markdown') return 'markdown'
  if (mime === 'text/yaml' || mime === 'application/yaml') return 'yaml'
  if (mime === 'application/json') return 'json'
  return 'text'
}

export function AssetDetail({ asset, onClose, onDelete, onRelink, onPathChange, showOpenInAssets }: AssetDetailProps & { showOpenInAssets?: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activeVariantPath, setActiveVariantPath] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState(false)
  const [newTaskId, setNewTaskId] = useState('')
  const [relinking, setRelinking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [contentRefreshKey, setContentRefreshKey] = useState(0)
  const [localAsset, setLocalAsset] = useState<AssetMeta | null>(null)
  const retypingRef = useRef(false)

  const displayAsset = localAsset ?? asset

  useEffect(() => {
    if (asset && localAsset && asset.path !== localAsset.path) {
      setLocalAsset(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.path])

  const handleRelink = async (taskId: string | null) => {
    if (!displayAsset) return
    setRelinking(true)
    try {
      const res = await fetch('/api/plugins/assets/link', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: displayAsset.path, taskId }),
      })
      if (res.ok) {
        setEditingTask(false)
        onRelink?.()
        onClose()
      }
    } catch { /* ignore */ }
    finally { setRelinking(false) }
  }

  const handleRetype = async (newType: string) => {
    if (!displayAsset || newType === displayAsset.type) return
    retypingRef.current = true
    setLocalAsset(displayAsset)
    try {
      const res = await fetch('/api/plugins/assets/retype', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: displayAsset.path, type: newType }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.newPath) {
          onPathChange?.(data.newPath)
          const listRes = await fetch(`/api/plugins/assets/?path=${encodeURIComponent(data.newPath)}`)
          const listData = await listRes.json()
          if (listData.assets?.[0]) setLocalAsset(listData.assets[0])
        }
        onRelink?.()
      }
    } catch { /* ignore */ }
    finally { retypingRef.current = false }
  }

  const handleStartEdit = async () => {
    if (!displayAsset) return
    const fileUrl = `/api/plugins/assets/file?path=${encodeURIComponent(displayAsset.path)}`
    const content = await fetch(fileUrl).then(r => r.text())
    setDraftContent(content)
    setEditing(true)
  }

  const handleSave = async () => {
    if (!displayAsset) return
    setSaving(true)
    try {
      const res = await fetch('/api/plugins/assets/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: displayAsset.path, content: draftContent }),
      })
      if (res.ok) {
        setEditing(false)
        setContentRefreshKey(k => k + 1)
      }
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  if (!displayAsset) return null

  // Build the asset to preview — either the primary or the active variant
  const previewAsset: AssetMeta = activeVariantPath
    ? (() => {
        const v = displayAsset.variants?.find(v => v.path === activeVariantPath)
        if (!v) return displayAsset
        return { ...displayAsset, path: v.path, filename: v.filename, size: v.size, mimeType: v.mimeType }
      })()
    : displayAsset

  const fileUrl = `/api/plugins/assets/file?path=${encodeURIComponent(displayAsset.path)}&v=${displayAsset.mtimeMs || ''}`

  return (
    <>
    <Dialog open={!!displayAsset} onOpenChange={() => { if (retypingRef.current) return; setLocalAsset(null); onClose(); setConfirmDelete(false); setActiveVariantPath(null); setEditing(false) }}>
      <DialogContent className="bg-card border-border !max-w-[calc(100vw-2rem)] !w-full h-[calc(100vh-2rem)] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span>{activeVariantPath ? `${displayAsset.filename} (${displayAsset.variants?.find(v => v.path === activeVariantPath)?.role ?? 'variant'})` : displayAsset.filename}</span>
            <Select value={displayAsset.type} onValueChange={(v) => v && handleRetype(v)}>
              <SelectTrigger size="sm" className="h-5 text-[10px] gap-1 px-1.5 py-0 border-border/50 w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeVariantPath && (
              <button
                onClick={() => setActiveVariantPath(null)}
                className="text-[10px] text-blue-400 hover:text-blue-300"
              >
                Back to original
              </button>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
          {/* Main content area */}
          <div className="flex-1 min-w-0 min-h-0 relative">
            {editing ? (
              <MarkdownEditor
                content={draftContent}
                editing={true}
                onChange={setDraftContent}
                format={mimeToFormat(previewAsset.mimeType)}
                minHeight="100%"
                className="h-full"
              />
            ) : (
              <AssetRenderer asset={previewAsset} key={contentRefreshKey} />
            )}
            {isEditableMimeType(displayAsset.mimeType) && !activeVariantPath && (
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                {editing ? (
                  <>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="size-8 rounded-full bg-green-600/90 hover:bg-green-500 text-white flex items-center justify-center transition-colors shadow-lg backdrop-blur-sm disabled:opacity-50"
                      title="Save"
                    >
                      <Check className="size-4" />
                    </button>
                    <button
                      onClick={() => setEditing(false)}
                      className="size-8 rounded-full bg-zinc-700/90 hover:bg-zinc-600 text-zinc-300 flex items-center justify-center transition-colors shadow-lg backdrop-blur-sm"
                      title="Cancel"
                    >
                      <X className="size-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleStartEdit}
                    className="size-8 rounded-full bg-zinc-700/90 hover:bg-zinc-600 text-zinc-300 hover:text-white flex items-center justify-center transition-colors shadow-lg backdrop-blur-sm"
                    title="Edit content"
                  >
                    <Pencil className="size-4" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Sidebar info */}
          <div className="lg:w-64 shrink-0 flex flex-col gap-2 text-xs overflow-y-auto overflow-x-hidden">
            {/* Agent */}
            <div className="flex items-center gap-1.5">
              <User className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Agent:</span>
              <span className="text-foreground">{displayAsset.metadata.agent}</span>
            </div>

            {/* Created */}
            <div className="flex items-center gap-1.5">
              <Clock className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Created:</span>
              <span className="text-foreground">
                {new Date(displayAsset.metadata.created).toLocaleString()}
              </span>
            </div>

            {/* Tool */}
            {displayAsset.metadata.tool && (
              <div className="flex items-center gap-1.5">
                <Wrench className="size-3 text-muted-foreground" />
                <span className="text-muted-foreground">Tool:</span>
                <span className="text-foreground">{displayAsset.metadata.tool}</span>
              </div>
            )}

            {/* Task link */}
            <div className="flex items-center gap-1.5">
              <ExternalLink className="size-3 text-muted-foreground" />
              <span className="text-muted-foreground">Task:</span>
              {editingTask ? (
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <input
                    type="text"
                    value={newTaskId}
                    onChange={(e) => setNewTaskId(e.target.value)}
                    placeholder="Task ID or empty to unlink"
                    className="flex-1 min-w-0 text-xs bg-zinc-800 border border-border rounded px-1.5 py-0.5 text-foreground"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRelink(newTaskId.trim() || null)
                      if (e.key === 'Escape') setEditingTask(false)
                    }}
                    disabled={relinking}
                  />
                  <button onClick={() => handleRelink(newTaskId.trim() || null)} disabled={relinking} className="text-green-400 hover:text-green-300" title="Save">
                    <Check className="size-3" />
                  </button>
                  <button onClick={() => setEditingTask(false)} className="text-muted-foreground hover:text-foreground" title="Cancel">
                    <X className="size-3" />
                  </button>
                </div>
              ) : displayAsset.metadata.taskId ? (
                <>
                  <a
                    href={`/tasks?taskId=${displayAsset.metadata.taskId}`}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    {displayAsset.metadata.taskId.slice(0, 8)}...
                  </a>
                  <button onClick={() => { setNewTaskId(displayAsset.metadata.taskId || ''); setEditingTask(true) }} className="text-muted-foreground hover:text-foreground" title="Edit task link">
                    <Pencil className="size-3" />
                  </button>
                  <button onClick={() => handleRelink(null)} className="text-muted-foreground hover:text-red-400" title="Unlink from task">
                    <Unlink className="size-3" />
                  </button>
                </>
              ) : (
                <>
                  <span className="text-muted-foreground italic">Unlinked</span>
                  <button onClick={() => { setNewTaskId(''); setEditingTask(true) }} className="text-muted-foreground hover:text-foreground" title="Link to task">
                    <Pencil className="size-3" />
                  </button>
                </>
              )}
            </div>

            {/* Size */}
            <div className="text-muted-foreground">
              {formatSize(displayAsset.size)} &middot; {displayAsset.mimeType}
            </div>

            {/* Tags */}
            {displayAsset.metadata.tags && displayAsset.metadata.tags.length > 0 && (
              <div>
                <div className="flex items-center gap-1 mb-1.5">
                  <Tag className="size-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Tags</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {displayAsset.metadata.tags.map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Variants */}
            {displayAsset.variants && displayAsset.variants.length > 0 && (
              <div className="border-t border-border pt-3 mt-1">
                <div className="flex items-center gap-1 mb-1.5">
                  <Layers className="size-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Variants</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {displayAsset.variants.map(v => (
                    <div key={v.path} className={`flex items-center justify-between text-xs rounded-md px-1.5 py-1 -mx-1.5 transition-colors ${activeVariantPath === v.path ? 'bg-accent/10' : 'hover:bg-muted/30'}`}>
                      <button
                        onClick={() => setActiveVariantPath(activeVariantPath === v.path ? null : v.path)}
                        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground capitalize"
                      >
                        <Eye className="size-3" />
                        {v.role}
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{formatSize(v.size)}</span>
                        <a
                          href={`/api/plugins/assets/file?path=${encodeURIComponent(v.path)}`}
                          download={v.filename}
                          className="text-blue-400 hover:text-blue-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Download className="size-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            {displayAsset.metadata.description && (
              <div className="text-xs text-muted-foreground border-t border-border pt-3 mt-1">
                {displayAsset.metadata.description}
              </div>
            )}

            {/* Actions */}
            <div className="border-t border-border pt-3 mt-auto flex flex-col gap-2">
              {showOpenInAssets && (
                <a
                  href={`/assets?asset=${encodeURIComponent(displayAsset.path)}`}
                  className="flex items-center justify-center gap-1.5 text-xs text-foreground bg-zinc-800 hover:bg-zinc-700 rounded-md px-3 py-1.5 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  View in Assets
                </a>
              )}

              <a
                href={fileUrl}
                download={displayAsset.filename}
                className="flex items-center justify-center gap-1.5 text-xs text-foreground bg-zinc-800 hover:bg-zinc-700 rounded-md px-3 py-1.5 transition-colors"
              >
                <Download className="size-3.5" />
                Download
              </a>

              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 rounded-md px-3 py-1.5 transition-colors"
              >
                <Trash2 className="size-3.5" />
                Delete
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <DeleteAssetDialog
      open={confirmDelete}
      filename={displayAsset.filename}
      onConfirm={() => { setConfirmDelete(false); onDelete(displayAsset.path) }}
      onCancel={() => setConfirmDelete(false)}
    />
    </>
  )
}
