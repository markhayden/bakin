'use client'

/**
 * Inline node config drawer.
 *
 * Opens when a node is clicked on the canvas editor. Renders a form
 * generated from the selected node type's `formFields` metadata and
 * validates the merged step payload against the node type's Zod schema
 * before Apply, so the drawer and the loader cannot drift.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"
import { Textarea } from "@makinbakin/sdk/ui"
import { Label } from "@makinbakin/sdk/ui"
import { Checkbox } from "@makinbakin/sdk/ui"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@makinbakin/sdk/ui"
import { AgentSelect } from "@makinbakin/sdk/components"
import { getNodeType, type FormField } from '@bakin/core/workflows/node-type-registry'

export interface NodeConfigDrawerProps {
  /** Step currently under edit, or null when nothing selected. */
  step: {
    id: string
    type: string
    label: string
    [k: string]: unknown
  } | null
  /** Kind to use when step.type isn't registered (plugin hasn't shipped yet). */
  fallbackKind?: string
  /** Called when the user Applies; payload preserves fields the form does not own. */
  onApply: (patch: Record<string, unknown>) => void
  onDelete?: () => void
  onClose: () => void
  onDirtyChange?: (dirty: boolean) => void
  existingStepIds?: string[]
  reservedStepIds?: string[]
}

type ParallelChildRow = {
  id: string
  type: string
  label: string
  [k: string]: unknown
}

