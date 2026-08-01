/**
 * Node config drawer — pure field/coercion helpers and label tables
 *
 * Field value seeding/coercion, required-field validation, parallel-child
 * normalization, the human-facing label/help/placeholder tables, and the
 * shared form styling constants. All pure (operate on step records +
 * FormField metadata); zero JSX. Extracted from node-config-drawer.tsx so the
 * form logic is unit-testable without jsdom, following the
 * lib/canvas-editor-state precedent.
 */
import type { FormField } from '@bakin/core/workflows/node-type-registry'

/**
 * Client-safe bridge: browser components reach the node-type registry
 * through this lib module instead of importing `@bakin/core` directly
 * (same pattern as `lib/team-token.ts`).
 */
export { getNodeType } from '@bakin/core/workflows/node-type-registry'
export type { FormField, EdgeRules } from '@bakin/core/workflows/node-type-registry'

export type ParallelChildRow = {
  id: string
  type: string
  label: string
  [k: string]: unknown
}

export type WorkflowSelectOption = {
  id: string
  name: string
  disabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDrawerEditableField(kind: string, field: FormField): boolean {
  return !(kind === 'parallel' && field.name === 'steps')
}

function coerceListInput(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function fieldInitialValue(step: Record<string, unknown>, field: FormField): unknown {
  const raw = step[field.name]
  if (raw === undefined || raw === null) {
    if (field.type === 'boolean') return false
    if (field.type === 'list') return ''
    return ''
  }
  if (field.name === 'on_reject' && isRecord(raw)) return raw.goto ?? ''
  if (field.type === 'list' && Array.isArray(raw)) return raw.join(', ')
  if (field.type === 'text' && isRecord(raw)) return JSON.stringify(raw, null, 2)
  return raw
}

export function coerceFieldValue(step: Record<string, unknown>, field: FormField, value: unknown): unknown {
  if (field.name === 'on_reject') {
    if (typeof value !== 'string' || value.trim().length === 0) return undefined
    return {
      ...(isRecord(step.on_reject) ? step.on_reject : {}),
      goto: value.trim(),
    }
  }
  if (field.name === 'content' && field.type === 'text' && typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error('Enter valid JSON object content.')
    }
    if (!isRecord(parsed)) {
      throw new Error('Enter a JSON object such as {"summary": "..."}.')
    }
    return parsed
  }
  if (field.type === 'list' && typeof value === 'string') return coerceListInput(value)
  return value
}

export function normalizeParallelChildren(step: Record<string, unknown> | null): ParallelChildRow[] {
  if (!step || !Array.isArray(step.steps)) return []
  return step.steps
    .filter(isRecord)
    .map((child) => ({
      ...child,
      id: typeof child.id === 'string' ? child.id : '',
      type: typeof child.type === 'string' ? child.type : 'agent',
      label: typeof child.label === 'string' ? child.label : String(child.id ?? ''),
    }))
}

export function nextChildId(children: ParallelChildRow[]): string {
  const existing = new Set(children.map((child) => child.id))
  for (let i = 1; i < 1000; i++) {
    const id = `child-${i}`
    if (!existing.has(id)) return id
  }
  return `child-${Date.now()}`
}

export function isMissingRequiredField(field: FormField, value: unknown): boolean {
  if (!field.required) return false
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function requiredFieldMessage(field: FormField): string {
  if (field.type === 'agent') return 'Choose an agent.'
  if (field.name === 'workflow_id') return 'Select a workflow.'
  if (field.type === 'select') return `Select ${fieldLabel(field).toLowerCase()}.`
  return `Enter ${fieldLabel(field).toLowerCase()}.`
}

export function schemaIssueMessage(field: FormField, message: string): string {
  if (message.toLowerCase().includes('required')) return requiredFieldMessage(field)
  return message
}

function humanizeIdentifier(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

const FIELD_LABELS: Record<string, string> = {
  agent: 'Agent',
  skill: 'Skill instructions',
  task: 'Task brief',
  description: 'Detailed instructions',
  deny_tools: 'Denied tools',
  approval_required: 'Require approval',
  on_reject: 'Rejected path',
  preview: 'Preview fields',
  channels: 'Notification channels',
  content: 'Output content',
  schedule: 'Schedule',
  workflow_id: 'Nested workflow',
  source: 'Source array',
  item_key: 'Item key',
  max_children: 'Max children',
  title: 'Task title',
  column: 'Starting column',
  workflowId: 'Attached workflow',
  availableAt: 'Available after',
  dueAt: 'Due date',
}

const FIELD_HELP_TEXT: Record<string, string> = {
  agent: 'Choose who should run this step. Use Assigned agent to reuse the task assignee, or a team to route to the best-suited member at dispatch.',
  skill: 'Optional skill or instruction bundle to load before the agent works.',
  task: 'Short, concrete instruction for the agent. Use one or two sentences.',
  description: 'Longer context, constraints, or acceptance criteria for this step.',
  deny_tools: 'Optional comma-separated tool names the agent may not call during this step.',
  approval_required: 'Require a human decision before the workflow can continue.',
  on_reject: 'Step ID to return to after rejection. Leave blank when rejection should not rewind.',
  preview: 'Comma-separated output keys to show in the approval preview.',
  channels: 'Comma-separated channels or destinations for the final output.',
  content: 'Structured output content. Enter JSON when this step needs fixed output keys.',
  schedule: 'Cron schedule for recurring output delivery.',
  workflow_id: 'Select the workflow that this nested workflow step should run.',
  source: 'Earlier step output holding the array, as <stepId>.<outputKey> — one child runs per element.',
  item_key: 'Parent-context key each child sees its item under. Defaults to "item".',
  max_children: 'Fan-out width guardrail. Wider source arrays fail before any child spawns. Defaults to 32.',
  title: 'Title for the task this workflow will create.',
  column: 'Board column where the created task should start.',
  workflowId: 'Optional workflow ID to attach to the created task.',
  availableAt: 'Optional ISO timestamp before which the task should not dispatch.',
  dueAt: 'Optional ISO timestamp for the desired completion time.',
}

const FIELD_PLACEHOLDERS: Record<string, string> = {
  skill: 'brand-voice',
  task: 'Write a concise post caption for the approved brief.',
  description: 'Include caption text, target platform notes, hashtags, and any required mentions.',
  deny_tools: 'web.run, shell.exec',
  on_reject: 'revise-copy',
  preview: 'caption, hashtags, mentions',
  channels: 'general, announcements',
  content: '{"summary": "...", "assetPath": "..."}',
  schedule: '0 9 * * 1',
  title: 'Draft launch announcement',
  workflowId: 'social-post',
  availableAt: '2026-05-25T14:00:00Z',
  dueAt: '2026-05-26T18:00:00Z',
}

const STEP_KIND_LABELS: Record<string, string> = {
  agent: 'Agent step',
  gate: 'Approval gate',
  output: 'Completion step',
  workflow: 'Nested workflow',
  map_workflow: 'Map fan-out',
  parallel: 'Parallel group',
  createTask: 'Task creation step',
}

export function fieldLabel(field: FormField): string {
  return FIELD_LABELS[field.name] ?? humanizeIdentifier(field.name)
}

export function fieldHelpText(field: FormField): string | undefined {
  return FIELD_HELP_TEXT[field.name] ?? field.description
}

export function fieldPlaceholder(field: FormField): string | undefined {
  return FIELD_PLACEHOLDERS[field.name]
}

export function stepKindLabel(kind: string): string {
  if (!kind) return 'Unknown step'
  if (STEP_KIND_LABELS[kind]) return STEP_KIND_LABELS[kind]
  const localKind = kind.includes('.') ? kind.split('.').slice(1).join(' ') : kind
  return `${humanizeIdentifier(localKind)} step`
}

export const FIELD_GROUP_CLASS = 'space-y-2.5'
export const FIELD_LABEL_CLASS = 'text-sm font-medium leading-none'
export const FIELD_HELP_CLASS = 'text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted/60'
export const CONTROL_CLASS = 'min-h-10 text-sm'
export const TEXTAREA_CLASS = 'min-h-24 text-sm leading-relaxed'
