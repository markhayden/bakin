'use client'

import { useMemo, useState } from 'react'
import {
  Badge, Button, Input,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@makinbakin/sdk/ui'
import { ConfirmDialog } from '@makinbakin/sdk/components'
import { FolderOpen, MoreVertical, Pencil, Trash2, Loader2 } from 'lucide-react'
import { AssetThumb } from './atoms'
import { TAGS_API } from './asset-urls'
import { UNTAGGED } from './tag-filter'
import type { VersionedAssetSummary } from './types'

interface Folder {
  tag: string
  label: string
  assets: VersionedAssetSummary[] // newest-updated first
}

/** Group summaries into tag folders: Untagged pinned, rest by recency. */
function buildFolders(assets: VersionedAssetSummary[]): Folder[] {
  const byTag = new Map<string, VersionedAssetSummary[]>()
  const untagged: VersionedAssetSummary[] = []
  for (const a of assets) {
    if ((a.tags ?? []).length === 0) untagged.push(a)
    for (const t of a.tags ?? []) {
      const list = byTag.get(t) ?? []
      list.push(a)
      byTag.set(t, list)
    }
  }
  const newestFirst = (list: VersionedAssetSummary[]) => [...list].sort((x, y) => y.updated.localeCompare(x.updated))
  const folders: Folder[] = [...byTag.entries()]
    .map(([tag, list]) => ({ tag, label: tag, assets: newestFirst(list) }))
    .sort((x, y) => y.assets[0].updated.localeCompare(x.assets[0].updated))
  if (untagged.length > 0) folders.unshift({ tag: UNTAGGED, label: 'Untagged', assets: newestFirst(untagged) })
  return folders
}

function FolderCard({ folder, onOpen, onRename, onDelete }: {
  folder: Folder
  onOpen: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const thumbs = folder.assets.slice(0, 4)
  const real = folder.tag !== UNTAGGED
  return (
    <div
      onClick={onOpen}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-card transition-all duration-150 hover:-translate-y-0.5 hover:border-[rgba(255,255,255,0.15)]"
      data-testid={`tag-folder-${folder.tag}`}
    >
      <div className="relative grid aspect-square grid-cols-2 grid-rows-2 gap-px overflow-hidden bg-zinc-900/50">
        {thumbs.map(a => (
          <div key={a.assetId} className="overflow-hidden">
            <AssetThumb assetId={a.assetId} type={a.type} version={a.currentVersion} hasThumb={a.hasThumb} />
          </div>
        ))}
        {/* Pad the collage so a 1–3 asset folder still reads as a 2x2 grid. */}
        {Array.from({ length: Math.max(0, 4 - thumbs.length) }, (_, i) => (
          <div key={`pad-${i}`} className="bg-zinc-900/30" />
        ))}
        {real && (
          <DropdownMenu>
            <DropdownMenuTrigger
              onClick={(e) => e.stopPropagation()}
              className="absolute right-1.5 top-1.5 z-10 rounded bg-black/60 p-1.5 text-zinc-300 opacity-0 transition-opacity hover:text-white group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={`Folder actions for ${folder.label}`}
              data-testid={`folder-menu-${folder.tag}`}
            >
              <MoreVertical className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onRename} data-testid={`folder-rename-${folder.tag}`}>
                <Pencil className="size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} variant="danger" data-testid={`folder-delete-${folder.tag}`}>
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex items-center gap-2 p-3">
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground" title={folder.label}>{folder.label}</span>
        <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]" data-testid={`folder-count-${folder.tag}`}>
          {folder.assets.length}
        </Badge>
      </div>
    </div>
  )
}

/**
 * Folders view — assets grouped by tag (multi-tag assets appear in every
 * matching folder). Untagged is pinned first; real folders sort by their
 * most-recently-updated asset. Rename/Delete fan out via the global tag
 * routes; the SSE refetch reconciles the grid.
 */
export function TagFolderGrid({ assets, filter = '', onOpenFolder, onChanged }: {
  assets: VersionedAssetSummary[]
  /** Lowercased folder-name filter from the header search box. */
  filter?: string
  onOpenFolder: (tag: string) => void
  onChanged: () => void
}) {
  const folders = useMemo(() => {
    const all = buildFolders(assets)
    return filter ? all.filter(f => f.label.toLowerCase().includes(filter)) : all
  }, [assets, filter])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (path: string, body: unknown, close: () => void) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${TAGS_API}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || `Request failed (${res.status})`)
      }
      close()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  if (folders.length === 0) {
    return (
      <div className="p-8 text-sm text-muted-foreground" data-testid="folders-empty">
        {filter ? 'No folders match your filter.' : 'No assets yet — tags you add will appear here as folders.'}
      </div>
    )
  }

  return (
    <>
      {/* mt-4: the grid/list views get header spacing from the filters row,
          which the folders view doesn't render. */}
      <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]" data-testid="tag-folders">
        {folders.map(folder => (
          <FolderCard
            key={folder.tag}
            folder={folder}
            onOpen={() => onOpenFolder(folder.tag)}
            onRename={() => { setRenameTo(folder.tag); setError(null); setRenaming(folder.tag) }}
            onDelete={() => { setError(null); setDeleting(folder.tag) }}
          />
        ))}
      </div>

      {/* Rename dialog */}
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename tag</DialogTitle>
            <DialogDescription>Renames “{renaming}” on every asset that carries it. Merges if the target tag already exists.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && renaming) run('/rename', { from: renaming, to: renameTo }, () => setRenaming(null)) }}
            autoFocus
            data-testid="folder-rename-input"
          />
          {error && renaming !== null && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button
              onClick={() => renaming && run('/rename', { from: renaming, to: renameTo }, () => setRenaming(null))}
              disabled={busy || !renameTo.trim() || renameTo.trim() === renaming}
              data-testid="folder-rename-confirm"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null} Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <ConfirmDialog
        open={deleting !== null}
        busy={busy}
        title="Delete tag"
        description={<>Removes “{deleting}” from every asset that carries it. The assets themselves are untouched.</>}
        error={error}
        confirmLabel="Delete tag"
        cancelVariant="ghost"
        confirmTestId="folder-delete-confirm"
        onConfirm={() => deleting && run('/remove', { tag: deleting }, () => setDeleting(null))}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
