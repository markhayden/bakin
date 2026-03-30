'use client'

import { useEffect, useState } from 'react'
import { PageLayout } from '@/components/page-layout'
import { PluginSettingsRenderer, type PluginSettingsSchema } from '@/components/plugin-settings-renderer'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { Settings } from 'lucide-react'

/** Stub settings schemas — Phase 4 will have plugins declare their own */
const PLUGIN_SETTINGS: Record<string, { name: string; schema: PluginSettingsSchema }> = {
  tasks: {
    name: 'Tasks',
    schema: {
      fields: [
        {
          key: 'defaultColumn',
          type: 'select',
          label: 'Default Column',
          description: 'Which column new tasks are created in.',
          options: [
            { value: 'backlog', label: 'Backlog' },
            { value: 'todo', label: 'Todo' },
          ],
          default: 'todo',
        },
        {
          key: 'showCompleted',
          type: 'boolean',
          label: 'Show Completed Tasks',
          description: 'Show tasks in the Done and Confirmed columns by default.',
          default: true,
        },
        {
          key: 'autoArchiveDays',
          type: 'number',
          label: 'Auto-Archive After (days)',
          description: 'Automatically move confirmed tasks to archive after this many days. Set to 0 to disable.',
          default: 0,
        },
      ],
    },
  },
}

export default function SettingsPage() {
  const pluginIds = Object.keys(PLUGIN_SETTINGS)
  const [activePlugin, setActivePlugin] = useState(pluginIds[0])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/plugin-settings/${activePlugin}`)
      .then(r => r.json())
      .then(data => { setValues(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activePlugin])

  const handleSave = async (newValues: Record<string, unknown>) => {
    const res = await fetch(`/api/plugin-settings/${activePlugin}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newValues),
    })
    if (res.ok) setValues(newValues)
  }

  const plugin = PLUGIN_SETTINGS[activePlugin]

  return (
    <PageLayout title="Settings" subtitle="Configure plugin behavior">
      <div className="flex gap-8">
        {/* Plugin list */}
        <nav className="w-40 shrink-0 space-y-1">
          {pluginIds.map(id => {
            const p = PLUGIN_SETTINGS[id]
            return (
              <button
                key={id}
                onClick={() => setActivePlugin(id)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                  id === activePlugin
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {p.name}
              </button>
            )
          })}
        </nav>

        {/* Settings form */}
        <div className="flex-1 max-w-lg">
          <h2 className="text-base font-semibold mb-4">{plugin.name}</h2>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-60" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-8 w-60" />
            </div>
          ) : plugin.schema.fields.length === 0 ? (
            <EmptyState
              icon={Settings}
              title="No settings"
              description="This plugin has no configurable settings."
            />
          ) : (
            <PluginSettingsRenderer
              pluginId={activePlugin}
              schema={plugin.schema}
              values={values}
              onSave={handleSave}
            />
          )}
        </div>
      </div>
    </PageLayout>
  )
}
