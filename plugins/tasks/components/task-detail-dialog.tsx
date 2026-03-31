'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { Send, Check, X, RefreshCw } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown-content'
import { TaskAssets } from '@/components/assets/task-assets'
import { AGENTS } from '@/lib/constants'
import { COLUMN_CONFIG } from '../constants'
import { toast } from '@/hooks/use-toast'
import type { Task, ColumnId } from '../types'

/** Normalize step output — handles string (possibly JSON), object, or unexpected types. */
function normalizeOutput(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') return parsed } catch {}
    return { output: raw }
  }
  return { output: String(raw ?? '') }
}

/** Pretty-print a label from a camelCase/snake_case key. */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/** Check if a string looks like a file path to an image. */
function isImagePath(v: unknown): v is string {
  return typeof v === 'string' && /\.(png|jpe?g|gif|webp|svg)$/i.test(v)
}

/** Render a single output value in human-readable form. */
function OutputValue({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    if (isImagePath(value)) {
      const filename = value.split('/').pop() || value
      // Strip absolute prefix to get asset-relative path for /api/assets/
      const assetRel = value.replace(/^.*?\/assets\//, 'assets/')
      return (
        <div className="mt-0.5">
          <p className="text-xs text-zinc-400 break-all">{filename}</p>
          <img src={`/api/assets/${assetRel}`} alt={filename} className="mt-1 max-h-48 rounded border border-border object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
        </div>
      )
    }
    const str = value as string
    if (str.includes('\n') || str.length > 120) {
      return <div className="text-xs text-zinc-300 mt-0.5"><MarkdownContent content={str} /></div>
    }
    return <p className="text-xs text-zinc-300 mt-0.5">{str}</p>
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return <p className="text-xs text-zinc-300 mt-0.5">{String(value)}</p>
  }
  if (value && typeof value === 'object') {
    // Recursively render nested objects
    const entries = Object.entries(value as Record<string, unknown>)
    return (
      <div className="mt-1 pl-3 border-l border-zinc-700 space-y-2">
        {entries.map(([k, v]) => (
          <div key={k}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{humanizeKey(k)}</p>
            <OutputValue value={v} />
          </div>
        ))}
      </div>
    )
  }
  return <p className="text-xs text-zinc-400 mt-0.5">{String(value ?? '—')}</p>
}

/** Render prior step output in a human-readable layout. */
function StepOutputViewer({ output }: { output: Record<string, unknown> | string | unknown }) {
  const data = normalizeOutput(output)
  return (
    <div className="rounded-md border border-border bg-zinc-900 px-3 py-2 max-h-80 overflow-y-auto space-y-3">
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{humanizeKey(key)}</p>
          <OutputValue value={value} />
        </div>
      ))}
    </div>
  )
}

interface Workflow {
  filename: string
  name: string
  description?: string
  stepCount: number
}

interface WorkflowInstance {
  instanceId: string
  workflowId: string
  taskId: string
  currentStepId: string
  status: string
  stepStates: Record<string, { status: string; output?: Record<string, unknown>; childTaskId?: string }>
}

interface WorkflowDefinition {
  name: string
  steps: Array<{ id: string; label?: string; type: string }>
}

interface TaskDetailDrawerProps {
  task: Task | null
  columnId: ColumnId | null
  onClose: () => void
}

const COLUMN_IDS: ColumnId[] = ['todo', 'blocked', 'inProgress', 'done']

const STEP_DOT_COLORS: Record<string, string> = {
  complete: 'bg-green-400',
  in_progress: 'bg-blue-400',
  pending_approval: 'bg-amber-400 animate-pulse',
  rejected: 'bg-red-400',
  pending: 'bg-zinc-600',
  failed: 'bg-red-600',
}

