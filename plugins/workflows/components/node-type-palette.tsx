'use client'

/**
 * Node-type palette sidebar for the canvas editor.
 *
 * Lists builtin + plugin-registered node types and supports dragging
 * entries onto the canvas to add a new step. Data source is the
 * workflows plugin's `GET /node-types` route — the server owns the
 * registry, the client just hydrates.
 */

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Puzzle } from 'lucide-react'
import type { FormField, EdgeRules } from '../lib/node-type-registry'

export interface PaletteNodeType {
  kind: string
  runtime: 'builtin' | 'plugin'
  pluginId?: string
  edgeRules?: EdgeRules
  formFields: FormField[]
}

interface NodeTypePaletteProps {
  /** Called when an item begins drag. Consumers forward to the canvas's onDrop. */
  onDragKind?: (kind: string) => void
  /** Optional pre-seeded types (tests bypass the fetch). */
  initialNodeTypes?: PaletteNodeType[]
}

const DRAG_MIME_TYPE = 'application/x-bakin-node-kind'

export function NodeTypePalette({ onDragKind, initialNodeTypes }: NodeTypePaletteProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [nodeTypes, setNodeTypes] = useState<PaletteNodeType[]>(initialNodeTypes ?? [])
  const [loading, setLoading] = useState(!initialNodeTypes)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialNodeTypes) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/plugins/workflows/node-types')
        if (!res.ok) {
          if (!cancelled) setError(`Failed to load palette (${res.status})`)
          return
        }
        const data = (await res.json()) as { nodeTypes: PaletteNodeType[] }
        if (!cancelled) setNodeTypes(data.nodeTypes)
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [initialNodeTypes])

  if (collapsed) {
    return (
      <aside className="flex w-10 flex-col items-center border-r border-border bg-card py-2">
        <button
          type="button"
          aria-label="Expand palette"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight className="size-4" />
        </button>
      </aside>
    )
  }

  const builtins = nodeTypes.filter((n) => n.runtime === 'builtin')
  const plugins = nodeTypes.filter((n) => n.runtime === 'plugin')

  return (
    <aside className="flex w-56 flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Node types
        </span>
        <button
          type="button"
          aria-label="Collapse palette"
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => setCollapsed(true)}
        >
          <ChevronLeft className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && <p className="p-2 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="p-2 text-xs text-red-300">{error}</p>}

        {!loading && builtins.length > 0 && (
          <PaletteGroup title="Builtin" items={builtins} onDragKind={onDragKind} />
        )}
        {!loading && plugins.length > 0 && (
          <PaletteGroup title="Plugins" items={plugins} onDragKind={onDragKind} />
        )}
        {!loading && !error && nodeTypes.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">No node types registered.</p>
        )}
      </div>
    </aside>
  )
}

function PaletteGroup({
  title,
  items,
  onDragKind,
}: {
  title: string
  items: PaletteNodeType[]
  onDragKind?: (kind: string) => void
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <PaletteItem key={item.kind} item={item} onDragKind={onDragKind} />
        ))}
      </ul>
    </div>
  )
}

function PaletteItem({
  item,
  onDragKind,
}: {
  item: PaletteNodeType
  onDragKind?: (kind: string) => void
}) {
  const displayKind = item.runtime === 'plugin' ? item.kind.split('.').slice(1).join('.') : item.kind
  return (
    <li
      draggable
      data-kind={item.kind}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME_TYPE, item.kind)
        e.dataTransfer.setData('text/plain', item.kind)
        e.dataTransfer.effectAllowed = 'copy'
        onDragKind?.(item.kind)
      }}
      className="group flex cursor-grab items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-xs hover:border-primary/50 active:cursor-grabbing"
    >
      {item.runtime === 'plugin' && <Puzzle className="size-3 shrink-0 text-muted-foreground" />}
      <span className="flex-1 truncate">{displayKind}</span>
      {item.pluginId && (
        <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
          {item.pluginId}
        </span>
      )}
    </li>
  )
}

export const PALETTE_DRAG_MIME_TYPE = DRAG_MIME_TYPE
