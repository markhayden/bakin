'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import {
  AgentSelect,
  TEAM_VALUE_PREFIX,
  isTeamValue,
  teamIdFromValue,
  type AgentSelectOption,
  type AgentTeamOption,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Field,
  FieldControl,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Textarea,
} from '@makinbakin/sdk/ui'
import { useAgentList, useAgentStore, useMainAgentId } from '@makinbakin/sdk/hooks'
import { ScheduleInput } from './schedule-input'
import { checkSchedulePrompt } from '../lib/prompt-guard'

export interface JobFormData {
  name: string
  schedule: string
  agentId?: string
  /** Team assignment (#189) — mutually exclusive with agentId. */
  teamId?: string
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
  const registeredAgents = useAgentList()
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const registeredTeams = useAgentStore((state) => state.teams)
  const agentOptions = useMemo<AgentSelectOption[]>(() => registeredAgents.map((agent) => ({
    id: agent.id,
    name: displaySettings[agent.id]?.displayName ?? agent.name,
    imageSrc: agent.headshot || undefined,
    color: displaySettings[agent.id]?.accentColor,
  })), [displaySettings, registeredAgents])
  const teamOptions = useMemo<AgentTeamOption[]>(() => registeredTeams.map((team) => ({
    id: team.id,
    label: team.label,
    color: team.color,
  })), [registeredTeams])

  const [name, setName] = useState(initial?.name ?? '')
  const [schedule, setSchedule] = useState(initial?.schedule ?? '')
  const [agentId, setAgentId] = useState<string>(
    initial?.agentId ?? (initial?.teamId ? `${TEAM_VALUE_PREFIX}${initial.teamId}` : ''),
  )
  const [prompt, setPrompt] = useState(initial?.taskPrompt ?? '')
  const [workflowId, setWorkflowId] = useState(initial?.workflowId ?? '')
  const [taskTitle, setTaskTitle] = useState(initial?.taskTitle ?? '')
  const [owner, setOwner] = useState(initial?.owner ?? mainAgentId ?? '')
  const [requireTriage, setRequireTriage] = useState(initial?.requireTriage ?? false)
  const [allowOverlap, setAllowOverlap] = useState(initial?.allowOverlap ?? false)
  const [maxFailures, setMaxFailures] = useState(initial?.maxFailures ?? 3)
  const [parsedOk, setParsedOk] = useState(mode === 'edit' || mode === 'adopt')

  useEffect(() => {
    if (!initial) return
    setName(initial.name ?? '')
    setSchedule(initial.schedule ?? '')
    setAgentId(initial.agentId ?? (initial.teamId ? `${TEAM_VALUE_PREFIX}${initial.teamId}` : ''))
    setPrompt(initial.taskPrompt ?? '')
    setWorkflowId(initial.workflowId ?? '')
    setTaskTitle(initial.taskTitle ?? '')
    setOwner(initial.owner ?? '')
    setRequireTriage(initial.requireTriage ?? false)
    setAllowOverlap(initial.allowOverlap ?? false)
    setMaxFailures(initial.maxFailures ?? 3)
    setParsedOk(mode === 'edit' || mode === 'adopt')
  }, [initial, mode])

  useEffect(() => {
    if (initial?.owner || !mainAgentId) return
    setOwner((previous) => previous || mainAgentId)
  }, [initial, mainAgentId])

