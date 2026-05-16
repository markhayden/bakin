'use client'

/**
 * Inline node config drawer.
 *
 * Opens when a node is clicked on the canvas editor. Renders a form
 * generated from the selected node type's `formFields` metadata and
 * validates the merged step payload against the node type's Zod schema
 * before Apply, so the drawer and the loader cannot drift.
 */

import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
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
import { getNodeType, type FormField } from '../lib/node-type-registry'

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
  /** Called when the user Applies; patch contains only fields the form owns. */
  onApply: (patch: Record<string, unknown>) => void
  onClose: () => void
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
  if (field.type === 'list' && Array.isArray(raw)) return raw.join(', ')
  return raw
}

export function NodeConfigDrawer({ step, fallbackKind, onApply, onClose }: NodeConfigDrawerProps) {
  const kind = step?.type ?? fallbackKind ?? ''
  const def = useMemo(() => (kind ? getNodeType(kind) : undefined), [kind])

  // The parent remounts this component via `key` when `step.id`/`step.type`
  // changes, so lazy state initializers from props are safe here.
  const [id, setId] = useState(step?.id ?? '')
  const [label, setLabel] = useState(step?.label ?? '')
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => {
    const seeded: Record<string, unknown> = {}
    if (step && def) {
      for (const field of def.formFields) {
        seeded[field.name] = fieldInitialValue(step, field)
      }
    }
    return seeded
  })
  const [errors, setErrors] = useState<string[]>([])

  if (!step) return null

  if (!def) {
    return (
      <aside className="flex w-80 flex-col border-l border-border bg-card">
        <DrawerHeader onClose={onClose} title={step.id} subtitle={kind || 'unknown kind'} />
        <div className="p-3 text-xs text-amber-300">
          No registered node type for <code>{kind || '(missing)'}</code>. Step is preserved
          but cannot be edited here — the plugin may not be active.
        </div>
      </aside>
    )
  }

  function handleApply() {
    if (!def) return
    // Build the full candidate step from id/label + field values.
    const coerced: Record<string, unknown> = {}
    for (const field of def.formFields) {
      const v = fieldValues[field.name]
      if (v === '' || v === undefined || v === null) {
        // Omit empty — the Zod `.optional()` branches accept missing keys.
        continue
      }
      coerced[field.name] = field.type === 'list' && typeof v === 'string' ? coerceListInput(v) : v
    }

    const candidate = {
      id,
      type: kind,
      label,
      ...coerced,
    }

    const result = def.zodSchema.safeParse(candidate)
    if (!result.success) {
      setErrors(result.error.issues.map((i) => `${i.path.join('.') || 'step'}: ${i.message}`))
      return
    }
    setErrors([])
    const validated = (result.data ?? {}) as Record<string, unknown>
    onApply({ ...validated, id, label })
  }

  const canApply = id.trim().length > 0 && label.trim().length > 0

  return (
    <aside className="flex w-80 flex-col border-l border-border bg-card">
      <DrawerHeader onClose={onClose} title={step.id} subtitle={kind} />

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2">
          <Label className="text-xs" htmlFor="node-config-id">Id</Label>
          <Input id="node-config-id" value={id} onChange={(e) => setId(e.target.value)} />
        </div>
        <div className="mb-3">
          <Label className="text-xs" htmlFor="node-config-label">Label</Label>
          <Input
            id="node-config-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {def.formFields.map((field) => (
          <div key={field.name} className="mb-3">
            <Label className="text-xs" htmlFor={`node-config-${field.name}`}>
              {field.name}
              {field.required && <span className="ml-1 text-red-400">*</span>}
            </Label>
            <FieldControl
              field={field}
              value={fieldValues[field.name]}
              onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.name]: v }))}
            />
            {field.description && (
              <p className="mt-1 text-[10px] text-muted-foreground">{field.description}</p>
            )}
          </div>
        ))}

        {errors.length > 0 && (
          <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-200">
            <ul className="list-disc pl-4">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-border p-3">
        <Button size="sm" onClick={handleApply} disabled={!canApply}>
          Apply
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
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
  subtitle: string
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2">
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
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

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: unknown
  onChange: (v: unknown) => void
}) {
  const str = (value ?? '') as string
  switch (field.type) {
    case 'text':
      return (
        <Textarea
          id={`node-config-${field.name}`}
          rows={3}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          id={`node-config-${field.name}`}
          type="number"
          value={value === undefined || value === null ? '' : (value as number)}
          onChange={(e) => {
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
            onCheckedChange={(v) => onChange(v === true)}
          />
        </div>
      )
    case 'select':
      return (
        <Select value={str} onValueChange={(v) => onChange(v || undefined)}>
          <SelectTrigger id={`node-config-${field.name}`}>
            <SelectValue placeholder="Select..." />
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
          value={str}
          onValueChange={(v) => onChange(v || undefined)}
          allowNone={!field.required}
        />
      )
    case 'skill':
    case 'string':
      return (
        <Input
          id={`node-config-${field.name}`}
          value={str}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'list':
      return (
        <Input
          id={`node-config-${field.name}`}
          value={str}
          onChange={(e) => onChange(e.target.value)}
          placeholder="comma-separated"
        />
      )
  }
}

