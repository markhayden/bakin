import { Box, Text } from 'ink'
import { DataTable, FindingRows, ScreenHeader, Section, SummaryStrip, type FindingRow } from '../tui'
import type { TuiStatus } from '../style-tokens'
import { valueText, plural, objectField, isPlainRecord } from './format'

export interface WorkflowTemplateData {
  filename?: unknown
  name?: unknown
  description?: unknown
  stepCount?: unknown
}

export interface WorkflowActionData {
  action?: unknown
  taskId?: unknown
  workflowId?: unknown
  stepId?: unknown
  result?: unknown
  message?: unknown
  detail?: unknown
}

interface WorkflowTableRow {
  filename: string
  name: string
  description: string
  steps: string
}

function workflowTableRows(templates: WorkflowTemplateData[]): WorkflowTableRow[] {
  return templates.map(template => ({
    filename: valueText(template.filename),
    name: valueText(template.name, '(unnamed)'),
    description: valueText(template.description),
    steps: valueText(template.stepCount),
  }))
}

function workflowResultRecord(action: WorkflowActionData): Record<string, unknown> {
  return isPlainRecord(action.result) ? action.result : {}
}

function workflowActionStatus(action: WorkflowActionData): TuiStatus {
  const name = valueText(action.action)
  const result = workflowResultRecord(action)
  const instance = objectField(result, 'instance')
  const status = valueText(
    objectField(instance, 'status')
      ?? objectField(result, 'status')
      ?? objectField(objectField(result, 'nextStep'), 'status'),
    '',
  )

  if (status === 'complete' || objectField(result, 'workflowComplete') === true) return 'done'
  if (status === 'failed' || status === 'cancelled') return 'fail'
  if (status === 'pending_approval') return 'ready'
  if (name === 'step') return 'run'
  return 'applied'
}

function workflowActionMessage(action: WorkflowActionData): string {
  const name = valueText(action.action, 'updated')
  const result = workflowResultRecord(action)
  const taskId = valueText(action.taskId, 'task')
  const workflowId = valueText(action.workflowId ?? objectField(objectField(result, 'instance'), 'workflowId'), 'workflow')
  const stepId = valueText(action.stepId ?? objectField(result, 'stepId'), 'step')
  const label = valueText(objectField(result, 'label'), stepId)
  const status = valueText(objectField(result, 'status'), '')

  switch (name) {
    case 'started':
      return `Started workflow ${workflowId} for task ${taskId}.`
    case 'step':
      if (status === 'complete') return `Workflow for task ${taskId} is complete.`
      if (status === 'pending_approval') return `Workflow step ${stepId} is waiting for approval.`
      return `Current workflow step ${stepId}: ${label}.`
    case 'submitted':
      return `Completed workflow step ${stepId}.`
    default:
      return `Updated workflow for task ${taskId}.`
  }
}

function workflowActionDetail(action: WorkflowActionData): string {
  const detail = valueText(action.detail, '')
  if (detail) return detail

  const name = valueText(action.action, 'updated')
  const result = workflowResultRecord(action)
  const instance = objectField(result, 'instance')
  const nextStep = objectField(result, 'nextStep')

  if (name === 'started') {
    const currentStep = valueText(objectField(instance, 'currentStepId'), '')
    const status = valueText(objectField(instance, 'status'), '')
    return [
      currentStep ? `current step: ${currentStep}` : '',
      status ? `status: ${status}` : '',
    ].filter(Boolean).join(', ')
  }

  if (name === 'step') {
    const agent = valueText(objectField(result, 'agent'), '')
    const type = valueText(objectField(result, 'type'), '')
    const status = valueText(objectField(result, 'status'), '')
    return [
      agent ? `agent: ${agent}` : '',
      type ? `type: ${type}` : '',
      status ? `status: ${status}` : '',
    ].filter(Boolean).join(', ')
  }

  if (name === 'submitted') {
    if (objectField(result, 'workflowComplete') === true) return 'Workflow complete.'
    if (isPlainRecord(nextStep)) {
      const stepId = valueText(nextStep.stepId, 'next')
      const label = valueText(nextStep.label, stepId)
      return `Next step ${stepId}: ${label}`
    }
  }

  return ''
}

function workflowActionRows(action: WorkflowActionData): FindingRow[] {
  const status = workflowActionStatus(action)
  const taskId = valueText(action.taskId, 'task')
  return [{
    status,
    label: taskId,
    message: valueText(action.message, workflowActionMessage(action)),
    detail: workflowActionDetail(action) || undefined,
  }]
}

export function WorkflowsListReport({ templates, color = true }: {
  templates: WorkflowTemplateData[]
  color?: boolean
}) {
  const rows = workflowTableRows(templates)

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Workflows" subtitle="Available workflow definitions" color={color} />
      <SummaryStrip items={[
        { label: plural(rows.length, 'workflow'), value: rows.length, status: rows.length > 0 ? 'ok' : 'skip' },
      ]} color={color} />
      <Section title="Definitions" color={color}>
        {rows.length > 0 ? (
          <DataTable
            rows={rows}
            columns={[
              { key: 'filename', header: 'FILENAME', width: 18, render: row => row.filename },
              { key: 'name', header: 'NAME', width: 22, render: row => row.name },
              { key: 'description', header: 'DESCRIPTION', width: 46, grow: true, render: row => row.description },
              { key: 'steps', header: 'STEPS', width: 7, render: row => row.steps },
            ]}
          />
        ) : (
          <FindingRows rows={[{ status: 'skip', label: 'empty', message: 'No workflow definitions found.' }]} color={color} />
        )}
      </Section>
    </Box>
  )
}

export function WorkflowActionReport({ action, color = true }: {
  action: WorkflowActionData
  color?: boolean
}) {
  const actionName = valueText(action.action, 'updated')
  const taskId = valueText(action.taskId, '')
  const workflowId = valueText(action.workflowId, '')
  const stepId = valueText(action.stepId, '')

  return (
    <Box flexDirection="column">
      <ScreenHeader title="Workflow action" subtitle="Workflow state updated" meta={actionName} color={color} />
      <SummaryStrip items={[
        { label: 'action', value: actionName, status: workflowActionStatus(action) },
        { label: 'task', value: taskId || '-', status: taskId ? 'ok' : 'skip' },
        workflowId
          ? { label: 'workflow', value: workflowId, status: 'ok' }
          : { label: 'step', value: stepId || '-', status: stepId ? 'ready' : 'skip' },
      ]} color={color} />
      <Section title="Result" color={color}>
        <FindingRows rows={workflowActionRows(action)} color={color} />
        <Text> </Text>
      </Section>
    </Box>
  )
}
