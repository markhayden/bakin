'use client'

import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Send } from 'lucide-react'
import { AGENTS } from '@/lib/constants'
import { COLUMN_CONFIG } from '../constants'
import { toast } from '@/hooks/use-toast'
import type { Task, ColumnId } from '../types'

interface TaskDetailDrawerProps {
  task: Task | null
  columnId: ColumnId | null
  onClose: () => void
}

const COLUMN_IDS: ColumnId[] = ['todo', 'blocked', 'inProgress', 'done']

export function TaskDetailDrawer({ task, columnId, onClose }: TaskDetailDrawerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agent, setAgent] = useState('')
  const [column, setColumn] = useState<ColumnId>('todo')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [logMessage, setLogMessage] = useState('')
  const [addingLog, setAddingLog] = useState(false)

  useEffect(() => {
    if (task && columnId) {
      setTitle(task.title)
      setDescription(task.description || '')
      setAgent(task.agent || '')
      setColumn(columnId)
      setDirty(false)
      setLogMessage('')
    }
  }, [task, columnId])

  if (!task || !columnId) return null

  function markDirty() { setDirty(true) }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/tasks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task!.id,
          originalTitle: task!.title,
          title: title.trim(),
          description: description.trim(),
          agent,
          column,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || 'Failed to save', 'error')
      } else {
        toast('Task updated', 'success')
        setDirty(false)
        onClose()
      }
    } catch {
      toast('Network error', 'error')
    }
    setSaving(false)
  }

  async function handleAddLog() {
    if (!logMessage.trim()) return
    setAddingLog(true)
    try {
      const res = await fetch('/api/tasks/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task!.id,
          title: task!.title,
          author: 'mark',
          message: logMessage.trim(),
        }),
      })
      if (!res.ok) {
        toast('Failed to add log entry', 'error')
      }
    } catch {
      toast('Network error', 'error')
    }
    setLogMessage('')
    setAddingLog(false)
  }

  return (
    <Sheet open={!!task} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent side="right" className="bg-card border-border sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Task</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => { setTitle(e.target.value); markDirty() }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Details</Label>
            <textarea
              id="edit-description"
              value={description}
              onChange={(e) => { setDescription(e.target.value); markDirty() }}
              placeholder="Instructions, notes..."
              rows={4}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground resize-y min-h-[60px]"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-2 flex-1">
              <Label htmlFor="edit-agent">Assignee</Label>
              <select
                id="edit-agent"
                value={agent}
                onChange={(e) => { setAgent(e.target.value); markDirty() }}
                className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="">Unassigned</option>
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2 flex-1">
              <Label htmlFor="edit-column">Column</Label>
              <select
                id="edit-column"
                value={column}
                onChange={(e) => { setColumn(e.target.value as ColumnId); markDirty() }}
                className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                {COLUMN_IDS.map((id) => (
                  <option key={id} value={id}>
                    {COLUMN_CONFIG[id].emoji} {COLUMN_CONFIG[id].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || !dirty || !title.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>

          <Separator />

          {/* Task Log */}
          <div>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Log</h3>

            {(!task.log || task.log.length === 0) && (
              <p className="text-xs text-muted-foreground mb-3">No log entries yet.</p>
            )}

            {task.log && task.log.length > 0 && (
              <div className="flex flex-col gap-2 mb-3">
                {task.log.map((entry, i) => (
                  <div key={i} className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground">{entry.timestamp}</span>
                      <span className="text-xs font-medium text-foreground">{entry.author}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{entry.message}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Input
                value={logMessage}
                onChange={(e) => setLogMessage(e.target.value)}
                placeholder="Add a note..."
                className="flex-1 h-8 bg-background"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddLog() }}
              />
              <Button
                variant="outline"
                size="icon-xs"
                onClick={handleAddLog}
                disabled={addingLog || !logMessage.trim()}
              >
                <Send className="size-3" />
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