type WorkflowSelectOption = {
  id: string
  name: string
  disabled?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDrawerEditableField(kind: string, field: FormField): boolean {
  return field.name !== 'dependsOn' && !(kind === 'parallel' && field.name === 'steps')
}

function coerceListInput(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function fieldInitialValue(step: Record<string, unknown>, field: FormField): unknown {
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

function coerceFieldValue(step: Record<string, unknown>, field: FormField, value: unknown): unknown {
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

function normalizeParallelChildren(step: Record<string, unknown> | null): ParallelChildRow[] {
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

function nextChildId(children: ParallelChildRow[]): string {
  const existing = new Set(children.map((child) => child.id))
  for (let i = 1; i < 1000; i++) {
    const id = `child-${i}`
    if (!existing.has(id)) return id
  }
  return `child-${Date.now()}`
}

function isMissingRequiredField(field: FormField, value: unknown): boolean {
  if (!field.required) return false
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return false
}

function requiredFieldMessage(field: FormField): string {
  if (field.type === 'agent') return 'Choose an agent.'
  if (field.name === 'workflow_id') return 'Select a workflow.'
  if (field.type === 'select') return `Select ${fieldLabel(field).toLowerCase()}.`
  return `Enter ${fieldLabel(field).toLowerCase()}.`
}

function schemaIssueMessage(field: FormField, message: string): string {
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
  on_approve: 'Approved path',
  on_reject: 'Rejected path',
  preview: 'Preview fields',
  channels: 'Notification channels',
  content: 'Output content',
  schedule: 'Schedule',
  workflow_id: 'Nested workflow',
  title: 'Task title',
  column: 'Starting column',
  workflowId: 'Attached workflow',
  availableAt: 'Available after',
  dueAt: 'Due date',
}

const FIELD_HELP_TEXT: Record<string, string> = {
  agent: 'Choose who should run this step. Use Assigned agent to reuse the task assignee.',
  skill: 'Optional skill or instruction bundle to load before the agent works.',
  task: 'Short, concrete instruction for the agent. Use one or two sentences.',
  description: 'Longer context, constraints, or acceptance criteria for this step.',
  deny_tools: 'Optional comma-separated tool names the agent may not call during this step.',
  approval_required: 'Require a human decision before the workflow can continue.',
  on_approve: 'Step ID to run after approval. Use done when this approval completes the workflow.',
  on_reject: 'Step ID to return to after rejection. Leave blank when rejection should not rewind.',
  preview: 'Comma-separated output keys to show in the approval preview.',
  channels: 'Comma-separated channels or destinations for the final output.',
  content: 'Structured output content. Enter JSON when this step needs fixed output keys.',
  schedule: 'Cron schedule for recurring output delivery.',
  workflow_id: 'Select the workflow that this nested workflow step should run.',
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
  on_approve: 'review-copy or done',
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
  parallel: 'Parallel group',
  createTask: 'Task creation step',
}

function fieldLabel(field: FormField): string {
  return FIELD_LABELS[field.name] ?? humanizeIdentifier(field.name)
}

function fieldHelpText(field: FormField): string | undefined {
  return FIELD_HELP_TEXT[field.name] ?? field.description
}

function fieldPlaceholder(field: FormField): string | undefined {
  return FIELD_PLACEHOLDERS[field.name]
}

function stepKindLabel(kind: string): string {
  if (!kind) return 'Unknown step'
  if (STEP_KIND_LABELS[kind]) return STEP_KIND_LABELS[kind]
  const localKind = kind.includes('.') ? kind.split('.').slice(1).join(' ') : kind
  return `${humanizeIdentifier(localKind)} step`
}

const FIELD_GROUP_CLASS = 'space-y-2.5'
const FIELD_LABEL_CLASS = 'text-sm font-medium leading-none'
const FIELD_HELP_CLASS = 'text-xs leading-relaxed text-muted-foreground/60'
const CONTROL_CLASS = 'min-h-10 text-sm'
const TEXTAREA_CLASS = 'min-h-24 text-sm leading-relaxed'

export function NodeConfigDrawer({
  step,
  fallbackKind,
  onApply,
  onDelete,
  onClose,
  onDirtyChange,
  existingStepIds = [],
  reservedStepIds = [],
}: NodeConfigDrawerProps) {
  const kind = step?.type ?? fallbackKind ?? ''
  const def = useMemo(() => (kind ? getNodeType(kind) : undefined), [kind])
  const editableFields = useMemo(
    () => (def?.formFields ?? []).filter((field) => isDrawerEditableField(kind, field)),
    [def, kind],
  )
  const needsWorkflowOptions = editableFields.some((field) => field.name === 'workflow_id')

  // The parent remounts this component via `key` when `step.id`/`step.type`
  // changes, so lazy state initializers from props are safe here.
  const [id, setId] = useState(step?.id ?? '')
  const [label, setLabel] = useState(step?.label ?? '')
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => {
    const seeded: Record<string, unknown> = {}
    if (step && def) {
      for (const field of def.formFields.filter((f) => isDrawerEditableField(kind, f))) {
        seeded[field.name] = fieldInitialValue(step, field)
      }
    }
    return seeded
  })
  const [parallelChildren, setParallelChildren] = useState<ParallelChildRow[]>(() => normalizeParallelChildren(step))
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowSelectOption[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [idError, setIdError] = useState<string | null>(null)
  const [labelError, setLabelError] = useState<string | null>(null)
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set())
  const [errors, setErrors] = useState<string[]>([])

  function markDirty(fieldName?: string) {
    if (fieldName) {
      setDirtyFields((prev) => {
        const next = new Set(prev)
        next.add(fieldName)
        return next
      })
    }
    onDirtyChange?.(true)
  }

  useEffect(() => {
    if (!needsWorkflowOptions) return
    let cancelled = false

    async function loadWorkflowOptions() {
      try {
        const res = await fetch('/api/plugins/workflows/definitions?includeDisabled=1')
        if (!res.ok) return
        const data = (await res.json()) as {
          templates?: Array<{ filename: string; name: string; disabled?: boolean }>
        }
        if (cancelled) return
        setWorkflowOptions(
          (data.templates ?? []).map((template) => ({
            id: template.filename,
            name: template.name,
            disabled: template.disabled,
          })),
        )
      } catch {
        if (!cancelled) setWorkflowOptions([])
      }
    }

    void loadWorkflowOptions()
    return () => {
      cancelled = true
    }
  }, [needsWorkflowOptions])

  if (!step) return null

  if (!def) {
    return (
      <aside className="flex w-[28rem] flex-col border-l border-border bg-card">
        <DrawerHeader onClose={onClose} title={stepKindLabel(kind)} />
        <div className="flex-1 p-5 text-sm leading-relaxed text-amber-300">
          No registered node type for <code>{kind || '(missing)'}</code>. Step is preserved
          but cannot be edited here - the plugin may not be active.
        </div>
        {onDelete && (
          <div className="border-t border-border p-5">
            <Button type="button" size="sm" variant="destructive" onClick={onDelete}>
              <Trash2 className="mr-1 size-3.5" />
              Delete step
            </Button>
          </div>
        )}
      </aside>
    )
  }

  function handleApply() {
    if (!def || !step) return
    const nextFieldErrors: Record<string, string> = {}
    const nextId = id.trim()
    const nextLabel = label.trim()
    let nextIdError: string | null = null
    let nextLabelError: string | null = null

    if (!nextId) {
      nextIdError = 'Enter a step ID.'
    } else if (reservedStepIds.includes(nextId)) {
      nextIdError = 'This step ID is reserved by the editor.'
    } else if (nextId !== step.id && existingStepIds.includes(nextId)) {
      nextIdError = 'Step IDs must be unique.'
    }
    if (!nextLabel) nextLabelError = 'Enter a display name.'

    for (const field of editableFields) {
      if (isMissingRequiredField(field, fieldValues[field.name])) {
        nextFieldErrors[field.name] = requiredFieldMessage(field)
      }
    }
    if (nextIdError || nextLabelError || Object.keys(nextFieldErrors).length > 0) {
      setIdError(nextIdError)
      setLabelError(nextLabelError)
      setFieldErrors(nextFieldErrors)
      setErrors([])
      return
    }
    setIdError(null)
    setLabelError(null)

    // Build the full candidate step from the existing YAML-backed object so
    // fields outside this form survive a no-op edit.
    const coerced: Record<string, unknown> = {}
    for (const field of editableFields) {
      const v = fieldValues[field.name]
      if (v === '' || v === undefined || v === null) {
        // Omit empty — the Zod `.optional()` branches accept missing keys.
        // Only dirty empty fields are deleted below. Unchanged empty values
        // from YAML remain untouched so Apply is not destructive.
        continue
      }
      try {
        const nextValue = coerceFieldValue(step, field, v)
        if (nextValue !== undefined) coerced[field.name] = nextValue
      } catch (error) {
        nextFieldErrors[field.name] = (error as Error).message
      }
    }
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      setErrors([])
      return
    }

    const candidate: Record<string, unknown> = {
      ...step,
      id: nextId,
      type: kind,
      label: nextLabel,
      ...coerced,
    }
    for (const field of editableFields) {
      const v = fieldValues[field.name]
      if ((v === '' || v === undefined || v === null) && dirtyFields.has(field.name)) {
        delete candidate[field.name]
      }
    }
    if (kind === 'parallel') candidate.steps = parallelChildren

    const result = def.zodSchema.safeParse(candidate)
    if (!result.success) {
      const fieldsByName = new Map(editableFields.map((field) => [field.name, field]))
      const schemaFieldErrors: Record<string, string> = {}
      const generalErrors: string[] = []
      for (const issue of result.error.issues) {
        const fieldName = typeof issue.path[0] === 'string' ? issue.path[0] : ''
        const field = fieldsByName.get(fieldName)
        if (field) {
          schemaFieldErrors[fieldName] = schemaIssueMessage(field, issue.message)
        } else {
          generalErrors.push(`${issue.path.join('.') || 'step'}: ${issue.message}`)
        }
      }
      setFieldErrors(schemaFieldErrors)
      setErrors(generalErrors)
      return
    }
    setFieldErrors({})
    setDirtyFields(new Set())
    onDirtyChange?.(false)
    setErrors([])
    const validated = (result.data ?? {}) as Record<string, unknown>
    onApply({ ...validated, id: nextId, label: nextLabel })
  }

  function updateFieldValue(fieldName: string, value: unknown) {
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }))
    markDirty(fieldName)
    setFieldErrors((prev) => {
      if (!prev[fieldName]) return prev
      const next = { ...prev }
      delete next[fieldName]
      return next
    })
  }

  const canApply = id.trim().length > 0 && label.trim().length > 0

  return (
    <aside className="flex w-[28rem] flex-col border-l border-border bg-card">
      <DrawerHeader onClose={onClose} title={stepKindLabel(kind)} />

      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-6">
          <div className={FIELD_GROUP_CLASS}>
            <Label className={FIELD_LABEL_CLASS} htmlFor="node-config-id">Step ID</Label>
            <Input
              id="node-config-id"
              value={id}
              onChange={(e) => {
                setId(e.target.value)
                setIdError(null)
                markDirty()
              }}
              placeholder="write-copy"
              className={CONTROL_CLASS}
              aria-invalid={Boolean(idError) || undefined}
              aria-describedby={idError ? 'node-config-id-error' : undefined}
            />
            {idError && (
              <p id="node-config-id-error" className="text-xs font-medium leading-relaxed text-red-300">
                {idError}
              </p>
            )}
            <p className={FIELD_HELP_CLASS}>
              Stable identifier used by workflow links and approval paths.
            </p>
          </div>
          <div className={FIELD_GROUP_CLASS}>
            <Label className={FIELD_LABEL_CLASS} htmlFor="node-config-label">Display name</Label>
            <Input
              id="node-config-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value)
                setLabelError(null)
                markDirty()
              }}
              placeholder="Write Copy"
              className={CONTROL_CLASS}
              aria-invalid={Boolean(labelError) || undefined}
              aria-describedby={labelError ? 'node-config-label-error' : undefined}
            />
            {labelError && (
              <p id="node-config-label-error" className="text-xs font-medium leading-relaxed text-red-300">
                {labelError}
              </p>
            )}
            <p className={FIELD_HELP_CLASS}>
              Human-readable name shown on the canvas node.
            </p>
          </div>

          {editableFields.map((field) => {
            const fieldError = fieldErrors[field.name]
            const errorId = fieldError ? `node-config-${field.name}-error` : undefined

            return (
              <div key={field.name} className={FIELD_GROUP_CLASS}>
                <Label
                  className={`${FIELD_LABEL_CLASS} ${fieldError ? 'text-red-300' : ''}`}
                  htmlFor={`node-config-${field.name}`}
                >
                  {fieldLabel(field)}
                  {field.required && <span className="ml-1 text-red-400">*</span>}
                </Label>
                <FieldControl
                  field={field}
                  value={fieldValues[field.name]}
                  workflowOptions={workflowOptions}
                  invalid={Boolean(fieldError)}
                  describedBy={errorId}
                  onChange={(v) => updateFieldValue(field.name, v)}
                />
                {fieldError && (
                  <p id={errorId} className="text-xs font-medium leading-relaxed text-red-300">
                    {fieldError}
                  </p>
                )}
                {fieldHelpText(field) && (
                  <p className={FIELD_HELP_CLASS}>{fieldHelpText(field)}</p>
                )}
              </div>
            )
          })}

          {Boolean(step.dependsOn) && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
              dependsOn is preserved as metadata. This editor does not author runtime dependencies.
            </div>
          )}

          {kind === 'parallel' && (
            <ParallelChildrenEditor
              childrenRows={parallelChildren}
              onChange={(next) => {
                setParallelChildren(next)
                markDirty('steps')
              }}
            />
          )}

          {errors.length > 0 && (
            <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
              <ul className="list-disc pl-4">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border p-5">
        {onDelete && (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={onDelete}
          >
            <Trash2 className="mr-1 size-3.5" />
            Delete
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleApply} disabled={!canApply}>
            Apply
          </Button>
        </div>
      </div>
    </aside>
  )
}

function DrawerHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string
  subtitle?: string
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3">
      <div className="flex flex-col leading-tight">
        <span className="text-base font-medium">{title}</span>
        {subtitle && <span className="text-xs text-muted-foreground/60">{subtitle}</span>}
      </div>
      <button
        type="button"
        aria-label="Close drawer"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

function ParallelChildrenEditor({
  childrenRows,
  onChange,
}: {
  childrenRows: ParallelChildRow[]
  onChange: (next: ParallelChildRow[]) => void
}) {
  const updateChild = (index: number, patch: Record<string, unknown>) => {
    onChange(childrenRows.map((child, i) => (i === index ? { ...child, ...patch } : child)))
  }
  const removeChild = (index: number) => {
    onChange(childrenRows.filter((_, i) => i !== index))
  }
  const moveChild = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta
    if (nextIndex < 0 || nextIndex >= childrenRows.length) return
    const next = [...childrenRows]
    const [moved] = next.splice(index, 1)
    next.splice(nextIndex, 0, moved)
    onChange(next)
  }
  const addChild = () => {
    const id = nextChildId(childrenRows)
    onChange([
      ...childrenRows,
      {
        id,
        type: 'agent',
        label: id,
        agent: '$assigned',
      },
    ])
  }

  return (
    <div className="border-t border-border pt-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Parallel child steps</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addChild}
          aria-label="Add child agent"
        >
          <Plus className="mr-1 size-3.5" /> Agent
        </Button>
      </div>
      <div className="space-y-5">
        {childrenRows.map((child, index) => {
          const childId = child.id || `child-${index + 1}`
          if (child.type !== 'agent') {
            return (
              <div key={`${childId}-${index}`} className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-200">
                Child {childId} has unsupported type {child.type}; it is preserved read-only.
              </div>
            )
          }
          return (
            <div key={`${childId}-${index}`} className="rounded border border-border p-4">
              <div className="mb-4 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">{child.label || childId}</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move child ${childId} up`}
                    onClick={() => moveChild(index, -1)}
                    disabled={index === 0}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Move child ${childId} down`}
                    onClick={() => moveChild(index, 1)}
                    disabled={index === childrenRows.length - 1}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove child ${childId}`}
                    onClick={() => removeChild(index)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid gap-5">
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-id`}>
                    Child step ID
                  </Label>
                  <Input
                    id={`parallel-child-${index}-id`}
                    aria-label={`Child step ID for ${childId}`}
                    value={child.id}
                    placeholder="write-caption"
                    className={CONTROL_CLASS}
                    onChange={(e) => updateChild(index, { id: e.target.value })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Stable identifier used by workflow links.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-label`}>
                    Display name
                  </Label>
                  <Input
                    id={`parallel-child-${index}-label`}
                    aria-label={`Display name for child ${childId}`}
                    value={child.label}
                    placeholder="Write Caption"
                    className={CONTROL_CLASS}
                    onChange={(e) => updateChild(index, { label: e.target.value })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Human-readable name shown inside the parallel group.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS}>Agent</Label>
                  <AgentSelect
                    value={typeof child.agent === 'string' ? child.agent : ''}
                    onValueChange={(v) => updateChild(index, { agent: v || '' })}
                    includeAssigned
                    allowNone={false}
                    className={CONTROL_CLASS}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Choose who should run this child step.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-skill`}>
                    Skill instructions
                  </Label>
                  <Input
                    id={`parallel-child-${index}-skill`}
                    aria-label={`Skill instructions for child ${childId}`}
                    value={typeof child.skill === 'string' ? child.skill : ''}
                    placeholder="brand-voice"
                    className={CONTROL_CLASS}
                    onChange={(e) => updateChild(index, { skill: e.target.value || undefined })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Optional skill or instruction bundle to load first.
                  </p>
                </div>
                <div className={FIELD_GROUP_CLASS}>
                  <Label className={FIELD_LABEL_CLASS} htmlFor={`parallel-child-${index}-task`}>
                    Task brief
                  </Label>
                  <Textarea
                    id={`parallel-child-${index}-task`}
                    aria-label={`Task brief for child ${childId}`}
                    rows={3}
                    value={typeof child.task === 'string' ? child.task : ''}
                    placeholder="Draft the caption for this audience segment."
                    className={TEXTAREA_CLASS}
                    onChange={(e) => updateChild(index, { task: e.target.value || undefined })}
                  />
                  <p className={FIELD_HELP_CLASS}>
                    Short, concrete instruction for this child agent.
                  </p>
                </div>
              </div>
            </div>
          )
        })}
        {childrenRows.length === 0 && (
          <div className="rounded border border-border p-3 text-xs leading-relaxed text-muted-foreground">
            Add at least one child agent before saving this parallel step.
          </div>
        )}
      </div>
    </div>
  )
}

