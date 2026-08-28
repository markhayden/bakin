'use client'

/**
 * Inline node config panel.
 *
 * Opens when a node is clicked on the canvas editor. Renders a form
 * generated from the selected node type's `formFields` metadata and
 * validates the merged step payload against the node type's Zod schema
 * before Apply, so the panel and the loader cannot drift.
 *
 * Composition: the vetted InspectorPanel pattern (the canvas-adjacent
 * inspector from Recipes/Workflow and action pages). Pure field/coercion
 * helpers live in `lib/node-config-fields`; the parallel-children editor is
 * a sibling component (FW4 split).
 */

import { useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@makinbakin/sdk/ui'
import {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
} from '@makinbakin/sdk/patterns'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import { WorkflowAgentSelect } from './workflow-agent-identity'

import {
  type ParallelChildRow,
  type WorkflowSelectOption,
  type FormField,
  getNodeType,
  isDrawerEditableField,
  fieldInitialValue,
  coerceFieldValue,
  normalizeParallelChildren,
  isMissingRequiredField,
  requiredFieldMessage,
  schemaIssueMessage,
  fieldLabel,
  fieldHelpText,
  fieldPlaceholder,
  stepKindLabel,
} from '../lib/node-config-fields'
import { ParallelChildrenEditor } from './parallel-children-editor'

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

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <InspectorPanelHeader
      title={title}
      actions={(
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close drawer"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      )}
    />
  )
}

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

  const { data: workflowOptionsData } = useJsonFetch<{
    templates?: Array<{ filename: string; name: string; disabled?: boolean }>
  }>(needsWorkflowOptions ? '/api/plugins/workflows/definitions?includeDisabled=1' : null)
  const workflowOptions = useMemo<WorkflowSelectOption[]>(
    () =>
      (workflowOptionsData?.templates ?? []).map((template) => ({
        id: template.filename,
        name: template.name,
        disabled: template.disabled,
      })),
    [workflowOptionsData],
  )

  if (!step) return null

  if (!def) {
    return (
      <InspectorPanel label="Step configuration" side>
        <PanelHeader onClose={onClose} title={stepKindLabel(kind)} />
        <InspectorPanelContent>
          <Alert tone="attention">
            <AlertDescription>
              No registered node type for <code>{kind || '(missing)'}</code>. Step is preserved
              but cannot be edited here - the plugin may not be active.
            </AlertDescription>
          </Alert>
        </InspectorPanelContent>
        {onDelete && (
          <InspectorPanelFooter className="justify-start">
            <Button type="button" size="sm" variant="danger" onClick={onDelete}>
              <Trash2 className="mr-1 size-3.5" />
              Delete step
            </Button>
          </InspectorPanelFooter>
        )}
      </InspectorPanel>
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
    <InspectorPanel label="Step configuration" side>
      <PanelHeader onClose={onClose} title={stepKindLabel(kind)} />

      <InspectorPanelContent>
        <FieldGroup>
          <Field name="id" invalid={Boolean(idError)}>
            <FieldLabel htmlFor="node-config-id" requirement="required">Step ID</FieldLabel>
            <Input
              id="node-config-id"
              value={id}
              onChange={(e) => {
                setId(e.target.value)
                setIdError(null)
                markDirty()
              }}
              placeholder="write-copy"
              aria-invalid={Boolean(idError) || undefined}
              aria-describedby={idError ? 'node-config-id-error' : undefined}
            />
            {idError && (
              <FieldError id="node-config-id-error" match>{idError}</FieldError>
            )}
            <FieldDescription>
              Stable identifier used by workflow links and approval paths.
            </FieldDescription>
          </Field>
          <Field name="label" invalid={Boolean(labelError)}>
            <FieldLabel htmlFor="node-config-label" requirement="required">Display name</FieldLabel>
            <Input
              id="node-config-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value)
                setLabelError(null)
                markDirty()
              }}
              placeholder="Write Copy"
              aria-invalid={Boolean(labelError) || undefined}
              aria-describedby={labelError ? 'node-config-label-error' : undefined}
            />
            {labelError && (
              <FieldError id="node-config-label-error" match>{labelError}</FieldError>
            )}
            <FieldDescription>
              Human-readable name shown on the canvas node.
            </FieldDescription>
          </Field>

          {editableFields.map((field) => {
            const fieldError = fieldErrors[field.name]
            const errorId = fieldError ? `node-config-${field.name}-error` : undefined
            const helpText = fieldHelpText(field)
            // Boolean fields put the checkbox beside its label; everything
            // else stacks label over control.
            const horizontal = field.type === 'boolean'
            const control = (
              <NodeFieldRenderer
                field={field}
                value={fieldValues[field.name]}
                workflowOptions={workflowOptions}
                invalid={Boolean(fieldError)}
                describedBy={errorId}
                onChange={(v) => updateFieldValue(field.name, v)}
              />
            )

            return (
              <Field
                key={field.name}
                name={field.name}
                orientation={horizontal ? 'horizontal' : 'vertical'}
                invalid={Boolean(fieldError)}
              >
                {horizontal ? control : null}
                <FieldLabel
                  htmlFor={`node-config-${field.name}`}
                  requirement={field.required ? 'required' : undefined}
                >
                  {fieldLabel(field)}
                </FieldLabel>
                {horizontal ? null : control}
                {fieldError && (
                  <FieldError id={errorId} match>{fieldError}</FieldError>
                )}
                {helpText && <FieldDescription>{helpText}</FieldDescription>}
              </Field>
            )
          })}
        </FieldGroup>

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
          <Alert tone="danger">
            <AlertTitle>Fix these before applying</AlertTitle>
            <AlertDescription>
              <ul className="m-0 grid gap-bakin-1 pl-bakin-4">
                {errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </InspectorPanelContent>

      <InspectorPanelFooter className="justify-between">
        {onDelete && (
          <Button
            type="button"
            size="sm"
            variant="danger"
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
      </InspectorPanelFooter>
    </InspectorPanel>
  )
}

/** Renders the control for one `FormField`; the enclosing `Field` owns label/error/help. */
function NodeFieldRenderer({
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
        <FieldControl
          render={(
            <Textarea
              id={`node-config-${field.name}`}
              rows={3}
              value={str}
              placeholder={placeholder}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        />
      )
    case 'number':
      return (
        <Input
          id={`node-config-${field.name}`}
          type="number"
          value={value === undefined || value === null ? '' : (value as number)}
          placeholder={placeholder}
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
        <Checkbox
          id={`node-config-${field.name}`}
          checked={Boolean(value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onCheckedChange={(v) => onChange(v === true)}
        />
      )
    case 'select':
      return (
        <Select value={str} onValueChange={(v) => onChange(v || undefined)}>
          <SelectTrigger
            id={`node-config-${field.name}`}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
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
        <WorkflowAgentSelect
          id={`node-config-${field.name}`}
          value={str}
          onValueChange={(v) => onChange(v || undefined)}
          includeAssigned
          allowNone={!field.required}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
      )
    case 'skill':
    case 'string':
      return (
        <Input
          id={`node-config-${field.name}`}
          value={str}
          placeholder={placeholder}
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
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'alpha, beta, gamma'}
        />
      )
  }
}
