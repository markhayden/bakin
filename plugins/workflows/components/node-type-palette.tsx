'use client'

/**
 * Node-type palette sidebar for the canvas editor.
 *
 * Lists builtin + plugin-registered node types and supports dragging
 * entries onto the canvas to add a new step. Data source is the
 * workflows plugin's `GET /node-types` route — the server owns the
 * registry, the client just hydrates.
 */

import { useEffect, useState, type DragEvent } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardPlus,
  GitBranch,
  Layers,
  Puzzle,
  Radio,
  UserRound,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from 'lucide-react'
import type { FormField, EdgeRules } from '@bakin/core/workflows/node-type-registry'

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
  /** Node kinds that cannot currently be added to the workflow. */
  disabledKinds?: ReadonlySet<string>
  /** Optional pre-seeded types (tests bypass the fetch). */
  initialNodeTypes?: PaletteNodeType[]
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

const DRAG_MIME_TYPE = 'application/x-bakin-node-kind'

const BUILTIN_DISPLAY: Record<string, {
  label: string
  description: string
  icon: LucideIcon
  toneClass: string
}> = {
  agent: {
    label: 'Agent Task',
    description: 'Assign a unit of work to the task agent or a specific agent.',
    icon: UserRound,
    toneClass: 'bg-emerald-500/10 text-emerald-300',
  },
  gate: {
    label: 'Approval Gate',
    description: 'Pause the workflow until a person approves or rejects.',
    icon: CheckCircle2,
    toneClass: 'bg-amber-500/10 text-amber-300',
  },
  parallel: {
    label: 'Parallel Group',
    description: 'Run a grouped set of child steps at the same time.',
    icon: GitBranch,
    toneClass: 'bg-blue-500/10 text-blue-300',
  },
  output: {
    label: 'Completion',
    description: 'Finish the workflow by publishing, handing off, or recording results.',
    icon: Radio,
    toneClass: 'bg-violet-500/10 text-violet-300',
  },
  workflow: {
    label: 'Nested Workflow',
    description: 'Run another workflow as a step in this one.',
    icon: WorkflowIcon,
    toneClass: 'bg-zinc-700/60 text-zinc-300',
  },
  map_workflow: {
    label: 'Map Fan-out',
    description: "Run a child workflow per element of an earlier step's output array.",
    icon: Layers,
    toneClass: 'bg-violet-500/10 text-violet-300',
  },
  createTask: {
    label: 'Create Task',
    description: 'Create a follow-up task from workflow context.',
    icon: ClipboardPlus,
    toneClass: 'bg-sky-500/10 text-sky-300',
  },
}

function setPaletteDragImage(event: DragEvent<HTMLElement>, label: string) {
  const ghost = document.createElement('div')
  ghost.textContent = label
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.pointerEvents = 'none'
  ghost.style.border = '1px solid rgba(96, 165, 250, 0.65)'
  ghost.style.borderRadius = '6px'
  ghost.style.background = 'rgb(24, 24, 27)'
  ghost.style.color = 'rgb(229, 231, 235)'
  ghost.style.font = '12px system-ui, sans-serif'
  ghost.style.padding = '4px 8px'
  ghost.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.35)'
  document.body.appendChild(ghost)
  if (typeof event.dataTransfer.setDragImage === 'function') {
    try {
      event.dataTransfer.setDragImage(ghost, 12, 12)
    } catch {
      // happy-dom does not implement setDragImage; browsers do.
    }
  }
  requestAnimationFrame(() => ghost.remove())
}

export function NodeTypePalette({
  onDragKind,
  disabledKinds,
  initialNodeTypes,
  collapsed: controlledCollapsed,
  onCollapsedChange,
}: NodeTypePaletteProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const [nodeTypes, setNodeTypes] = useState<PaletteNodeType[]>(initialNodeTypes ?? [])
  const [loading, setLoading] = useState(!initialNodeTypes)
  const [error, setError] = useState<string | null>(null)
  const collapsed = controlledCollapsed ?? internalCollapsed
  const setCollapsed = onCollapsedChange ?? setInternalCollapsed

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
          Step Types
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
          <PaletteGroup
            title="Builtin"
            items={builtins}
            disabledKinds={disabledKinds}
            onDragKind={onDragKind}
          />
        )}
        {!loading && plugins.length > 0 && (
          <PaletteGroup
            title="Plugins"
            items={plugins}
            disabledKinds={disabledKinds}
            onDragKind={onDragKind}
          />
        )}
        {!loading && !error && nodeTypes.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">No step types registered.</p>
        )}
      </div>
    </aside>
  )
}

function PaletteGroup({
  title,
  items,
  disabledKinds,
  onDragKind,
}: {
  title: string
  items: PaletteNodeType[]
  disabledKinds?: ReadonlySet<string>
  onDragKind?: (kind: string) => void
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <PaletteItem
            key={item.kind}
            item={item}
            disabled={disabledKinds?.has(item.kind) ?? false}
            onDragKind={onDragKind}
          />
        ))}
      </ul>
    </div>
  )
}

function PaletteItem({
  item,
  disabled = false,
  onDragKind,
}: {
  item: PaletteNodeType
  disabled?: boolean
  onDragKind?: (kind: string) => void
}) {
  const builtinDisplay = item.runtime === 'builtin' ? BUILTIN_DISPLAY[item.kind] : undefined
  const displayKind = builtinDisplay?.label ?? (item.runtime === 'plugin' ? item.kind.split('.').slice(1).join('.') : item.kind)
  const description = disabled && item.kind === 'output'
    ? 'This workflow already has a completion step.'
    : item.runtime === 'builtin'
      ? builtinDisplay?.description ?? 'Add this built-in workflow step.'
      : `Provided by ${item.pluginId ?? 'a plugin'}.`
  const Icon = builtinDisplay?.icon ?? Puzzle
  const iconTone = builtinDisplay?.toneClass ?? 'bg-muted text-muted-foreground'
  return (
    <li
      draggable={!disabled}
      aria-disabled={disabled || undefined}
      data-kind={item.kind}
      onDragStart={(e) => {
        if (disabled) {
          e.preventDefault()
          return
        }
        e.dataTransfer.setData(DRAG_MIME_TYPE, item.kind)
        e.dataTransfer.setData('text/plain', item.kind)
        e.dataTransfer.effectAllowed = 'copy'
        setPaletteDragImage(e, displayKind)
        onDragKind?.(item.kind)
      }}
      className={`group flex flex-col gap-1 rounded border border-border bg-background px-2 py-2 text-xs ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-grab hover:border-primary/50 active:cursor-grabbing'
      }`}
    >
      <span className="flex w-full items-center gap-2">
        <span
          aria-hidden="true"
          className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md ${iconTone}`}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{displayKind}</span>
        {item.pluginId && (
          <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
            {item.pluginId}
          </span>
        )}
      </span>
      <span className="line-clamp-2 w-full text-[11px] leading-snug text-muted-foreground">
        {description}
      </span>
    </li>
  )
}

export const PALETTE_DRAG_MIME_TYPE = DRAG_MIME_TYPE