function FieldControl({
  field,
  value,
  workflowOptions,
  invalid,
  describedBy,
  onChange,
}: {
  field: FormField
  value: unknown
  workflowOptions?: WorkflowSelectOption[]
  invalid?: boolean
  describedBy?: string
  onChange: (v: unknown) => void
}) {
  const str = (value ?? '') as string
  const placeholder = fieldPlaceholder(field)
  if (field.name === 'workflow_id') {
    const options = workflowOptions ?? []
    const hasCurrent = str.length > 0 && !options.some((option) => option.id === str)
    return (
      <Select value={str} onValueChange={(v) => onChange(v || undefined)}>
        <SelectTrigger
          id={`node-config-${field.name}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={CONTROL_CLASS}
        >
          <SelectValue placeholder="Choose a workflow..." />
        </SelectTrigger>
        <SelectContent>
          {hasCurrent && <SelectItem value={str}>{str}</SelectItem>}
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
              {option.disabled ? ' (disabled)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  switch (field.type) {
    case 'text':
      return (
        <Textarea
          id={`node-config-${field.name}`}
          rows={3}
          value={str}
          placeholder={placeholder}
          className={TEXTAREA_CLASS}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          id={`node-config-${field.name}`}
          type="number"
          value={value === undefined || value === null ? '' : (value as number)}
          placeholder={placeholder}
          className={CONTROL_CLASS}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            if (e.target.value.trim() === '') {
              onChange(undefined)
              return
            }
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? n : undefined)
          }}
        />
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Checkbox
            id={`node-config-${field.name}`}
            checked={Boolean(value)}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            onCheckedChange={(v) => onChange(v === true)}
          />
        </div>
      )
    case 'select':
      return (
        <Select value={str} onValueChange={(v) => onChange(v || undefined)}>
          <SelectTrigger
            id={`node-config-${field.name}`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={CONTROL_CLASS}
          >
            <SelectValue placeholder="Choose an option..." />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'agent':
      return (
        <AgentSelect
          id={`node-config-${field.name}`}
          value={str}
          onValueChange={(v) => onChange(v || undefined)}
          includeAssigned
          allowNone={!field.required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={
            invalid
              ? `${CONTROL_CLASS} border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40`
              : CONTROL_CLASS
          }
        />
      )
    case 'skill':
    case 'string':
      return (
        <Input
          id={`node-config-${field.name}`}
          value={str}
          placeholder={placeholder}
          className={CONTROL_CLASS}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'list':
      return (
        <Input
          id={`node-config-${field.name}`}
          value={str}
          className={CONTROL_CLASS}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'alpha, beta, gamma'}
        />
      )
  }
}
