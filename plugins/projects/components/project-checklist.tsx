'use client'

import { useState } from 'react'
import { Plus, ExternalLink, Unlink, Trash2, Link2, ChevronRight } from 'lucide-react'
import type { ProjectTask } from '../types'

const COLUMN_COLORS: Record<string, string> = {
  backlog: 'bg-zinc-500/20 text-zinc-400',
  todo: 'bg-zinc-500/20 text-zinc-300',
  inProgress: 'bg-blue-500/20 text-blue-400',
  review: 'bg-amber-500/20 text-amber-400',
  done: 'bg-emerald-500/20 text-emerald-400',
  archived: 'bg-purple-500/20 text-purple-400',
  blocked: 'bg-red-500/20 text-red-400',
}

interface ResolvedTasks {
  [taskId: string]: { column: string; title: string } | null
}

interface ChecklistProps {
  projectId: string
  tasks: ProjectTask[]
  resolvedTasks: ResolvedTasks
  onToggle: (taskItemId: string, checked: boolean) => void
  onAdd: (title: string) => void
  onRemove: (taskItemId: string) => void
  onPromote: (taskItemId: string) => void
}

function TaskItem({
  item,
  resolved,
  isStale,
  onToggle,
  onRemove,
  onPromote,
  onUpdate,
}: {
  item: ProjectTask
  resolved: { column: string; title: string } | null
  isStale: boolean
  onToggle: (checked: boolean) => void
  onRemove: () => void
  onPromote: () => void
  onUpdate: (updates: { title?: string; description?: string }) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState(item.description || '')

  const saveDesc = () => {
    onUpdate({ description: descDraft.trim() })
    setEditingDesc(false)
  }

  return (
    <div className="rounded-lg hover:bg-[rgba(255,255,255,0.02)] transition-colors">
      {/* Main row */}
      <div className="flex items-start gap-2 group py-1.5 px-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-zinc-600 hover:text-zinc-400 transition-colors shrink-0 mt-0.5"
        >
          <ChevronRight className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>

        <input
          type="checkbox"
          checked={item.checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/30 shrink-0 mt-0.5"
        />

        <span
          onClick={() => setExpanded(!expanded)}
          className={`text-[11px] flex-1 cursor-pointer leading-snug ${item.checked ? 'line-through text-zinc-600' : 'text-foreground'}`}
        >
          {item.title}
        </span>

        {/* Linked task badge */}
        {item.taskId && resolved && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${COLUMN_COLORS[resolved.column] || 'bg-zinc-500/20 text-zinc-400'}`}>
            <ExternalLink className="size-2.5" />
            {item.taskId.slice(0, 6)}
          </span>
        )}

        {isStale && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400">
            <Unlink className="size-2.5" />
            missing
          </span>
        )}

        {/* Actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!item.taskId && !item.checked && (
            <button
              onClick={onPromote}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-600 hover:text-foreground"
              title="Create board task"
            >
              <Link2 className="size-3" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-1 rounded hover:bg-zinc-700 text-zinc-600 hover:text-red-400"
            title="Remove"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="pl-[42px] pr-1 pb-2">
          {editingDesc ? (
            <div className="space-y-1.5">
              <textarea
                value={descDraft}
                onChange={(e) => setDescDraft(e.target.value)}
                placeholder="Add details..."
                rows={2}
                className="w-full text-[11px] leading-relaxed bg-zinc-900/40 border border-[rgba(255,255,255,0.06)] rounded px-2.5 py-1.5 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/40 resize-y"
                autoFocus
              />
              <div className="flex gap-1.5">
                <button
                  onClick={saveDesc}
                  className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:text-foreground border border-[rgba(255,255,255,0.06)] transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => { setDescDraft(item.description || ''); setEditingDesc(false) }}
                  className="px-2 py-0.5 rounded text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => { setDescDraft(item.description || ''); setEditingDesc(true) }}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors w-full text-left"
            >
              {item.description || 'Add details...'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ProjectChecklist({
  projectId,
  tasks,
  resolvedTasks,
  onToggle,
  onAdd,
  onRemove,
  onPromote,
}: ChecklistProps) {
  const [newItemTitle, setNewItemTitle] = useState('')

  const handleAdd = () => {
    if (!newItemTitle.trim()) return
    onAdd(newItemTitle.trim())
    setNewItemTitle('')
  }

  const handleUpdate = async (taskItemId: string, updates: { title?: string; description?: string }) => {
    await fetch(`/api/plugins/projects/${projectId}/checklist/${taskItemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    // Parent will refetch via SSE or next interaction
  }

  return (
    <div>
      <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">Tasks</h3>

      {tasks.length === 0 ? (
        <p className="text-[11px] text-zinc-600 mb-3">No tasks yet.</p>
      ) : (
        <div className="space-y-0.5 mb-3">
          {tasks.map((item) => {
            const resolved = item.taskId ? resolvedTasks[item.taskId] : null
            const stale = !!(item.taskId && resolvedTasks[item.taskId] === null)

            return (
              <TaskItem
                key={item.id}
                item={item}
                resolved={resolved}
                isStale={stale}
                onToggle={(checked) => onToggle(item.id, checked)}
                onRemove={() => onRemove(item.id)}
                onPromote={() => onPromote(item.id)}
                onUpdate={(updates) => handleUpdate(item.id, updates)}
              />
            )
          })}
        </div>
      )}

      {/* Add new item */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newItemTitle}
          onChange={(e) => setNewItemTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add task..."
          className="flex-1 text-[11px] bg-zinc-900/40 border border-[rgba(255,255,255,0.06)] rounded px-2.5 py-1.5 text-foreground placeholder:text-zinc-500 focus:outline-none focus:border-[#5e6ad2]/40 transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={!newItemTitle.trim()}
          className="px-2 py-1.5 rounded bg-zinc-800 text-zinc-400 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors border border-[rgba(255,255,255,0.06)]"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
