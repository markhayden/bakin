'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
  Form,
  FormActions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SubmitButton,
  Switch,
} from '@bakin/ui'
import type {
  BooleanSettingsField,
  ListSettingsField,
  NumberSettingsField,
  PluginSettingsSchema,
  SelectSettingsField,
  SettingsField,
  StringSettingsField,
} from '../types'

type ScalarSettingsField =
  | StringSettingsField
  | NumberSettingsField
  | BooleanSettingsField
  | SelectSettingsField

export interface PluginSettingsFeedback {
  tone: 'success' | 'error'
  title: string
  description?: string
}

export interface PluginSettingsRendererProps {
  schema: PluginSettingsSchema
  values: Record<string, unknown>
  /** Persistence stays consumer-owned; this fires only after schema validation passes. */
  onSubmit: (values: Record<string, unknown>) => void
  /** Consumer-owned persistence state. */
  busy?: boolean
  disabled?: boolean
  /** Durable consumer-owned save result rendered adjacent to the form. */
  feedback?: PluginSettingsFeedback | null
  /** Optional notification hook for analytics or compatibility feedback such as toasts. */
  onValidationError?: (message: string) => void
  onReset?: () => void
  saveLabel?: string
  busyLabel?: string
  resetLabel?: string
  ariaLabel?: string
  className?: string
}

function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

function defaultForField(field: SettingsField): unknown {
  if (field.default !== undefined) return field.default
  switch (field.type) {
    case 'boolean': return false
    case 'number': return 0
    case 'list': return []
    default: return ''
  }
}

function initialValues(
  schema: PluginSettingsSchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(schema.fields.map((field) => [
    field.key,
    values[field.key] ?? defaultForField(field),
  ]))
}

function initialRow(itemShape: ListSettingsField['itemShape']): Record<string, unknown> {
  return Object.fromEntries(Object.entries(itemShape).map(([key, field]) => [key, defaultForField(field)]))
}

function empty(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.trim() === '')
    || (typeof value === 'number' && Number.isNaN(value))
}

function listError(field: ListSettingsField, value: unknown): string | null {
  const rows = Array.isArray(value) ? value : []
  const minimum = field.minItems ?? (field.required ? 1 : undefined)
  if (minimum !== undefined && rows.length < minimum) {
    return `${field.label}: needs at least ${minimum} ${minimum === 1 ? 'item' : 'items'}`
  }
  if (field.maxItems !== undefined && rows.length > field.maxItems) {
    return `${field.label}: no more than ${field.maxItems} ${field.maxItems === 1 ? 'item' : 'items'}`
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] as Record<string, unknown>
    for (const [key, subfield] of Object.entries(field.itemShape)) {
      if (subfield.required && empty(row?.[key])) {
        return `${field.label}: row ${rowIndex + 1} — “${subfield.label}” is required`
      }
    }
  }

  if (field.uniqueField) {
    const seen = new Map<string, number>()
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] as Record<string, unknown>
      const raw = row?.[field.uniqueField]
      if (empty(raw)) continue
      const key = String(raw).trim()
      const previous = seen.get(key)
      if (previous !== undefined) {
        const label = field.itemShape[field.uniqueField]?.label ?? field.uniqueField
        return `${field.label}: rows ${previous + 1} and ${rowIndex + 1} share “${label}” (${key}); values must be unique`
      }
      seen.set(key, rowIndex)
    }
  }
  return null
}

function validateSettings(
  schema: PluginSettingsSchema,
  values: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of schema.fields) {
    const value = values[field.key]
    if (field.type === 'list') {
      const error = listError(field, value)
      if (error) errors[field.key] = error
    } else if (field.required && empty(value)) {
      errors[field.key] = `${field.label} is required`
    }
  }
  return errors
}

interface ScalarFieldProps {
  field: ScalarSettingsField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled: boolean
  name: string
  compact?: boolean
}

function ScalarField({
  compact = false,
  disabled,
  error,
  field,
  name,
  onChange,
  value,
}: ScalarFieldProps) {
  if (field.type === 'boolean') {
    return (
      <Field name={name} orientation="horizontal" invalid={Boolean(error)} disabled={disabled}>
        <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
        <FieldLabel requirement={field.required ? 'required' : undefined}>{field.label}</FieldLabel>
        {!compact && field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
        {error ? <FieldError match>{error}</FieldError> : null}
      </Field>
    )
  }

  return (
    <Field name={name} invalid={Boolean(error)} disabled={disabled}>
      <FieldLabel requirement={field.required ? 'required' : undefined}>{field.label}</FieldLabel>
      {!compact && field.description ? <FieldDescription>{field.description}</FieldDescription> : null}
      {field.type === 'select' ? (
        <Select value={String(value ?? '')} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="w-full" aria-invalid={Boolean(error)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            if (field.type === 'number') {
              onChange(event.currentTarget.value === '' ? '' : event.currentTarget.valueAsNumber)
            } else {
              onChange(event.currentTarget.value)
            }
          }}
        />
      )}
      {error ? <FieldError match>{error}</FieldError> : null}
    </Field>
  )
}

interface ListFieldProps {
  field: ListSettingsField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled: boolean
}

function AddIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-2">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 fill-none stroke-current stroke-2">
      <path d="M3 4.5h10M6 2.5h4M5 6.5v5M8 6.5v5M11 6.5v5M4 4.5l.5 9h7l.5-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ListField({ disabled, error, field, onChange, value }: ListFieldProps) {
  const rows = Array.isArray(value) ? value as Record<string, unknown>[] : []
  const canAdd = field.maxItems === undefined || rows.length < field.maxItems
  const minimum = field.minItems ?? (field.required ? 1 : 0)
  const canDelete = rows.length > minimum
  const entries = Object.entries(field.itemShape)

  function updateRow(rowIndex: number, key: string, nextValue: unknown) {
    onChange(rows.map((row, index) => index === rowIndex ? { ...row, [key]: nextValue } : row))
  }

  return (
    <Fieldset
      disabled={disabled}
      aria-invalid={Boolean(error)}
      className="grid-cols-1"
    >
      <div className="grid min-w-0 gap-bakin-1">
        <FieldsetLegend>{field.label}</FieldsetLegend>
        {field.description ? <FieldsetDescription>{field.description}</FieldsetDescription> : null}
        {error ? (
          <div role="alert" className="border-l-2 border-bakin-signal-danger pl-bakin-2 [font-size:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-signal-danger">
            {error}
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-bakin-surface border border-dashed border-bakin-border-subtle px-bakin-3 py-bakin-3 [font-size:var(--bakin-typography-size-body)] text-bakin-text-muted">
          No items yet.
        </p>
      ) : (
        <div className="grid min-w-0 gap-bakin-3">
          {rows.map((row, rowIndex) => (
            <div
              key={`${field.key}-${rowIndex}`}
              role="group"
              aria-label={`${field.label} row ${rowIndex + 1}`}
              data-settings-list-row={field.key}
              data-testid={`list-row-${field.key}-${rowIndex}`}
              className="@container/settings-row grid min-w-0 gap-bakin-3 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default/40 p-bakin-3"
            >
              <div className="grid min-w-0 grid-cols-1 gap-bakin-3 @md/settings-row:grid-cols-2 @2xl/settings-row:grid-cols-3">
                {entries.map(([key, subfield]) => (
                  <ScalarField
                    key={key}
                    compact
                    disabled={disabled}
                    field={subfield}
                    name={`${field.key}.${rowIndex}.${key}`}
                    value={row?.[key]}
                    onChange={(nextValue) => updateRow(rowIndex, key, nextValue)}
                  />
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled || !canDelete}
                onClick={() => onChange(rows.filter((_, index) => index !== rowIndex))}
                aria-label={`Delete row ${rowIndex + 1} from ${field.label}`}
                className="justify-self-end text-bakin-text-muted hover:text-bakin-signal-danger"
              >
                <DeleteIcon />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !canAdd}
        onClick={() => onChange([...rows, initialRow(field.itemShape)])}
        className="max-w-full justify-self-start whitespace-normal text-left leading-snug"
      >
        <AddIcon />
        {field.addLabel ?? 'Add item'}
      </Button>
    </Fieldset>
  )
}

/** Schema-driven settings form with consumer-owned persistence and feedback. */
export function PluginSettingsRenderer({
  ariaLabel = 'Plugin settings',
  busy = false,
  busyLabel = 'Saving settings',
  className,
  disabled = false,
  feedback,
  onReset,
  onSubmit,
  onValidationError,
  resetLabel = 'Cancel',
  saveLabel = 'Save settings',
  schema,
  values,
}: PluginSettingsRendererProps) {
  const initial = useMemo(() => initialValues(schema, values), [schema, values])
  const initialSignature = JSON.stringify(initial)
  const sourceSignature = useRef(initialSignature)
  const [draft, setDraft] = useState<Record<string, unknown>>(() => initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const dirty = schema.fields.some((field) => JSON.stringify(draft[field.key]) !== JSON.stringify(initial[field.key]))

  useEffect(() => {
    if (sourceSignature.current === initialSignature) return
    sourceSignature.current = initialSignature
    setDraft(initial)
    setErrors({})
  }, [initial, initialSignature])

  function setValue(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors = validateSettings(schema, draft)
    setErrors(nextErrors)
    const firstError = Object.values(nextErrors)[0]
    if (firstError) {
      onValidationError?.(firstError)
      return
    }
    onSubmit(draft)
  }

  function reset() {
    setDraft(initialValues(schema, values))
    setErrors({})
    onReset?.()
  }

  return (
    <Form
      aria-label={ariaLabel}
      busy={busy}
      onSubmit={submit}
      className={classNames('min-w-0', className)}
    >
      {schema.fields.map((field) => field.type === 'list' ? (
        <ListField
          key={field.key}
          field={field}
          value={draft[field.key]}
          error={errors[field.key]}
          disabled={disabled || busy}
          onChange={(value) => setValue(field.key, value)}
        />
      ) : (
        <ScalarField
          key={field.key}
          field={field}
          name={field.key}
          value={draft[field.key]}
          error={errors[field.key]}
          disabled={disabled || busy}
          onChange={(value) => setValue(field.key, value)}
        />
      ))}

      {feedback ? (
        <Alert tone={feedback.tone === 'error' ? 'danger' : 'success'}>
          <AlertTitle>{feedback.title}</AlertTitle>
          {feedback.description ? <AlertDescription>{feedback.description}</AlertDescription> : null}
        </Alert>
      ) : null}

      <FormActions>
        <Button type="button" variant="outline" disabled={disabled || busy || !dirty} onClick={reset}>
          {resetLabel}
        </Button>
        <SubmitButton disabled={disabled || !dirty} busyLabel={busyLabel}>
          {saveLabel}
        </SubmitButton>
      </FormActions>
    </Form>
  )
}
