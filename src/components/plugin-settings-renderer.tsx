'use client'

import { useState } from 'react'
import {
  PluginSettingsRenderer as SettingsForm,
  type PluginSettingsFeedback,
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
  // A toast disappears; a rejected write must not. The failure stays parked
  // next to the form until the next save attempt.
  const [feedback, setFeedback] = useState<PluginSettingsFeedback | null>(null)
  const add = useToastStore((state) => state.add)

  function submit(nextValues: Record<string, unknown>) {
    setSaving(true)
    setFeedback(null)
    void onSave(nextValues)
      .then(() => add({ type: 'success', message: `${pluginId} settings saved` }))
      .catch((err: unknown) => {
        const message = err instanceof Error && err.message ? err.message : 'Failed to save settings'
        setFeedback({ tone: 'error', title: 'Settings were not saved', description: message })
        add({ type: 'error', message })
      })
      .finally(() => setSaving(false))
  }

  return (
    <SettingsForm
      schema={schema}
      values={values}
      onSubmit={submit}
      onValidationError={(message) => add({ type: 'error', message })}
      feedback={feedback}
      busy={saving}
      saveLabel="Save"
      busyLabel="Saving..."
      ariaLabel={`${pluginId} settings`}
    />
  )
}
