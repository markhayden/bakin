'use client'

import { memo, useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CollisionPriority } from '@dnd-kit/abstract'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/dom'
import { move } from '@dnd-kit/helpers'
import { DragDropProvider, type DragDropEventHandlers } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'

type DebugColumnId = 'backlog' | 'todo' | 'inProgress'

type DebugTask = {
  id: string
  title: string
  description?: string
  column: DebugColumnId
}

const COLUMN_ORDER: DebugColumnId[] = ['backlog', 'todo', 'inProgress']

const COLUMN_META: Record<DebugColumnId, { label: string; accent: string; ring: string }> = {
  backlog: { label: 'Backlog', accent: '#64748b', ring: 'ring-slate-500/20' },
  todo: { label: 'Todo', accent: '#8b5cf6', ring: 'ring-violet-500/20' },
  inProgress: { label: 'In Progress', accent: '#3b82f6', ring: 'ring-blue-500/20' },
}

const TASKS: Record<string, DebugTask> = {
  'dbg-b-1': {
    id: 'dbg-b-1',
    title: 'Backlog One',
    description: 'Longer task body to match real card height and create a realistic collision surface.',
    column: 'backlog',
  },
  'dbg-b-2': {
    id: 'dbg-b-2',
    title: 'Backlog Two',
    description: 'Another multiline card with a second sentence.',
    column: 'backlog',
  },
  'dbg-b-3': {
    id: 'dbg-b-3',
    title: 'Backlog Three',
    column: 'backlog',
  },
  'dbg-t-1': {
    id: 'dbg-t-1',
    title: 'Todo One',
    description: 'This card is intentionally a different height.',
    column: 'todo',
  },
  'dbg-t-2': {
    id: 'dbg-t-2',
    title: 'Todo Two',
    column: 'todo',
  },
  'dbg-t-3': {
    id: 'dbg-t-3',
    title: 'Todo Three',
    description: 'Another different height card.',
    column: 'todo',
  },
  'dbg-i-1': {
    id: 'dbg-i-1',
    title: 'In Progress One',
    column: 'inProgress',
  },
  'dbg-i-2': {
    id: 'dbg-i-2',
    title: 'In Progress Two',
    description: 'Variable height again.',
    column: 'inProgress',
  },
}

const INITIAL_ITEMS: Record<DebugColumnId, string[]> = {
  backlog: ['dbg-b-1', 'dbg-b-2', 'dbg-b-3'],
  todo: ['dbg-t-1', 'dbg-t-2', 'dbg-t-3'],
  inProgress: ['dbg-i-1', 'dbg-i-2'],
}

const sensors = [
  PointerSensor.configure({
    activatorElements(source) {
      return [source.element, source.handle]
    },
  }),
  KeyboardSensor,
]

interface SortableTaskCardProps {
  id: string
  column: DebugColumnId
  index: number
}

const SortableTaskCard = memo(function SortableTaskCard({ id, column, index }: SortableTaskCardProps) {
  const task = TASKS[id]
  const { handleRef, ref, isDragging } = useSortable({
    id,
    group: column,
    accept: 'item',
    type: 'item',
    feedback: 'clone',
    index,
    data: { group: column },
  })

  return (
    <article
      ref={ref as never}
      style={
        {
          borderColor: isDragging ? 'var(--accent)' : 'color-mix(in oklab, var(--border) 80%, white 20%)',
          boxShadow: isDragging
            ? '0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent), 0 24px 48px rgba(0, 0, 0, 0.35)'
            : undefined,
          '--debug-accent': COLUMN_META[column].accent,
        } as CSSProperties
      }
      className={`rounded-xl border bg-card p-4 shadow-sm transition-shadow select-none ${
        isDragging ? 'shadow-xl ring-1 ring-[var(--accent)]/30' : 'shadow-black/20'
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white/90"
            style={{ backgroundColor: 'var(--debug-accent)' }}
          >
            {COLUMN_META[column].label}
          </span>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
            {id}
          </span>
        </div>
        <button
          ref={handleRef as never}
          type="button"
          aria-label={`Drag ${task.title}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-background/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-grab active:cursor-grabbing"
        >
          <span className="text-sm leading-none">::</span>
        </button>
      </div>

      <h3 className="text-sm font-semibold text-foreground">{task.title}</h3>
      {task.description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{task.description}</p>
      ) : null}
    </article>
  )
})

