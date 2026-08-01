'use client'

import { useState } from 'react'
import {
  PluginSettingsRenderer as SettingsForm,
} from '@makinbakin/sdk/patterns'
import { useToastStore } from '@makinbakin/sdk/hooks'
import type { PluginSettingsSchema } from '@makinbakin/sdk/types'

export type { PluginSettingsSchema }

export interface PluginSettingsRendererProps {
  pluginId: string
  schema: PluginSettingsSchema
  values: Record<string, unknown>
  onSave: (values: Record<string, unknown>) => Promise<void>
}

/**
 * App-aware compatibility adapter. New plugin UI should import the focused
 * renderer from `@makinbakin/sdk/patterns` and own persistence feedback.
 */
export function PluginSettingsRenderer({
  onSave,
  pluginId,
  schema,
  values,
}: PluginSettingsRendererProps) {
  const [saving, setSaving] = useState(false)
  const add = useToastStore((state) => state.add)

  function submit(nextValues: Record<string, unknown>) {
    setSaving(true)
    void onSave(nextValues)
      .then(() => add({ type: 'success', message: `${pluginId} settings saved` }))
      .catch(() => add({ type: 'error', message: 'Failed to save settings' }))
      .finally(() => setSaving(false))
  }

  return (
    <SettingsForm
      schema={schema}
      values={values}
      onSubmit={submit}
      onValidationError={(message) => add({ type: 'error', message })}
      busy={saving}
      saveLabel="Save"
      busyLabel="Saving..."
      ariaLabel={`${pluginId} settings`}
    />
  )
}