export function TaskDetailDrawer({ task, columnId, onClose }: TaskDetailDrawerProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agent, setAgent] = useState('')
  const [column, setColumn] = useState<ColumnId>('todo')
  const [workflowId, setWorkflowId] = useState('')
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [logMessage, setLogMessage] = useState('')
  const [addingLog, setAddingLog] = useState(false)

  // Workflow instance state for gate approval
  const [wfInstance, setWfInstance] = useState<WorkflowInstance | null>(null)
  const [wfDefinition, setWfDefinition] = useState<WorkflowDefinition | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [gateLoading, setGateLoading] = useState(false)

  // Prior step output for gate review (must be before early return to satisfy Rules of Hooks)
  const [priorStepOutput, setPriorStepOutput] = useState<Record<string, unknown> | null>(null)
  const [outputLoading, setOutputLoading] = useState(false)
  const [outputUnavailable, setOutputUnavailable] = useState(false)

  useEffect(() => {
    fetch('/api/plugins/workflows/list')
      .then((r) => r.ok ? r.json() : { workflows: [] })
      .then((d) => setWorkflows(d.workflows ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (task && columnId) {
      setTitle(task.title)
      setDescription(task.description || '')
      setAgent(task.agent || '')
      setColumn(columnId)
      setWorkflowId(task.workflowId || '')
      setDirty(false)
      setLogMessage('')
      setShowRejectInput(false)
      setRejectReason('')
      setWfInstance(null)
      setWfDefinition(null)

      // Load workflow instance if task has a workflow
      if (task.workflowId) {
        fetch(`/api/plugins/workflows/instance?taskId=${task.id}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.instance) setWfInstance(d.instance) })
          .catch(() => {})

        fetch(`/api/plugins/workflows/definition?name=${task.workflowId}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.definition) setWfDefinition(d.definition) })
          .catch(() => {})
      }
    }
  }, [task, columnId])

  // Derived workflow state (needed by hooks below, so must be before early return)
  const isGatePending = wfInstance?.status === 'pending_approval'

  const fetchPriorOutput = useCallback(async () => {
    if (!wfInstance || !wfDefinition || !isGatePending) {
      setPriorStepOutput(null)
      return
    }
    const gateIdx = wfDefinition.steps.findIndex(s => s.id === wfInstance.currentStepId)
    if (gateIdx <= 0) { setPriorStepOutput(null); return }
    const priorStep = wfDefinition.steps[gateIdx - 1]
    const output = wfInstance.stepStates[priorStep.id]?.output || null
    if (output) { setPriorStepOutput(output); return }

    // Output not yet persisted — retry up to 3 times at 500ms intervals
    setOutputLoading(true)
    setOutputUnavailable(false)
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(r => setTimeout(r, 500))
      try {
        const res = await fetch(`/api/plugins/workflows/instance?taskId=${wfInstance.taskId}`)
        if (!res.ok) continue
        const d = await res.json()
        const inst = d?.instance as WorkflowInstance | undefined
        if (inst) {
          const retried = inst.stepStates[priorStep.id]?.output || null
          if (retried) {
            setPriorStepOutput(retried)
            setWfInstance(inst)
            setOutputLoading(false)
            return
          }
        }
      } catch { /* retry */ }
    }
    setOutputLoading(false)
    setOutputUnavailable(true)
  }, [wfInstance, wfDefinition, isGatePending])

  useEffect(() => {
    fetchPriorOutput()
  }, [fetchPriorOutput])

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
          workflowId: workflowId || undefined,
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

  async function handleApproveGate() {
    if (!wfInstance) return
    setGateLoading(true)
    try {
      const res = await fetch('/api/plugins/workflows/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task!.id,
          stepId: wfInstance.currentStepId,
        }),
      })
      if (res.ok) {
        toast('Gate approved — workflow advancing', 'success')
        // Refresh instance
        const d = await fetch(`/api/plugins/workflows/instance?taskId=${task!.id}`).then(r => r.ok ? r.json() : null)
        if (d?.instance) setWfInstance(d.instance)
        else setWfInstance(null)
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || 'Failed to approve gate', 'error')
      }
    } catch {
      toast('Network error', 'error')
    }
    setGateLoading(false)
  }

  async function handleRejectGate() {
    if (!wfInstance || !rejectReason.trim()) return
    setGateLoading(true)
    try {
      const res = await fetch('/api/plugins/workflows/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task!.id,
          stepId: wfInstance.currentStepId,
          reason: rejectReason.trim(),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        toast(`Gate rejected — rewinding to ${data.rewoundTo}`, 'success')
        setShowRejectInput(false)
        setRejectReason('')
        // Refresh instance
        const d = await fetch(`/api/plugins/workflows/instance?taskId=${task!.id}`).then(r => r.ok ? r.json() : null)
        if (d?.instance) setWfInstance(d.instance)
        else setWfInstance(null)
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || 'Failed to reject gate', 'error')
      }
    } catch {
      toast('Network error', 'error')
    }
    setGateLoading(false)
  }

  // Find gate step info from definition
  const gateStep = wfDefinition?.steps.find(s => s.id === wfInstance?.currentStepId)

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

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-workflow">Workflow</Label>
            <select
              id="edit-workflow"
              value={workflowId}
              onChange={(e) => { setWorkflowId(e.target.value); markDirty() }}
              className="h-8 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="">None</option>
              {workflows.map((w) => (
                <option key={w.filename} value={w.filename.replace('.yaml', '')}>
                  {w.name} ({w.stepCount} steps)
                </option>
              ))}
            </select>
            {workflowId && (
              <p className="text-xs text-muted-foreground">
                {workflows.find((w) => w.filename.replace('.yaml', '') === workflowId)?.description}
              </p>
            )}
          </div>

          {/* Workflow Progress Indicator */}
          {wfDefinition && wfInstance && (
            <div className="flex flex-col gap-2">
              <Label>Workflow Progress</Label>
              <div className="flex items-center gap-1 flex-wrap">
                {wfDefinition.steps.map((step, i) => {
                  const state = wfInstance.stepStates[step.id]
                  const status = state?.status || 'pending'
                  const dotColor = STEP_DOT_COLORS[status] || STEP_DOT_COLORS.pending
                  const isGate = step.type === 'gate'
                  return (
                    <div key={step.id} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1">
                        {i > 0 && <span className="text-zinc-600 text-[10px]">&rarr;</span>}
                        <div className="flex items-center gap-1 group relative">
                          <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
                          <span className={`text-[10px] ${status === 'pending_approval' ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
                            {isGate ? '⏳' : ''}{step.label || step.id}
                          </span>
                        </div>
                      </div>
                      {state?.childTaskId && status === 'in_progress' && (
                        <span className="text-[10px] text-cyan-400 ml-3">
                          ↳ sub-task #{state.childTaskId.split('--').pop()?.slice(0, 8) || state.childTaskId.slice(0, 6)}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Gate Approval Panel */}
          {isGatePending && gateStep && (
            <div className="rounded-lg border-2 border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                <h3 className="text-sm font-semibold text-amber-400">
                  Approval Gate: {gateStep.label || gateStep.id}
                </h3>
              </div>

              {outputLoading && (
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <RefreshCw className="size-3 animate-spin" />
                  Loading step output...
                </div>
              )}

              {outputUnavailable && !priorStepOutput && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">Step output unavailable</span>
                  <button
                    onClick={() => fetchPriorOutput()}
                    className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <RefreshCw className="size-2.5" /> Retry
                  </button>
                </div>
              )}

              {priorStepOutput && (
                <div>
                  <p className="text-[11px] text-zinc-400 uppercase tracking-wider mb-1.5">Prior Step Output</p>
                  <StepOutputViewer output={priorStepOutput} />
                </div>
              )}

              {showRejectInput ? (
                <div className="space-y-2">
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Describe what needs to change..."
                    rows={3}
                    className="w-full rounded-md border border-red-500/30 bg-background px-3 py-2 text-sm text-foreground"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setShowRejectInput(false); setRejectReason('') }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleRejectGate}
                      disabled={gateLoading || !rejectReason.trim()}
                    >
                      <X className="size-3 mr-1" />
                      {gateLoading ? 'Rejecting...' : 'Reject'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRejectInput(true)}
                    disabled={gateLoading}
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                  >
                    <X className="size-3 mr-1" />
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApproveGate}
                    disabled={gateLoading}
                  >
                    <Check className="size-3 mr-1" />
                    {gateLoading ? 'Approving...' : 'Approve'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Linked Assets */}
          <TaskAssets taskId={task.id} />

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