interface SortableColumnProps {
  id: DebugColumnId
  index: number
  rows: string[]
}

const SortableColumn = memo(function SortableColumn({ id, index, rows }: SortableColumnProps) {
  const { handleRef, isDragging, ref } = useSortable({
    id,
    accept: ['column', 'item'],
    collisionPriority: CollisionPriority.Low,
    type: 'column',
    index,
  })

  const meta = COLUMN_META[id]

  return (
    <section
      ref={ref as never}
      className={`flex w-[75vw] shrink-0 flex-col rounded-2xl border bg-surface p-3 sm:w-80 ${
        isDragging ? 'shadow-xl ring-1 ring-sky-500/20' : 'shadow-sm'
      }`}
      style={{ borderColor: 'color-mix(in oklab, var(--border) 85%, white 15%)' }}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.accent }} />
          <span className="text-sm font-medium text-foreground">{meta.label}</span>
          <span className={`rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-mono text-muted-foreground ${meta.ring}`}>
            {rows.length}
          </span>
        </div>
        <button
          ref={handleRef as never}
          type="button"
          aria-label={`Drag ${meta.label} column`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-background/50 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <span className="text-sm leading-none">::</span>
        </button>
      </header>

      <div className="flex min-h-[260px] flex-col gap-2">
        {rows.map((itemId, itemIndex) => (
          <SortableTaskCard key={itemId} id={itemId} column={id} index={itemIndex} />
        ))}
      </div>
    </section>
  )
})

export function TaskDndDebug() {
  const [items, setItems] = useState(INITIAL_ITEMS)
  const snapshot = useRef(structuredClone(INITIAL_ITEMS))
  const [debug, setDebug] = useState<Record<string, unknown> | null>(null)
  const columns = useMemo(() => COLUMN_ORDER, [])

  const handleDragStart = useCallback<DragDropEventHandlers['onDragStart']>((event) => {
    snapshot.current = structuredClone(items)
    setDebug({
      phase: 'drag-start',
      source: event.operation.source
        ? {
            id: String(event.operation.source.id),
            type: event.operation.source.type,
            group: event.operation.source.data.group,
          }
        : null,
      target: null,
      items,
    })
  }, [items])

  const handleDragOver = useCallback<DragDropEventHandlers['onDragOver']>((event) => {
    const { source, target } = event.operation

    if (!source || source.type === 'column') {
      return
    }

    setItems((current) => move(current, event))
    setDebug({
      phase: 'drag-over',
      source: source
        ? {
            id: String(source.id),
            type: source.type,
            group: source.data.group,
          }
        : null,
      target: target
        ? {
            id: String(target.id),
            type: target.type,
            group: target.data.group,
          }
        : null,
    })
  }, [])

  const handleDragEnd = useCallback<DragDropEventHandlers['onDragEnd']>((event) => {
    const { source, target } = event.operation

    if (event.canceled) {
      if (source?.type === 'item') {
        setItems(snapshot.current)
      }

      setDebug({
        phase: 'drag-cancel',
        source: source ? { id: String(source.id), type: source.type, group: source.data.group } : null,
        target: target ? { id: String(target.id), type: target.type, group: target.data.group } : null,
        items: snapshot.current,
      })
      return
    }

    setDebug({
      phase: 'drag-end',
      source: source ? { id: String(source.id), type: source.type, group: source.data.group } : null,
      target: target ? { id: String(target.id), type: target.type, group: target.data.group } : null,
      items,
    })
  }, [items])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="border-b border-border/50 px-6 py-5">
        <h1 className="text-lg font-semibold">Task DnD Debug</h1>
        <p className="text-sm text-muted-foreground">
          Exact upgraded multi-list pattern first. No backend writes and no production board logic.
        </p>
      </div>

      <div className="flex-1 overflow-auto">
        <DragDropProvider
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex items-start gap-4 p-6">
            {columns.map((columnId, columnIndex) => (
              <SortableColumn
                key={columnId}
                id={columnId}
                index={columnIndex}
                rows={items[columnId]}
              />
            ))}
          </div>
        </DragDropProvider>

        <div className="border-t border-border/50 px-6 py-4">
          <details className="rounded-lg border border-border/70 bg-muted/20">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground">
              Debug state
            </summary>
            <div className="border-t border-border/50 px-4 py-3">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {JSON.stringify(debug, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