  const canSubmit = Boolean(name.trim() && schedule.trim() && parsedOk && !submitting)
  const promptWarnings = checkSchedulePrompt(prompt)
  const labels = {
    create: { submit: 'Create job', submitting: 'Creating…' },
    edit: { submit: 'Save changes', submitting: 'Saving…' },
    duplicate: { submit: 'Create copy', submitting: 'Creating…' },
    adopt: { submit: 'Adopt into Bakin', submitting: 'Adopting…' },
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    await onSubmit({
      name: name.trim(),
      schedule: schedule.trim(),
      agentId: agentId && !isTeamValue(agentId) ? agentId : undefined,
      teamId: isTeamValue(agentId) ? teamIdFromValue(agentId) : undefined,
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
    <Form busy={submitting} onSubmit={handleSubmit} aria-label={`${labels[mode].submit} form`}>
      <FieldGroup>
        <Field name="name">
          <FieldLabel htmlFor="schedule-job-name" requirement="required">Name</FieldLabel>
          <FieldDescription>A short label that makes this job easy to find.</FieldDescription>
          <Input
            id="schedule-job-name"
            required
            placeholder="Daily content check"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field name="schedule">
          <FieldLabel requirement="required">Schedule</FieldLabel>
          <FieldDescription>Use plain language, a cron expression, or an exact date and time.</FieldDescription>
          <ScheduleInput
            value={schedule}
            onChange={setSchedule}
            onParsed={(result) => setParsedOk(Boolean(result))}
          />
        </Field>

        <Field name="agent">
          <FieldLabel>Agent or team</FieldLabel>
          <FieldDescription>Leave unassigned when the task should be triaged later.</FieldDescription>
          <AgentSelect
            id="schedule-job-agent"
            value={agentId}
            onValueChange={setAgentId}
            agents={agentOptions}
            teams={teamOptions}
            allowNone
            noneLabel="None (triage later)"
            placeholder="Select agent or team"
            className="w-full"
          />
        </Field>

        <Field name="taskPrompt">
          <FieldLabel htmlFor="schedule-job-prompt">Task prompt</FieldLabel>
          <FieldDescription>What should the assigned agent do when this job fires?</FieldDescription>
          <FieldControl
            render={(
              <Textarea
                id="schedule-job-prompt"
                placeholder="Describe the outcome, constraints, and context."
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                className="resize-y"
              />
            )}
          />
          {promptWarnings.length ? (
            <Alert tone="attention">
              <AlertDescription>
                <ul className="m-0 grid gap-bakin-1 pl-bakin-4">
                  {promptWarnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
        </Field>
      </FieldGroup>

      <Collapsible>
        <CollapsibleTrigger>
          <span>Advanced options</span>
          <ChevronRight
            aria-hidden="true"
            className="transition-transform duration-[var(--bakin-motion-duration-feedback)] group-data-[panel-open]/collapsible:rotate-90 motion-reduce:transition-none"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-bakin-2">
          <FieldGroup>
            <Field name="workflowId">
              <FieldLabel htmlFor="schedule-job-workflow">Workflow ID</FieldLabel>
              <FieldDescription>Optional workflow started by this scheduled task.</FieldDescription>
              <Input
                id="schedule-job-workflow"
                placeholder="e.g. image-social-post"
                value={workflowId}
                onChange={(event) => setWorkflowId(event.target.value)}
              />
            </Field>

            <Field name="taskTitle">
              <FieldLabel htmlFor="schedule-job-title-template">Title template</FieldLabel>
              <FieldDescription>Supports {'{date}'}, {'{agent}'}, and {'{jobName}'}.</FieldDescription>
              <Input
                id="schedule-job-title-template"
                placeholder="Scheduled: {jobName} on {date}"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
              />
            </Field>

            <Field name="owner">
              <FieldLabel>Owner</FieldLabel>
              <FieldDescription>The agent accountable for this schedule.</FieldDescription>
              <AgentSelect
                id="schedule-job-owner"
                value={owner}
                onValueChange={(value) => setOwner(value || mainAgentId || '')}
                agents={agentOptions}
                placeholder="Select owner"
                className="w-full"
              />
            </Field>

            <Field name="maxFailures">
              <FieldLabel htmlFor="schedule-job-max-failures">Failures before auto-pause</FieldLabel>
              <FieldDescription>Pause after this many consecutive failures.</FieldDescription>
              <Input
                id="schedule-job-max-failures"
                type="number"
                min={1}
                max={20}
                value={maxFailures}
                onChange={(event) => setMaxFailures(Number.parseInt(event.target.value, 10) || 3)}
                className="w-24"
              />
            </Field>

            <div className="grid gap-bakin-3 sm:grid-cols-2">
              <Field orientation="horizontal" name="requireTriage">
                <Checkbox
                  aria-label="Require triage"
                  checked={requireTriage}
                  onCheckedChange={(checked) => setRequireTriage(checked === true)}
                />
                <FieldLabel>Require triage</FieldLabel>
                <FieldDescription>Keep the created task out of automatic dispatch.</FieldDescription>
              </Field>
              <Field orientation="horizontal" name="allowOverlap">
                <Checkbox
                  aria-label="Allow overlap"
                  checked={allowOverlap}
                  onCheckedChange={(checked) => setAllowOverlap(checked === true)}
                />
                <FieldLabel>Allow overlap</FieldLabel>
                <FieldDescription>Permit a new run while the prior run remains active.</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      <FormActions>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <SubmitButton size="sm" disabled={!canSubmit} busyLabel={labels[mode].submitting}>
          {labels[mode].submit}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
