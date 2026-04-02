'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { AgentAvatar } from '@/components/agent-avatar'
import { AGENTS } from '@/lib/constants'
import { Plus } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface WorkflowOption {
  name: string
  filename: string
  description: string
  stepCount: number
}

export function NewTaskDialog() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [column, setColumn] = useState('todo')
  const [workflowId, setWorkflowId] = useState('')
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])

  useEffect(() => {
    if (!open) return
    fetch('/api/plugins/workflows/definitions')
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((data) => setWorkflows(data.templates || []))
      .catch(() => setWorkflows([]))
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    try {
      const res = await fetch('/api/plugins/tasks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          column,
          assignee: assignee || undefined,
          workflowId: workflowId || undefined,
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
    setWorkflowId('')
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button size="sm" />}
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
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context, instructions, or acceptance criteria..."
              rows={5}
              className="min-h-[120px] resize-y"
            />
          </div>

          {/* Workflow */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="workflow" className="text-sm font-semibold text-foreground">
              Workflow
            </Label>
            <Select value={workflowId} onValueChange={(v) => setWorkflowId(v ?? '')}>
              <SelectTrigger className="w-full h-10">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {workflows.map((w) => (
                  <SelectItem key={w.filename} value={w.filename.replace('.yaml', '')}>
                    {w.name} ({w.stepCount} steps)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {workflowId && (
              <p className="text-xs text-muted-foreground">
                {workflows.find((w) => w.filename.replace('.yaml', '') === workflowId)?.description}
              </p>
            )}
          </div>

          {/* Assignee + Column side by side */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="assignee" className="text-sm font-semibold text-foreground">
                Assignee
              </Label>
              <Select value={assignee} onValueChange={(v) => setAssignee(v ?? '')}>
                <SelectTrigger className="w-full h-10">
                  <SelectValue>
                    {assignee ? (
                      <span className="flex items-center gap-2">
                        <AgentAvatar agentId={assignee} size="xs" />
                        {AGENTS.find(a => a.id === assignee)?.name || assignee}
                      </span>
                    ) : 'Unassigned'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Unassigned</SelectItem>
                  {AGENTS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <AgentAvatar agentId={a.id} size="xs" />
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="column" className="text-sm font-semibold text-foreground">
                Column
              </Label>
              <Select value={column} onValueChange={(v) => setColumn(v ?? 'todo')}>
                <SelectTrigger className="w-full h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="todo">Todo</SelectItem>
                  <SelectItem value="inProgress">In Progress</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                </SelectContent>
              </Select>
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
