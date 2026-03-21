'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AGENTS } from '@/lib/constants'
import { Plus } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

export function NewTaskDialog() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [column, setColumn] = useState('todo')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    try {
      const res = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          column,
          assignee: assignee || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || 'Failed to create task', 'error')
        return
      }
      toast(`Created "${title.trim()}"`, 'success')
    } catch {
      toast('Network error — server may be down', 'error')
      return
    }

    setTitle('')
    setDescription('')
    setAssignee('')
    setColumn('todo')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="outline" size="sm" />}
      >
        <Plus className="size-4" />
        New Task
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-2xl">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg">New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5 pt-1">

          {/* Title */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="title" className="text-sm font-semibold text-foreground">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="h-10 text-sm bg-background"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="description" className="text-sm font-semibold text-foreground">
              Details
            </Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context, instructions, or acceptance criteria..."
              rows={5}
              className="rounded-md border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground resize-y min-h-[120px] focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Assignee + Column side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="assignee" className="text-sm font-semibold text-foreground">
                Assignee
              </Label>
              <select
                id="assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Unassigned</option>
                {AGENTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="column" className="text-sm font-semibold text-foreground">
                Column
              </Label>
              <select
                id="column"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="todo">Todo</option>
                <option value="inProgress">In Progress</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-1 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!title.trim()}
              className="px-5"
            >
              <Plus className="size-4 mr-1.5" />
              Create Task
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
