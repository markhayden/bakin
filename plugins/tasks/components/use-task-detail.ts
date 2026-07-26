'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAgent } from "@makinbakin/sdk/hooks"
import { TEAM_VALUE_PREFIX, isTeamValue, teamIdFromValue } from '@makinbakin/sdk/components'
import { useJsonFetch } from "@makinbakin/sdk/hooks"
import { toast } from "@makinbakin/sdk/hooks"
import { usePluginEvent, type PluginEventPayload } from "@makinbakin/sdk/hooks"
import type { Task, ColumnId } from '../types'
import type { WorkflowInstance as SdkWorkflowInstance, WorkflowDefinition as SdkWorkflowDefinition } from '@makinbakin/sdk/types'
import { createShortClientId } from '../lib/client-id'

export interface Workflow {
  filename: string
  name: string
  description?: string
  stepCount: number
}

// Derived from the SDK wire types so the base shape (instanceId — NOT id — plus
// workflowId/taskId/status/etc.) is single-sourced (WS1). The SDK leaves steps and
// stepStates intentionally open; this component narrows them to the fields it reads.
interface WorkflowInstance extends SdkWorkflowInstance {
  workflowId: string
  taskId: string
  currentStepId: string
  status: string
  stepStates: Record<string, {
    status: string
    output?: Record<string, unknown>
    childTaskId?: string
    /** map_workflow fan-out entries (join bookkeeping) */
    children?: Array<{ index: number; childTaskId: string; status: string }>
    /** Typed failure code (e.g. map_source_invalid) — branch on this, never on error text */
    code?: string
    error?: string
  }>
}

export interface MapChildInfo {
  index: number
  childTaskId: string
  entryStatus: string
  liveStatus: string
  currentStepId?: string
  workflowId?: string
}

interface WorkflowDefinition extends SdkWorkflowDefinition {
  steps: Array<{ id: string; label?: string; type: string }>
}

const CLIPBOARD_MAX_SIZE_MB = 10
const CLIPBOARD_MAX_SIZE_BYTES = CLIPBOARD_MAX_SIZE_MB * 1024 * 1024
const LONG_TEXT_LINE_THRESHOLD = 20
const LONG_TEXT_CHAR_THRESHOLD = 500

interface UseTaskDetailArgs {
  task: Task | null
  columnId: ColumnId | null
  open: boolean
  editing: boolean
  onClose: () => void
}

/**
 * The TaskDetailDrawer data layer: every hook, effect, form-draft slice, and
 * action handler for the create / edit / detail modes. Extracted so the drawer
 * shell and its mode components consume one typed object (models-page precedent).
 * Behavior-identical to the former inline hooks — same call order, same effects.
 */
