'use client'

import { useMemo, useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToastStore } from '@bakin/sdk/hooks'
import type {
  SettingsField,
  StringSettingsField,
  NumberSettingsField,
  BooleanSettingsField,
  SelectSettingsField,
  ListSettingsField,
  PluginSettingsSchema,
} from '@bakin/core/plugin-types'

export type { PluginSettingsSchema }

type ScalarField = StringSettingsField | NumberSettingsField | BooleanSettingsField | SelectSettingsField

interface PluginSettingsRendererProps {
  pluginId: string
  schema: PluginSettingsSchema
  values: Record<string, unknown>
  onSave: (values: Record<string, unknown>) => Promise<void>
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

function buildInitialValues(schema: PluginSettingsSchema, values: Record<string, unknown>): Record<string, unknown> {
  const initial: Record<string, unknown> = {}
  for (const field of schema.fields) {
    initial[field.key] = values[field.key] ?? defaultForField(field)
  }
  return initial
}

function buildInitialRow(itemShape: ListSettingsField['itemShape']): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(itemShape)) {
    row[key] = defaultForField(field)
  }
  return row
}

/** Validate a list field's current value. Returns an error message or null. */
function validateList(field: ListSettingsField, value: unknown): string | null {
  const items = Array.isArray(value) ? value : []
  if (field.minItems !== undefined && items.length < field.minItems) {
    return `${field.label}: needs at least ${field.minItems} ${field.minItems === 1 ? 'item' : 'items'}`
  }
  if (field.maxItems !== undefined && items.length > field.maxItems) {
    return `${field.label}: no more than ${field.maxItems} ${field.maxItems === 1 ? 'item' : 'items'}`
  }
  for (let i = 0; i < items.length; i++) {
    const row = items[i] as Record<string, unknown>
    for (const [key, sub] of Object.entries(field.itemShape)) {
      if (sub.required) {
        const raw = row?.[key]
        const empty = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')
        if (empty) return `${field.label}: row ${i + 1} — "${sub.label}" is required`
      }
    }
  }
  if (field.uniqueField) {
    const seen = new Map<string, number>()
    for (let i = 0; i < items.length; i++) {
      const row = items[i] as Record<string, unknown>
      const raw = row?.[field.uniqueField]
      if (raw === undefined || raw === null) continue
      const key = String(raw).trim()
      if (key === '') continue
      const prev = seen.get(key)
      if (prev !== undefined) {
        const subLabel = field.itemShape[field.uniqueField]?.label ?? field.uniqueField
        return `${field.label}: rows ${prev + 1} and ${i + 1} share the same "${subLabel}" (${key}) — must be unique`
      }
      seen.set(key, i)
    }
  }
  return null
}

export function PluginSettingsRenderer({ pluginId, schema, values, onSave }: PluginSettingsRendererProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => buildInitialValues(schema, values))
  const [saving, setSaving] = useState(false)
  const add = useToastStore((s) => s.add)

  const initial = useMemo(() => buildInitialValues(schema, values), [schema, values])

  const isDirty = schema.fields.some(f => JSON.stringify(formValues[f.key]) !== JSON.stringify(initial[f.key]))

  const handleSave = async () => {
    for (const field of schema.fields) {
      if (field.type === 'list') {
        const err = validateList(field, formValues[field.key])
        if (err) {
          add({ type: 'error', message: err })
          return
        }
      }
    }
    setSaving(true)
    try {
      await onSave(formValues)
      add({ type: 'success', message: `${pluginId} settings saved` })
    } catch {
      add({ type: 'error', message: 'Failed to save settings' })
    }
    setSaving(false)
  }

  const handleReset = () => {
    setFormValues(buildInitialValues(schema, values))
  }

  const setValue = (key: string, value: unknown) => {
    setFormValues(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-6">
      {schema.fields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          value={formValues[field.key]}
          onChange={(v) => setValue(field.key, v)}
        />
      ))}

      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? 'Saving...' : 'Save'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleReset} disabled={!isDirty}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

interface FieldRowProps {
  field: SettingsField
  value: unknown
  onChange: (value: unknown) => void
}

function FieldRow({ field, value, onChange }: FieldRowProps) {
  if (field.type === 'list') {
    return <ListField field={field} value={value} onChange={onChange} />
  }
  return <ScalarFieldRow field={field} value={value} onChange={onChange} compact={false} />
}

interface ScalarFieldRowProps {
  field: ScalarField
  value: unknown
  onChange: (value: unknown) => void
  compact: boolean
}

function ScalarFieldRow({ field, value, onChange, compact }: ScalarFieldRowProps) {
  if (field.type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <div>
          <Label>{field.label}</Label>
          {!compact && field.description && (
            <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
          )}
        </div>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="space-y-2">
        <Label>{field.label}</Label>
        {!compact && field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger className={compact ? 'w-full' : 'w-60'}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label>{field.label}</Label>
      {!compact && field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
      <Input
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
        className={compact ? 'w-full' : 'w-60'}
      />
    </div>
  )
}

interface ListFieldProps {
  field: ListSettingsField
  value: unknown
  onChange: (value: unknown) => void
}

function ListField({ field, value, onChange }: ListFieldProps) {
  const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
  const canAdd = field.maxItems === undefined || items.length < field.maxItems
  const canDelete = field.minItems === undefined || items.length > field.minItems

  const updateRow = (i: number, subKey: string, subValue: unknown) => {
    const next = items.map((row, idx) => idx === i ? { ...row, [subKey]: subValue } : row)
    onChange(next)
  }

  const deleteRow = (i: number) => {
    onChange(items.filter((_, idx) => idx !== i))
  }

  const addRow = () => {
    onChange([...items, buildInitialRow(field.itemShape)])
  }

  const subEntries = Object.entries(field.itemShape)

  return (
    <div className="space-y-3">
      <div>
        <Label>{field.label}</Label>
        {field.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No items yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((row, i) => (
            <div
              key={i}
              className="flex items-end gap-2 rounded-md border border-border/60 bg-muted/20 p-3"
              data-testid={`list-row-${field.key}-${i}`}
            >
              <div className="flex-1 grid gap-3" style={{ gridTemplateColumns: `repeat(${subEntries.length}, minmax(0, 1fr))` }}>
                {subEntries.map(([subKey, subField]) => (
                  <ScalarFieldRow
                    key={subKey}
                    field={subField}
                    value={row?.[subKey]}
                    onChange={(v) => updateRow(i, subKey, v)}
                    compact
                  />
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteRow(i)}
                disabled={!canDelete}
                aria-label={`Delete row ${i + 1}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" size="sm" onClick={addRow} disabled={!canAdd}>
        <Plus className="h-4 w-4 mr-1" />
        {field.addLabel ?? 'Add'}
      </Button>
    </div>
  )
}
