'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToastStore } from '@/hooks/use-toast'
import type { SettingsField, PluginSettingsSchema } from '@/lib/plugin-types'

export type { PluginSettingsSchema }

interface PluginSettingsRendererProps {
  pluginId: string
  schema: PluginSettingsSchema
  values: Record<string, unknown>
  onSave: (values: Record<string, unknown>) => Promise<void>
}

export function PluginSettingsRenderer({ pluginId, schema, values, onSave }: PluginSettingsRendererProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const field of schema.fields) {
      initial[field.key] = values[field.key] ?? field.default ?? (field.type === 'boolean' ? false : '')
    }
    return initial
  })
  const [saving, setSaving] = useState(false)
  const add = useToastStore((s) => s.add)

  const isDirty = schema.fields.some(f => formValues[f.key] !== (values[f.key] ?? f.default ?? (f.type === 'boolean' ? false : '')))

  const handleSave = async () => {
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
    const initial: Record<string, unknown> = {}
    for (const field of schema.fields) {
      initial[field.key] = values[field.key] ?? field.default ?? (field.type === 'boolean' ? false : '')
    }
    setFormValues(initial)
  }

  const setValue = (key: string, value: unknown) => {
    setFormValues(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="space-y-6">
      {schema.fields.map((field) => (
        <div key={field.key} className="space-y-2">
          {field.type === 'boolean' ? (
            <div className="flex items-center justify-between">
              <div>
                <Label>{field.label}</Label>
                {field.description && (
                  <p className="text-xs text-muted-foreground mt-0.5">{field.description}</p>
                )}
              </div>
              <Switch
                checked={!!formValues[field.key]}
                onCheckedChange={(checked) => setValue(field.key, checked)}
              />
            </div>
          ) : field.type === 'select' && field.options ? (
            <>
              <Label>{field.label}</Label>
              {field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
              <Select
                value={String(formValues[field.key] ?? '')}
                onValueChange={(v) => setValue(field.key, v)}
              >
                <SelectTrigger className="w-60">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          ) : (
            <>
              <Label>{field.label}</Label>
              {field.description && (
                <p className="text-xs text-muted-foreground">{field.description}</p>
              )}
              <Input
                type={field.type === 'number' ? 'number' : 'text'}
                value={String(formValues[field.key] ?? '')}
                onChange={(e) => setValue(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                className="w-60"
              />
            </>
          )}
        </div>
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
