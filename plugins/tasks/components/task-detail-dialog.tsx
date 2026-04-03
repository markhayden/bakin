'use client'

import { useState, useEffect, useCallback } from 'react'
import { BakinDrawer } from '@/components/bakin-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Send, Check, X, RefreshCw, MoreHorizontal, Copy, Trash2, Pencil } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown-content'
import { TaskAssets } from '@bakin/assets/components/task-assets'
import { AgentAvatar } from '@/components/agent-avatar'
import { AgentSelect } from '@/components/agent-select'
import { useAgent } from '@bakin/team/hooks/use-agent-store'
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
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
  open: boolean
  editing: boolean
  onClose: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onDelete?: (task: Task) => void
  onDuplicate?: (task: Task) => void
}

const COLUMN_IDS: ColumnId[] = ['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'confirmed']

const STEP_DOT_COLORS: Record<string, string> = {
  complete: 'bg-green-400',
  in_progress: 'bg-blue-400',
  pending_approval: 'bg-amber-400 animate-pulse',
  rejected: 'bg-red-400',
  pending: 'bg-zinc-600',
  failed: 'bg-red-600',
}

export function TaskDetailDrawer({ task, columnId, open, editing, onClose, onEdit, onCancelEdit, onDelete, onDuplicate }: TaskDetailDrawerProps) {
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
  const [showAllNotes, setShowAllNotes] = useState(false)

  // Workflow instance state for gate approval
  const [wfInstance, setWfInstance] = useState<WorkflowInstance | null>(null)
  const [wfDefinition, setWfDefinition] = useState<WorkflowDefinition | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [gateLoading, setGateLoading] = useState(false)

  // Prior step output for gate review
  const [priorStepOutput, setPriorStepOutput] = useState<Record<string, unknown> | null>(null)
  const [outputLoading, setOutputLoading] = useState(false)
  const [outputUnavailable, setOutputUnavailable] = useState(false)

  const isCreate = editing && !task

  useEffect(() => {
    fetch('/api/plugins/workflows/definitions')
      .then((r) => r.ok ? r.json() : { templates: [] })
      .then((d) => setWorkflows(d.templates ?? []))
      .catch(() => {})
  }, [])

  // Populate form when entering edit mode
  useEffect(() => {
    if (!open) return
    if (editing && !task) {
      // Create mode — clear fields
      setTitle('')
      setDescription('')
      setAgent('')
      setColumn('todo')
      setWorkflowId('')
      setDirty(false)
      setLogMessage('')
      setShowAllNotes(false)
      setWfInstance(null)
      setWfDefinition(null)
      return
    }
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

      if (task.workflowId) {
        fetch(`/api/plugins/workflows/instances/${task.id}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.instance) setWfInstance(d.instance) })
          .catch(() => {})

        fetch(`/api/plugins/workflows/definitions/${task.workflowId}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.definition) setWfDefinition(d.definition) })
          .catch(() => {})
      }
    }
  }, [open, editing, task, columnId])

  // Fetch workflow definition when workflowId changes (covers create + switching workflows in edit)
  useEffect(() => {
    if (!workflowId) {
      setWfDefinition(null)
      return
    }
    // Skip if already loaded for this workflow
    if (wfDefinition?.name === workflowId) return
    fetch(`/api/plugins/workflows/definitions/${workflowId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.definition) setWfDefinition(d.definition) })
      .catch(() => {})
  }, [workflowId])

  // Derived workflow state
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

    setOutputLoading(true)
    setOutputUnavailable(false)
    for (let attempt = 0; attempt < 3; attempt++) {
      await new Promise(r => setTimeout(r, 500))
      try {
        const res = await fetch(`/api/plugins/workflows/instances/${wfInstance.taskId}`)
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

  // ─── Handlers ──────────────────────────────────────────────────

  function markDirty() { setDirty(true) }

  async function handleCreate() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/plugins/tasks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          column,
          assignee: agent || undefined,
          workflowId: workflowId || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || 'Failed to create task', 'error')
      } else {
        toast(`Created "${title.trim()}"`, 'success')
        onClose()
      }
    } catch {
      toast('Network error', 'error')
    }
    setSaving(false)
  }

  async function handleSave() {
    if (isCreate) return handleCreate()
    setSaving(true)
    try {
      const res = await fetch('/api/plugins/tasks/' + task!.id, {
        method: 'PUT',
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
      const res = await fetch('/api/plugins/tasks/' + task!.id + '/log', {
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
      const res = await fetch(`/api/plugins/workflows/gates/${task!.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task!.id,
          stepId: wfInstance.currentStepId,
        }),
      })
      if (res.ok) {
        toast('Gate approved — workflow advancing', 'success')
        const d = await fetch(`/api/plugins/workflows/instances/${task!.id}`).then(r => r.ok ? r.json() : null)
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
      const res = await fetch(`/api/plugins/workflows/gates/${task!.id}/reject`, {
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
        const d = await fetch(`/api/plugins/workflows/instances/${task!.id}`).then(r => r.ok ? r.json() : null)
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

  // ─── Shared JSX ────────────────────────────────────────────────

  const gateStep = wfDefinition?.steps.find(s => s.id === wfInstance?.currentStepId)

  const activeWorkflowId = task?.workflowId || workflowId
  const workflowProgressJSX = activeWorkflowId && wfDefinition ? (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider">Workflow</h3>
        <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-2.5 py-0.5">{activeWorkflowId}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap rounded-lg bg-surface p-3">
        {wfDefinition.steps.map((step, i) => {
          const state = wfInstance?.stepStates[step.id]
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
  ) : null

  const gateApprovalJSX = isGatePending && gateStep ? (
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
  ) : null

  const notesListJSX = task?.log && task.log.length > 0 ? (() => {
    const reversed = [...task.log].reverse()
    const NOTES_PAGE_SIZE = 5
    const visible = showAllNotes ? reversed : reversed.slice(0, NOTES_PAGE_SIZE)
    const hasMore = reversed.length > NOTES_PAGE_SIZE
    return (
      <div className="flex flex-col gap-2 pb-4">
        {visible.map((entry, i) => (
          <div key={i} className="rounded-md border border-border bg-background px-3 py-2">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs font-mono text-muted-foreground">{entry.timestamp}</span>
              <span className="text-xs font-medium text-foreground">{entry.author}</span>
            </div>
            <p className="text-xs text-muted-foreground">{entry.message}</p>
          </div>
        ))}
        {hasMore && !showAllNotes && (
          <button
            onClick={() => setShowAllNotes(true)}
            className="text-xs text-accent hover:underline self-start"
          >
            Show {reversed.length - NOTES_PAGE_SIZE} older notes
          </button>
        )}
      </div>
    )
  })() : null

  // Hero card (used in both modes for existing tasks)
  const taskAgentMeta = useAgent(task?.agent ?? '')

  const heroJSX = task && columnId ? (() => {
    const agentMeta = taskAgentMeta
    const colConfig = COLUMN_CONFIG[columnId]
    return (
      <div className="flex items-center gap-4 rounded-lg p-4 border border-border bg-surface">
        {agentMeta ? (
          <AgentAvatar agentId={task.agent!} size="lg" />
        ) : (
          <div className="size-10 rounded-full bg-zinc-700 flex items-center justify-center text-lg">?</div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{agentMeta?.name || 'Unassigned'}</div>
          <div className="flex items-center gap-2 mt-1">
            {colConfig && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[columnId]}`} />
                {colConfig.label}
              </span>
            )}
            {task.workflowId && (
              <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-2.5 py-0.5">{task.workflowId}</span>
            )}
          </div>
        </div>
      </div>
    )
  })() : null

  // ─── Edit/Create Form ──────────────────────────────────────────
  if (editing) {
    return (
      <BakinDrawer
        open={open}
        onOpenChange={(o) => { if (!o) onClose() }}
        title={isCreate ? 'New Task' : 'Edit Task'}
        onBack={isCreate ? undefined : onCancelEdit}
        dirty={dirty}
      >
        <div className="space-y-4">
          {heroJSX}

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Title</label>
            <Input
              value={title}
              onChange={(e) => { setTitle(e.target.value); markDirty() }}
              placeholder="What needs to be done..."
              className="bg-surface"
            />
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Details</label>
            <Textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); markDirty() }}
              placeholder="Describe what needs to happen, any constraints, links, or context the agent needs..."
              rows={8}
              className="min-h-[120px] resize-y bg-surface"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Assignee</label>
              <AgentSelect
                value={agent}
                onValueChange={(v) => { setAgent(v ?? ''); markDirty() }}
                allowNone
                noneLabel="Unassigned"
                className="w-full bg-surface"
              />
            </div>

            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Column</label>
              <Select value={column} onValueChange={(v) => { setColumn((v ?? 'todo') as ColumnId); markDirty() }}>
                <SelectTrigger className="w-full bg-surface">
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[column]} shrink-0`} />
                      {COLUMN_CONFIG[column as ColumnId]?.label || column}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COLUMN_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[id]} shrink-0`} />
                      {COLUMN_CONFIG[id].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="text-sm text-muted-foreground mb-1 block">Workflow</label>
            <Select value={workflowId} onValueChange={(v) => { setWorkflowId(v ?? ''); markDirty() }}>
              <SelectTrigger className="w-full bg-surface">
                <SelectValue placeholder="None">
                  {(() => {
                    const wf = workflows.find(w => w.filename.replace('.yaml', '') === workflowId)
                    return wf ? `${wf.name} (${wf.stepCount} steps)` : workflowId || 'None'
                  })()}
                </SelectValue>
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
          </div>

          {/* Workflow preview box */}
          {workflowId && wfDefinition && (
            <div className="rounded-lg border border-border bg-surface p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground bg-muted/50 border border-border rounded-full px-2.5 py-0.5">{wfDefinition.name || workflowId}</span>
                <span className="text-[11px] text-muted-foreground">{wfDefinition.steps.length} steps</span>
              </div>
              {(() => {
                const desc = workflows.find(w => w.filename.replace('.yaml', '') === workflowId)?.description
                return desc ? <p className="text-xs text-muted-foreground">{desc}</p> : null
              })()}
              <div className="flex items-center gap-1 flex-wrap">
                {wfDefinition.steps.map((step, i) => {
                  const state = wfInstance?.stepStates[step.id]
                  const status = state?.status || 'pending'
                  const dotColor = STEP_DOT_COLORS[status] || STEP_DOT_COLORS.pending
                  const isGate = step.type === 'gate'
                  return (
                    <div key={step.id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-zinc-600 text-[10px]">&rarr;</span>}
                      <span className={`size-2 rounded-full ${dotColor} shrink-0`} />
                      <span className={`text-[10px] ${status === 'pending_approval' ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
                        {isGate ? '⏳' : ''}{step.label || step.id}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {gateApprovalJSX}

          {!isCreate && task && <TaskAssets taskId={task.id} />}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={isCreate ? onClose : onCancelEdit}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || (!isCreate && !dirty) || !title.trim()}>
              {saving ? 'Saving...' : isCreate ? 'Create Task' : 'Save'}
            </Button>
          </div>

          {!isCreate && task && (
            <>
              <Separator />
              <div>
                <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Notes</h3>
                <div className="flex gap-2 mb-3">
                  <Input
                    value={logMessage}
                    onChange={(e) => setLogMessage(e.target.value)}
                    placeholder="Add a note..."
                    className="flex-1 h-8 bg-surface"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddLog() }}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleAddLog}
                    disabled={addingLog || !logMessage.trim()}
                  >
                    <Send className="size-3.5" />
                  </Button>
                </div>
                {(!task.log || task.log.length === 0) && (
                  <p className="text-xs text-muted-foreground">No notes yet.</p>
                )}
                {notesListJSX}
              </div>
            </>
          )}
        </div>
      </BakinDrawer>
    )
  }

  // ─── Detail View ────────────────────────────────────────────────
  if (!task || !columnId) return null

  const agentMeta = taskAgentMeta

  return (
    <BakinDrawer
      open={open}
      onOpenChange={(o) => { if (!o) onClose() }}
      title={task.title}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1.5 rounded-md hover:bg-accent transition-colors">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-3.5 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onDuplicate?.(task)}>
              <Copy className="size-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete?.(task)} className="text-red-400 focus:text-red-400">
              <Trash2 className="size-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-6">
        {/* Hero card */}
        {heroJSX}

        {/* Quick actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1.5" /> Edit
          </Button>
        </div>

        {gateApprovalJSX}

        {workflowProgressJSX}

        {/* Description */}
        {task.description && (
          <div>
            <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">Details</h3>
            <div className="text-xs text-foreground/90 leading-relaxed rounded-lg p-4 border-l-2 bg-surface" style={{ borderLeftColor: agentMeta ? `var(--agent-${task.agent})` : 'var(--outline-variant)' }}>
              <MarkdownContent content={task.description} />
            </div>
          </div>
        )}

        <TaskAssets taskId={task.id} readOnly />

        <Separator />

        {/* Notes */}
        <div>
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Notes</h3>
          <div className="flex gap-2 mb-3">
            <Input
              value={logMessage}
              onChange={(e) => setLogMessage(e.target.value)}
              placeholder="Add a note..."
              className="flex-1 h-8 bg-surface"
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddLog() }}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleAddLog}
              disabled={addingLog || !logMessage.trim()}
            >
              <Send className="size-3.5" />
            </Button>
          </div>
          {(!task.log || task.log.length === 0) && (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          )}
          {notesListJSX}
        </div>
      </div>
    </BakinDrawer>
  )
}
