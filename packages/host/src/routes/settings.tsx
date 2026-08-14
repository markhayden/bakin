/**
 * /settings — plugin + system settings route.
 *
 * The single page not covered by the post-#145 slot decoupling — the
 * settings UI lives directly in core (not a plugin): schema discovery via
 * /api/plugin-settings/schemas, per-plugin form render via
 * PluginSettingsRenderer, and a synthetic "System & Alerts" tab backed by
 * /api/settings.
 *
 * Composed on the Page archetype (storybook-refit T6.1/T6.2): Page +
 * PageHeader own page identity and padding; the NavList master-detail
 * category navigator sits beside ONE PageBody region so state replacement
 * touches only the active category (Recipes/Settings and dashboard pages).
 */
import { createRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { NavList, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Skeleton, SystemState } from '@makinbakin/sdk/ui'
import { PluginSettingsRenderer, type PluginSettingsSchema } from '@/components/plugin-settings-renderer'
import {
  SYSTEM_SETTINGS_TAB_ID,
  SYSTEM_SETTINGS_SCHEMA,
  flattenSystemSettings,
  unflattenSystemSettings,
} from '@/components/system-settings'
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

function SettingsFrame({ children }: { children: React.ReactNode }) {
  return (
    <Page>
      <PageHeader title="Settings" description="Configure plugin behavior" />
      {children}
    </Page>
  )
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
      <SettingsFrame>
        <PageBody label="Settings categories" state={<SystemState kind="loading" />} />
      </SettingsFrame>
    )
  }

  if (plugins.length === 0) {
    return (
      <SettingsFrame>
        <PageBody
          label="Settings categories"
          state={
            <SystemState
              kind="initial-empty"
              title="No plugin settings"
              description="No plugins have declared configurable settings."
            />
          }
        />
      </SettingsFrame>
    )
  }

  const grouped = groupAndSortSchemas(plugins)
  const toNavItem = (p: PluginSchemaEntry) => ({ id: p.id, label: p.name })
  const navSections = [
    ...(grouped.core.length > 0 ? [{ label: 'Core', items: grouped.core.map(toNavItem) }] : []),
    ...(grouped.extensions.length > 0 ? [{ label: 'Extensions', items: grouped.extensions.map(toNavItem) }] : []),
  ]

  return (
    <SettingsFrame>
      <div className="flex min-w-0 flex-1 flex-col gap-bakin-6 @3xl/page-shell:flex-row @3xl/page-shell:items-start @3xl/page-shell:gap-bakin-8">
        {/* Master-detail category navigation (NavList) — the active category
            stays visible while PageBody swaps its state. */}
        <NavList
          label="Settings categories"
          sections={navSections}
          selectedId={activePlugin || null}
          onSelect={setActivePlugin}
          className="w-full min-w-0 @3xl/page-shell:w-56 @3xl/page-shell:shrink-0"
        />

        {/* Active category — the ONE PageBody region for this page. */}
        <PageBody labelledBy="active-settings-heading" gap="content" className="min-w-0">
          {plugin && (
            <>
              <h2
                id="active-settings-heading"
              >
                {plugin.name}
              </h2>
              {activePlugin === PROVIDER_KEYS_TAB_ID ? (
                <ProviderKeysTab />
              ) : loading ? (
                <div className="flex flex-col gap-bakin-4">
                  <Skeleton className="h-8 w-60" />
                  <Skeleton className="h-8 w-40" />
                  <Skeleton className="h-8 w-60" />
                </div>
              ) : plugin.schema.fields.length === 0 ? (
                <SystemState
                  kind="initial-empty"
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
        </PageBody>
      </div>
    </SettingsFrame>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/settings',
  component: SettingsRoute,
})
