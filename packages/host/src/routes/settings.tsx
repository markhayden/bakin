/**
 * /settings — plugin + system settings route.
 *
 * Mirrors `src/app/settings/page.tsx`. Unlike the other 20 routes this
 * one is the single page not covered by the post-#145 slot decoupling
 * — the settings UI lives directly in core (not a plugin), so we port
 * the logic verbatim: schema discovery via /api/plugin-settings/schemas,
 * per-plugin form render via PluginSettingsRenderer, and a synthetic
 * "System & Alerts" tab backed by /api/settings.
 *
 * Imports reach into the Next.js-era `src/components/*` tree. That's
 * fine during TC migration — the root tsconfig maps `@/*` to `./src/*`
 * and packages/host inherits it — but TC26/TC27 should revisit whether
 * these components want to move under packages/host/src/components or
 * get promoted into @makinbakin/sdk.
 */
import { createRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { PageLayout } from '@/components/page-layout'
import { PluginSettingsRenderer, type PluginSettingsSchema } from '@/components/plugin-settings-renderer'
import {
  SYSTEM_SETTINGS_TAB_ID,
  SYSTEM_SETTINGS_SCHEMA,
  flattenSystemSettings,
  unflattenSystemSettings,
} from '@/components/system-settings'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { ProviderKeysTab, PROVIDER_KEYS_TAB_ID } from '@/components/provider-keys-tab'
import { Route as RootRoute } from './__root'

export interface PluginSchemaEntry {
  id: string
  name: string
  schema: PluginSettingsSchema
  source: 'built-in' | 'user'
}

interface GroupedSchemas {
  core: PluginSchemaEntry[]
  extensions: PluginSchemaEntry[]
}

/**
 * Partition the settings schemas into two sections — Core (System &
 * Alerts pinned at top, then built-in plugins A-Z) and Extensions
 * (user-installed plugins, A-Z). Exported so the pure ordering logic is
 * unit-testable without mounting the route.
 */
export function groupAndSortSchemas(schemas: PluginSchemaEntry[]): GroupedSchemas {
  const system: PluginSchemaEntry[] = []
  const providerKeys: PluginSchemaEntry[] = []
  const core: PluginSchemaEntry[] = []
  const extensions: PluginSchemaEntry[] = []
  for (const entry of schemas) {
    if (entry.id === SYSTEM_SETTINGS_TAB_ID) system.push(entry)
    else if (entry.id === PROVIDER_KEYS_TAB_ID) providerKeys.push(entry)
    else if (entry.source === 'built-in') core.push(entry)
    else extensions.push(entry)
  }
  const alpha = (a: PluginSchemaEntry, b: PluginSchemaEntry) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  core.sort(alpha)
  extensions.sort(alpha)
  // System & Alerts pinned first, then Integrations & Keys, then built-ins A-Z.
  return { core: [...system, ...providerKeys, ...core], extensions }
}

function SettingsRoute() {
  const [plugins, setPlugins] = useState<PluginSchemaEntry[]>([])
  const [activePlugin, setActivePlugin] = useState<string>('')
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [schemasLoading, setSchemasLoading] = useState(true)

  // Fetch available schemas on mount. The "System & Alerts" tab is injected
  // first so it's the default landing tab.
  useEffect(() => {
    fetch('/api/plugin-settings/schemas')
      .then(r => r.json())
      .then((data: PluginSchemaEntry[]) => {
        const withSystem: PluginSchemaEntry[] = [
          { id: SYSTEM_SETTINGS_TAB_ID, name: 'System & Alerts', schema: SYSTEM_SETTINGS_SCHEMA, source: 'built-in' },
          { id: PROVIDER_KEYS_TAB_ID, name: 'Integrations & Keys', schema: { fields: [] }, source: 'built-in' },
          ...data,
        ]
        setPlugins(withSystem)
        setActivePlugin(SYSTEM_SETTINGS_TAB_ID)
        setSchemasLoading(false)
      })
      .catch(() => setSchemasLoading(false))
  }, [])

  // Fetch values when active plugin changes. The system tab reads from
  // /api/settings (core settings.json) instead of /api/plugin-settings/*.
  useEffect(() => {
    if (!activePlugin) return
    // Integrations & Keys manages its own data via /api/secrets + the images
    // readiness route, so the generic values fetch is skipped.
    if (activePlugin === PROVIDER_KEYS_TAB_ID) {
      setValues({})
      setLoading(false)
      return
    }
    setLoading(true)
    if (activePlugin === SYSTEM_SETTINGS_TAB_ID) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => { setValues(flattenSystemSettings(data)); setLoading(false) })
        .catch(() => setLoading(false))
      return
    }
    fetch(`/api/plugin-settings/${activePlugin}`)
      .then(r => r.json())
      .then(data => { setValues(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [activePlugin])

  const handleSave = async (newValues: Record<string, unknown>) => {
    if (activePlugin === SYSTEM_SETTINGS_TAB_ID) {
      const nested = unflattenSystemSettings(newValues)
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nested),
      })
      if (res.ok) setValues(newValues)
      return
    }
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

  const grouped = groupAndSortSchemas(plugins)
  const renderTab = (p: PluginSchemaEntry) => (
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
  )
  const sectionLabel = 'px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60'

  return (
    <PageLayout title="Settings" subtitle="Configure plugin behavior">
      <div className="flex gap-8">
        {/* Plugin list */}
        <nav className="w-40 shrink-0">
          {grouped.core.length > 0 && (
            <div className="space-y-1">
              <div className={sectionLabel}>Core</div>
              {grouped.core.map(renderTab)}
            </div>
          )}
          {grouped.extensions.length > 0 && (
            <div className="space-y-1 mt-6">
              <div className={sectionLabel}>Extensions</div>
              {grouped.extensions.map(renderTab)}
            </div>
          )}
        </nav>

        {/* Settings form */}
        <div className="flex-1">
          {plugin && (
            <>
              <h2 className="text-base font-semibold mb-4">{plugin.name}</h2>
              {activePlugin === PROVIDER_KEYS_TAB_ID ? (
                <ProviderKeysTab />
              ) : loading ? (
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

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/settings',
  component: SettingsRoute,
})
