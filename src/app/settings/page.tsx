'use client'

import { useEffect, useState } from 'react'
import { PageLayout } from '@/components/page-layout'
import { PluginSettingsRenderer, type PluginSettingsSchema } from '@/components/plugin-settings-renderer'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { Settings } from 'lucide-react'

interface PluginSchema {
  id: string
  name: string
  schema: PluginSettingsSchema
}

export default function SettingsPage() {
  const [plugins, setPlugins] = useState<PluginSchema[]>([])
  const [activePlugin, setActivePlugin] = useState<string>('')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [schemasLoading, setSchemasLoading] = useState(true)

  // Fetch available schemas on mount
  useEffect(() => {
    fetch('/api/plugin-settings/schemas')
      .then(r => r.json())
      .then((data: PluginSchema[]) => {
        setPlugins(data)
        if (data.length > 0) setActivePlugin(data[0].id)
        setSchemasLoading(false)
      })
      .catch(() => setSchemasLoading(false))
  }, [])

  // Fetch values when active plugin changes
  useEffect(() => {
    if (!activePlugin) return
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

  const plugin = plugins.find(p => p.id === activePlugin)

  if (schemasLoading) {
    return (
      <PageLayout title="Settings" subtitle="Configure plugin behavior">
        <div className="space-y-4">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-8 w-40" />
        </div>
      </PageLayout>
    )
  }

  if (plugins.length === 0) {
    return (
      <PageLayout title="Settings" subtitle="Configure plugin behavior">
        <EmptyState
          icon={Settings}
          title="No plugin settings"
          description="No plugins have declared configurable settings."
        />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Settings" subtitle="Configure plugin behavior">
      <div className="flex gap-8">
        {/* Plugin list */}
        <nav className="w-40 shrink-0 space-y-1">
          {plugins.map(p => (
            <button
              key={p.id}
              onClick={() => setActivePlugin(p.id)}
              className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors ${
                p.id === activePlugin
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p.name}
            </button>
          ))}
        </nav>

        {/* Settings form */}
        <div className="flex-1 max-w-lg">
          {plugin && (
            <>
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
            </>
          )}
        </div>
      </div>
    </PageLayout>
  )
}
