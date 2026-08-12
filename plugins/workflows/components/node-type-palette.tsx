'use client'

/**
 * Node-type palette sidebar for the canvas editor.
 *
 * Lists builtin + plugin-registered node types and supports dragging
 * entries onto the canvas to add a new step. Data source is the
 * workflows plugin's `GET /node-types` route — the server owns the
 * registry, the client just hydrates.
 */

import { useState, type DragEvent } from 'react'
import { usePluginJsonFetch } from '@makinbakin/sdk/hooks'
import { Button, SystemState } from '@makinbakin/sdk/ui'
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
import type { FormField, EdgeRules } from '../lib/node-config-fields'

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
    toneClass: 'bg-bakin-action-primary-background/10 text-bakin-action-primary-background',
  },
  gate: {
    label: 'Approval Gate',
    description: 'Pause the workflow until a person approves or rejects.',
    icon: CheckCircle2,
    toneClass: 'bg-bakin-signal-highlight/10 text-bakin-signal-highlight',
  },
  parallel: {
    label: 'Parallel Group',
    description: 'Run a grouped set of child steps at the same time.',
    icon: GitBranch,
    toneClass: 'bg-bakin-signal-info/10 text-bakin-signal-info',
  },
  output: {
    label: 'Completion',
    description: 'Finish the workflow by publishing, handing off, or recording results.',
    icon: Radio,
    toneClass: 'bg-bakin-signal-accent/10 text-bakin-signal-accent',
  },
  workflow: {
    label: 'Nested Workflow',
    description: 'Run another workflow as a step in this one.',
    icon: WorkflowIcon,
    toneClass: 'bg-bakin-signal-info/10 text-bakin-signal-info',
  },
  map_workflow: {
    label: 'Map Fan-out',
    description: "Run a child workflow per element of an earlier step's output array.",
    icon: Layers,
    toneClass: 'bg-bakin-signal-accent/10 text-bakin-signal-accent',
  },
  createTask: {
    label: 'Create Task',
    description: 'Create a follow-up task from workflow context.',
    icon: ClipboardPlus,
    toneClass: 'bg-bakin-signal-info/10 text-bakin-signal-info',
  },
}

function setPaletteDragImage(event: DragEvent<HTMLElement>, label: string) {
  const ghost = document.createElement('div')
  ghost.textContent = label
  ghost.style.position = 'fixed'
  ghost.style.top = '-1000px'
  ghost.style.left = '-1000px'
  ghost.style.pointerEvents = 'none'
  ghost.style.border = '1px solid var(--bakin-color-signal-info)'
  ghost.style.borderRadius = 'var(--bakin-radius-control)'
  ghost.style.background = 'var(--bakin-color-surface-default)'
  ghost.style.color = 'var(--bakin-color-text-primary)'
  ghost.style.font = `var(--bakin-typography-size-meta) var(--bakin-typography-family-ui, system-ui, sans-serif)`
  ghost.style.padding = 'var(--bakin-layout-space-1) var(--bakin-layout-space-2)'
  ghost.style.boxShadow = 'var(--bakin-elevation-overlay)'
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
  const collapsed = controlledCollapsed ?? internalCollapsed
  const setCollapsed = onCollapsedChange ?? setInternalCollapsed

  // Tests pre-seed via initialNodeTypes (null url skips the fetch entirely).
  const fetched = usePluginJsonFetch<{ nodeTypes: PaletteNodeType[] }>(
    'workflows',
    initialNodeTypes ? null : 'node-types',
  )
  const nodeTypes = initialNodeTypes ?? fetched.data?.nodeTypes ?? []
  const loading = fetched.loading
  const error = fetched.error

  if (collapsed) {
    return (
      <aside className="flex w-10 flex-col items-center border-r border-bakin-border-subtle bg-bakin-surface-default py-bakin-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Expand palette"
          onClick={() => setCollapsed(false)}
        >
          <ChevronRight aria-hidden="true" className="size-bakin-4" />
        </Button>
      </aside>
    )
  }

  const builtins = nodeTypes.filter((n) => n.runtime === 'builtin')
  const plugins = nodeTypes.filter((n) => n.runtime === 'plugin')

  return (
    <aside className="flex w-56 flex-col border-r border-bakin-border-subtle bg-bakin-surface-default">
      <div className="flex items-center justify-between border-b border-bakin-border-subtle px-bakin-3 py-bakin-2">
        <span className="text-bakin-typography-size-meta font-bakin-typography-weight-medium uppercase tracking-wide text-bakin-text-muted">
          Step Types
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse palette"
          onClick={() => setCollapsed(true)}
        >
          <ChevronLeft aria-hidden="true" className="size-bakin-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-bakin-2">
        {loading && (
          <SystemState
            kind="loading"
            scope="inline"
            title="Loading step types"
            description="Registered node types are on their way."
          />
        )}
        {error && (
          <SystemState
            kind="error"
            recovery="unavailable"
            scope="inline"
            title="Step types unavailable"
            description={error}
          />
        )}

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
          <SystemState
            kind="initial-empty"
            scope="inline"
            title="No step types registered"
            description="Step types appear when their providing plugin is active."
          />
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
      <div className="mb-1 px-1 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
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
  const iconTone = builtinDisplay?.toneClass ?? 'bg-bakin-canvas-default text-bakin-text-muted'
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
      className={`group flex flex-col gap-bakin-1 rounded-bakin-control border border-bakin-border-subtle bg-bakin-canvas-default px-bakin-2 py-bakin-2 text-bakin-typography-size-meta ${
        disabled
          ? 'cursor-not-allowed text-bakin-text-muted [&_[aria-hidden=true]]:opacity-60'
          : 'cursor-grab hover:border-bakin-focus-ring/50 active:cursor-grabbing'
      }`}
    >
      <span className="flex w-full items-center gap-bakin-2">
        <span
          aria-hidden="true"
          className={`inline-flex size-bakin-6 shrink-0 items-center justify-center rounded-bakin-control ${iconTone}`}
        >
          <Icon className="size-bakin-3" />
        </span>
        <span className="min-w-0 flex-1 truncate font-bakin-typography-weight-medium">{displayKind}</span>
        {item.pluginId && (
          <span className="rounded-bakin-control bg-bakin-surface-default px-bakin-1 py-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">
            {item.pluginId}
          </span>
        )}
      </span>
      <span className="line-clamp-2 w-full text-bakin-typography-size-meta leading-snug text-bakin-text-muted">
        {description}
      </span>
    </li>
  )
}

export const PALETTE_DRAG_MIME_TYPE = DRAG_MIME_TYPE