export function useTaskDetail({ task, columnId, open, editing, onClose }: UseTaskDetailArgs) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [agent, setAgent] = useState('')
  const [column, setColumn] = useState<ColumnId>('todo')
  const [workflowId, setWorkflowId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pasting, setPasting] = useState(false)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  // Provisional ID for new tasks — ensures pasted assets land in the right directory
  const [provisionalId] = useState(() => createShortClientId())
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

  // Clean single-GET on mount — migrated from a fetch-in-useEffect to useJsonFetch (WS3).
  const { data: workflowDefs } = useJsonFetch<{ templates?: Workflow[] }>('/api/plugins/workflows/definitions')
  const workflows = useMemo(() => workflowDefs?.templates ?? [], [workflowDefs])
  // Published brands for the picker (#419) — drafts never appear.
  const { data: brandsData } = useJsonFetch<{ brands?: Array<{ id: string; name: string; draft?: boolean }> }>('/api/plugins/brands/')
  const brands = useMemo(() => (brandsData?.brands ?? []).filter(b => !b.draft), [brandsData])

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
      setBrandId('')
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
      // Unresolved team task → show the team selection; once resolved the
      // concrete agent leads (the team rides along server-side).
      setAgent(task.agent || (task.team ? `${TEAM_VALUE_PREFIX}${task.team}` : ''))
      setColumn(columnId)
      setWorkflowId(task.workflowId || '')
      setBrandId(task.brandId || '')
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
  }, [wfDefinition?.name, workflowId])

  // Derived workflow state
  const isGatePending = wfInstance?.status === 'pending_approval'

  // ─── Map fan-out children (live statuses + retry/cancel) ────────
  const [mapChildren, setMapChildren] = useState<MapChildInfo[]>([])
  const [mapActionLoading, setMapActionLoading] = useState(false)

  const mapStepId = useMemo(() => {
    if (!wfInstance) return null
    for (const [stepId, state] of Object.entries(wfInstance.stepStates)) {
      if (state.children && state.children.length > 0 && state.status !== 'complete') return stepId
    }
    return null
  }, [wfInstance])

  const refreshWfInstance = useCallback(async (taskId: string) => {
    const d = await fetch(`/api/plugins/workflows/instances/${taskId}`).then(r => r.ok ? r.json() : null).catch(() => null)
    if (d?.instance) setWfInstance(d.instance)
  }, [])

  // Out-of-band gate decisions (Discord bridge buttons, the fallback page,
  // another tab) change the instance with NO local action to piggyback on —
  // without this the pending-approval callout lingers until something else
  // happens to refetch (#669 live-validation finding). Refresh on every
  // workflow lifecycle event for the open task.
  const onWorkflowEvent = useCallback((payload: PluginEventPayload) => {
    if (task?.id && payload.taskId === task.id) void refreshWfInstance(task.id)
  }, [task?.id, refreshWfInstance])
  usePluginEvent('workflow.gate_approved', onWorkflowEvent)
  usePluginEvent('workflow.gate_rejected', onWorkflowEvent)
  usePluginEvent('workflow.gate_reached', onWorkflowEvent)
  usePluginEvent('workflow.step_dispatched', onWorkflowEvent)
  usePluginEvent('workflow.step_complete', onWorkflowEvent)
  usePluginEvent('workflow.complete', onWorkflowEvent)
  usePluginEvent('workflow.reopened', onWorkflowEvent)

  useEffect(() => {
    if (!wfInstance || !mapStepId) { setMapChildren([]); return }
    fetch(`/api/plugins/workflows/instances/${wfInstance.taskId}/map/${mapStepId}/children`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.children) setMapChildren(d.children) })
      .catch(() => {})
  }, [wfInstance, mapStepId])

  const handleMapChildAction = useCallback(async (action: 'retry' | 'cancel', index: number, reason?: string) => {
    if (!wfInstance || !mapStepId) return
    setMapActionLoading(true)
    try {
      const res = await fetch(`/api/plugins/workflows/instances/${wfInstance.taskId}/map/${mapStepId}/children/${index}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      })
      if (res.ok) {
        toast(action === 'retry' ? `Retrying child ${index + 1}` : `Cancelled child ${index + 1}`, 'success')
        await refreshWfInstance(wfInstance.taskId)
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || `Failed to ${action} child`, 'error')
      }
    } catch {
      toast('Network error', 'error')
    }
    setMapActionLoading(false)
  }, [wfInstance, mapStepId, refreshWfInstance])

  // Failed-instance recovery (e.g. map_source_invalid): reopen at a prior step.
  const failedStep = wfInstance?.status === 'failed'
    ? { stepId: wfInstance.currentStepId, ...wfInstance.stepStates[wfInstance.currentStepId] }
    : null

  const handleReopenWorkflow = useCallback(async (stepId?: string) => {
    if (!wfInstance) return
    setMapActionLoading(true)
    try {
      const res = await fetch(`/api/plugins/workflows/instances/${wfInstance.taskId}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepId, reason: 'Re-run requested from task detail' }),
      })
      if (res.ok) {
        toast('Workflow reopened', 'success')
        await refreshWfInstance(wfInstance.taskId)
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        toast(data.error || 'Failed to reopen workflow', 'error')
      }
    } catch {
      toast('Network error', 'error')
    }
    setMapActionLoading(false)
  }, [wfInstance, refreshWfInstance])

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

  /** Insert text at the textarea cursor position and update description state. */
  function insertAtCursor(text: string) {
    const el = descriptionRef.current
    if (!el) {
      setDescription(prev => prev + text)
      markDirty()
      return
    }
    const start = el.selectionStart
    const end = el.selectionEnd
    const before = description.substring(0, start)
    const after = description.substring(end)
    const newValue = before + text + after
    setDescription(newValue)
    markDirty()
    // Restore cursor after React re-render
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + text.length
      el.focus()
    })
  }

  /** Upload a file to the assets system and return the result. */
  async function uploadAsset(file: File, taskId: string, source: 'clipboard' | 'upload'): Promise<{ ok: boolean; assetId?: string; filename?: string; error?: string }> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('taskId', taskId)
    formData.append('source', source)
    const res = await fetch('/api/plugins/assets/upload', { method: 'POST', body: formData })
    return res.json()
  }

  /** Handle paste events — intercepts images and long text, uploads as task assets. */
  async function handleDescriptionPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return

    const currentTaskId = task?.id || provisionalId

    // Check for image data first
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue

        if (file.size > CLIPBOARD_MAX_SIZE_BYTES) {
          toast(`Pasted image exceeds ${CLIPBOARD_MAX_SIZE_MB}MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`, 'error')
          return
        }

        setPasting(true)
        try {
          const result = await uploadAsset(file, currentTaskId, 'clipboard')
          if (result.ok && result.assetId) {
            const ref = `![${result.filename || 'pasted image'}](/api/assets/${encodeURIComponent(result.assetId)})`
            insertAtCursor(ref)
            window.dispatchEvent(new CustomEvent('bakin:asset-uploaded', { detail: { taskId: currentTaskId } }))
            toast('Image added to task assets', 'success')
          } else {
            toast(result.error || 'Failed to upload pasted image', 'error')
          }
        } catch {
          toast('Failed to upload pasted image', 'error')
        } finally {
          setPasting(false)
        }
        return
      }
    }

    // Check for long text paste — save as text asset instead of bloating description
    const text = e.clipboardData.getData('text/plain')
    if (text) {
      const lineCount = text.split('\n').length
      if (lineCount >= LONG_TEXT_LINE_THRESHOLD || text.length >= LONG_TEXT_CHAR_THRESHOLD) {
        e.preventDefault()
        setPasting(true)
        try {
          const blob = new Blob([text], { type: 'text/markdown' })
          const filename = `pasted-text-${Date.now()}.md`
          const file = new File([blob], filename, { type: 'text/markdown' })
          const result = await uploadAsset(file, currentTaskId, 'clipboard')
          if (result.ok && result.assetId) {
            const ref = `[Attached: ${result.filename} (${lineCount} lines)](/api/assets/${encodeURIComponent(result.assetId)})`
            insertAtCursor(ref)
            window.dispatchEvent(new CustomEvent('bakin:asset-uploaded', { detail: { taskId: currentTaskId } }))
            toast(`Text saved as task asset (${lineCount} lines)`, 'success')
          } else {
            // Fallback: paste text inline if upload fails
            insertAtCursor(text)
            toast(result.error || 'Failed to save as asset, pasted inline', 'error')
          }
        } catch {
          // Fallback: paste text inline
          insertAtCursor(text)
          toast('Failed to save as asset, pasted inline', 'error')
        } finally {
          setPasting(false)
        }
        return
      }
    }
  }

  async function handleCreate() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/plugins/tasks/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: provisionalId,
          title: title.trim(),
          description: description.trim() || undefined,
          column,
          // Team values come from the picker's Teams group (#189).
          assignee: agent && !isTeamValue(agent) ? agent : undefined,
          team: isTeamValue(agent) ? teamIdFromValue(agent) : undefined,
          workflowId: workflowId || undefined,
          brandId: brandId || undefined,
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
      // The route treats ABSENT keys as "don't touch" (partial update), so
      // assignment keys are sent only when the picker value changed — an
      // untouched resave must never wipe the retained team on a resolved
      // task. Explicit Unassigned clears both with empty strings (#189).
      const initialAssign = task!.agent || (task!.team ? `${TEAM_VALUE_PREFIX}${task!.team}` : '')
      const assignPatch = agent === initialAssign
        ? {}
        : isTeamValue(agent)
          ? { team: teamIdFromValue(agent) }
          : agent
            ? { agent }
            : { agent: '', team: '' }
      const res = await fetch('/api/plugins/tasks/' + task!.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: task!.id,
          originalTitle: task!.title,
          title: title.trim(),
          description: description.trim(),
          ...assignPatch,
          column,
          workflowId, // '' detaches; the route only clears on present keys
          brandId,    // '' clears (#419); the route only clears on present keys
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

  // Derived render inputs
  const gateStep = wfDefinition?.steps.find(s => s.id === wfInstance?.currentStepId)
  const activeWorkflowId = task?.workflowId || workflowId

  // Hero card agent metadata (used in both modes for existing tasks) — kept LAST
  // in the hook sequence so its call order is stable across every render path.
  const taskAgentMeta = useAgent(task?.agent ?? '')

  return {
    // form draft
    title, setTitle, description, setDescription, agent, setAgent, column, setColumn,
    workflowId, setWorkflowId, workflows, brandId, setBrandId, brands, saving, dirty, pasting, descriptionRef,
    logMessage, setLogMessage, addingLog, showAllNotes, setShowAllNotes,
    isCreate,
    // workflow / gate
    wfInstance, wfDefinition, rejectReason, setRejectReason, showRejectInput, setShowRejectInput,
    gateLoading, isGatePending, gateStep, activeWorkflowId,
    priorStepOutput, outputLoading, outputUnavailable, fetchPriorOutput,
    // map fan-out
    mapStepId, mapChildren, mapActionLoading, handleMapChildAction,
    failedStep, handleReopenWorkflow,
    // agent
    taskAgentMeta,
    // handlers
    markDirty, handleDescriptionPaste, handleSave, handleAddLog, handleApproveGate, handleRejectGate,
  }
}

export type TaskDetail = ReturnType<typeof useTaskDetail>
