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

export function NewTaskDialog() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [column, setColumn] = useState('todo')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    await fetch('/api/tasks/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim() || undefined,
        column,
        assignee: assignee || undefined,
      }),
    })

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
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title..."
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Details</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional details, instructions..."
              rows={3}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground resize-y min-h-[60px]"
            />
          </div>
          <div className="flex gap-4">
            <div className="flex flex-col gap-2 flex-1">
              <Label htmlFor="assignee">Assignee</Label>
              <select
                id="assignee"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
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
              <Label htmlFor="column">Column</Label>
              <select
                id="column"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="todo">Todo</option>
                <option value="inProgress">In Progress</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
          <Button type="submit" className="self-end">
            Create Task
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
