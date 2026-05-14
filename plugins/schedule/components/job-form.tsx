'use client'

import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import { Textarea } from "@makinbakin/sdk/ui"
import { AgentSelect } from "@makinbakin/sdk/components"
import { useMainAgentId } from "@makinbakin/sdk/hooks"
import { ScheduleInput } from './schedule-input'

export interface JobFormData {
  name: string
  schedule: string
  agentId?: string
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string
  owner?: string
  requireTriage?: boolean
  allowOverlap?: boolean
  maxFailures?: number
}

export function JobForm({
  onSubmit,
  onCancel,
  submitting,
  initial,
  mode = 'create',
}: {
  onSubmit: (data: JobFormData) => Promise<void>
  onCancel: () => void
  submitting: boolean
  initial?: Partial<JobFormData>
  mode?: 'create' | 'edit' | 'duplicate' | 'adopt'
}) {
  const mainAgentId = useMainAgentId()
  const [name, setName] = useState(initial?.name ?? '')
  const [schedule, setSchedule] = useState(initial?.schedule ?? '')
  const [agentId, setAgentId] = useState<string>(initial?.agentId ?? '')
  const [prompt, setPrompt] = useState(initial?.taskPrompt ?? '')
  const [advanced, setAdvanced] = useState(false)
  const [workflowId, setWorkflowId] = useState(initial?.workflowId ?? '')
  const [taskTitle, setTaskTitle] = useState(initial?.taskTitle ?? '')
  const [owner, setOwner] = useState(initial?.owner ?? mainAgentId ?? '')
  const [requireTriage, setRequireTriage] = useState(initial?.requireTriage ?? false)
  const [allowOverlap, setAllowOverlap] = useState(initial?.allowOverlap ?? false)
  const [maxFailures, setMaxFailures] = useState(initial?.maxFailures ?? 3)
  const [parsedOk, setParsedOk] = useState(mode === 'edit' || mode === 'adopt') // existing runtime schedules are already valid

  // Reset form when initial changes (e.g. switching between jobs)
  useEffect(() => {
    if (initial) {
      setName(initial.name ?? '')
      setSchedule(initial.schedule ?? '')
      setAgentId(initial.agentId ?? '')
      setPrompt(initial.taskPrompt ?? '')
      setWorkflowId(initial.workflowId ?? '')
      setTaskTitle(initial.taskTitle ?? '')
      setOwner(initial.owner ?? '')
      setRequireTriage(initial.requireTriage ?? false)
      setAllowOverlap(initial.allowOverlap ?? false)
      setMaxFailures(initial.maxFailures ?? 3)
      setParsedOk(mode === 'edit' || mode === 'adopt')
    }
  }, [initial, mode])

  // Sync default owner once main agent id resolves from the team store.
  useEffect(() => {
    if (initial?.owner) return
    if (!mainAgentId) return
    setOwner((prev) => (prev ? prev : mainAgentId))
  }, [initial, mainAgentId])

  const canSubmit = name.trim() && schedule.trim() && parsedOk && !submitting

  const labels = {
    create: { submit: 'Create Job', submitting: 'Creating...' },
    edit: { submit: 'Save Changes', submitting: 'Saving...' },
    duplicate: { submit: 'Create Copy', submitting: 'Creating...' },
    adopt: { submit: 'Adopt into Bakin', submitting: 'Adopting...' },
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    await onSubmit({
      name: name.trim(),
      schedule: schedule.trim(),
      agentId: agentId || undefined,
      taskPrompt: prompt.trim() || undefined,
      workflowId: workflowId.trim() || undefined,
      taskTitle: taskTitle.trim() || undefined,
      owner: owner || undefined,
      requireTriage,
      allowOverlap,
      maxFailures,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div className="space-y-1.5">
        <Label className="text-sm">Name</Label>
        <Input
          placeholder="Daily content check"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-sm"
        />
      </div>

      {/* Schedule */}
      <div className="space-y-1.5">
        <Label className="text-sm">Schedule</Label>
        <ScheduleInput
          value={schedule}
          onChange={setSchedule}
          onParsed={(r) => setParsedOk(!!r)}
        />
      </div>

      {/* Agent */}
      <div className="space-y-1.5">
        <Label className="text-sm">Agent</Label>
        <AgentSelect
          value={agentId}
          onValueChange={(v) => setAgentId(v ?? '')}
          allowNone
          noneLabel="None (triage later)"
          placeholder="Select agent (optional)"
          className="text-sm"
        />
      </div>

      {/* Prompt */}
      <div className="space-y-1.5">
        <Label className="text-sm">Task prompt</Label>
        <Textarea
          placeholder="What should the agent do when this fires?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="text-sm resize-none"
        />
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setAdvanced(!advanced)}
      >
        {advanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        Advanced options
      </button>

      {advanced && (
        <div className="space-y-4 border-l-2 border-border/50 pl-4">
          <div className="space-y-1.5">
            <Label className="text-sm">Workflow ID</Label>
            <Input
              placeholder="e.g. image-social-post"
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Title template</Label>
            <Input
              placeholder="Scheduled: {jobName} on {date}"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">Supports {'{date}'}, {'{agent}'}, {'{jobName}'}</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Owner</Label>
            <AgentSelect
              value={owner}
              onValueChange={(v) => setOwner(v ?? mainAgentId ?? '')}
              className="text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Max failures before auto-pause</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={maxFailures}
              onChange={(e) => setMaxFailures(parseInt(e.target.value) || 3)}
              className="text-sm w-20"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={requireTriage}
                onChange={(e) => setRequireTriage(e.target.checked)}
                className="rounded border-border"
              />
              Require triage
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={allowOverlap}
                onChange={(e) => setAllowOverlap(e.target.checked)}
                className="rounded border-border"
              />
              Allow overlap
            </label>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? labels[mode].submitting : labels[mode].submit}
        </Button>
      </div>
    </form>
  )
}
