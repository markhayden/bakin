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
import { useMemo, useState } from 'react'
import { NavList, Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import { Button, SystemState } from '@makinbakin/sdk/ui'
import { PluginSettingsRenderer, type PluginSettingsSchema } from '@/components/plugin-settings-renderer'
import {
  SYSTEM_SETTINGS_TAB_ID,
  SYSTEM_SETTINGS_SCHEMA,
  flattenSystemSettings,
  unflattenSystemSettings,
} from '@/components/system-settings'
import { ProviderKeysTab, PROVIDER_KEYS_TAB_ID } from '@/components/provider-keys-tab'
import { responseError } from '../lib/request-error'
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


const ACTIVE_HEADING_ID = 'active-settings-heading'
const REQUEST_TIMEOUT_MS = 15_000

function SettingsRoute() {
  const [selectedId, setSelectedId] = useState<string>('')
  // Values the user just persisted, so the form keeps showing what was written
  // without a second round trip. Cleared when the category changes.
  const [savedValues, setSavedValues] = useState<Record<string, unknown> | null>(null)

  // Schema discovery. The "System & Alerts" and "Integrations & Keys" tabs are
  // injected first so System & Alerts is the default landing tab.
  const {
    data: schemaData,
    loading: schemasLoading,
    error: schemasError,
    refresh: refreshSchemas,
  } = useJsonFetch<PluginSchemaEntry[]>('/api/plugin-settings/schemas', { timeoutMs: REQUEST_TIMEOUT_MS })

  const plugins = useMemo<PluginSchemaEntry[]>(() => {
    if (!schemaData) return []
    return [
      { id: SYSTEM_SETTINGS_TAB_ID, name: 'System & Alerts', schema: SYSTEM_SETTINGS_SCHEMA, source: 'built-in' },
      { id: PROVIDER_KEYS_TAB_ID, name: 'Integrations & Keys', schema: { fields: [] }, source: 'built-in' },
      ...schemaData,
    ]
  }, [schemaData])

  const activePlugin = selectedId || (plugins.length > 0 ? SYSTEM_SETTINGS_TAB_ID : '')

  // Values for the active category. The system tab reads from /api/settings
  // (core settings.json) instead of /api/plugin-settings/*; Integrations & Keys
  // manages its own data via /api/secrets + the images readiness route, so the
  // generic values fetch is skipped for it.
  const valuesUrl = activePlugin === '' || activePlugin === PROVIDER_KEYS_TAB_ID
    ? null
    : activePlugin === SYSTEM_SETTINGS_TAB_ID
      ? '/api/settings'
      : `/api/plugin-settings/${activePlugin}`
  const {
    data: valuesData,
    loading: valuesLoading,
    error: valuesError,
    refresh: refreshValues,
  } = useJsonFetch<Record<string, unknown>>(valuesUrl, { timeoutMs: REQUEST_TIMEOUT_MS })

  const loadedValues = useMemo<Record<string, unknown>>(() => {
    if (!valuesData) return {}
    return activePlugin === SYSTEM_SETTINGS_TAB_ID ? flattenSystemSettings(valuesData) : valuesData
  }, [valuesData, activePlugin])
  const values = savedValues ?? loadedValues

  const selectPlugin = (id: string) => {
    // Re-selecting the active category must NOT drop what was just saved. The
    // id is unchanged, so `valuesUrl` is unchanged, so `useJsonFetch` never
    // refetches — clearing here would fall back to the pre-save GET and render
    // stale values (the dispatch kill switch reverting to OFF while the server
    // has it ON). Saving from that stale form then writes the stale value back.
    // The invariant: clear `savedValues` exactly when `valuesUrl` changes.
    if (id === activePlugin) return
    setSavedValues(null)
    setSelectedId(id)
  }

  const handleSave = async (newValues: Record<string, unknown>) => {
    if (activePlugin === SYSTEM_SETTINGS_TAB_ID) {
      const nested = unflattenSystemSettings(newValues)
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nested),
      })
      // A non-ok write MUST reject: reporting "saved" over a rejected write
      // hides changes as consequential as the dispatch kill switch.
      if (!res.ok) throw await responseError(res, 'System settings were not saved')
      setSavedValues(newValues)
      return
    }
    const res = await fetch(`/api/plugin-settings/${activePlugin}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newValues),
    })
    if (!res.ok) throw await responseError(res, 'Settings were not saved')
    setSavedValues(newValues)
  }

  const plugin = plugins.find(p => p.id === activePlugin)

  if (schemasLoading) {
    return (
      <SettingsFrame>
        <PageBody label="Settings categories" state={<SystemState kind="loading" />} />
      </SettingsFrame>
    )
  }

  // A failed discovery is NOT an empty settings surface — say so, and offer the
  // retry instead of implying nothing is configurable.
  if (schemasError) {
    return (
      <SettingsFrame>
        <PageBody
          label="Settings categories"
          state={
            <SystemState
              kind="error"
              recovery="available"
              title="Settings could not be loaded"
              description={schemasError}
              action={<Button variant="outline" onClick={refreshSchemas}>Try again</Button>}
            />
          }
        />
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
          onSelect={selectPlugin}
          className="w-full min-w-0 @3xl/page-shell:w-56 @3xl/page-shell:shrink-0"
        />

        {/* Active category — the ONE PageBody region for this page. The region
            is named by its heading, so the heading and the region are rendered
            together; with no active category the region carries its own label
            instead of pointing at an id that isn't in the document. */}
        {plugin ? (
          <PageBody labelledBy={ACTIVE_HEADING_ID} gap="content" className="min-w-0">
            <h2 id={ACTIVE_HEADING_ID}>{plugin.name}</h2>
            {activePlugin === PROVIDER_KEYS_TAB_ID ? (
              <ProviderKeysTab />
            ) : valuesLoading ? (
              <SystemState kind="loading" title="Loading settings" />
            ) : valuesError ? (
              // Never render an empty form over values we failed to read — the
              // user could save it and destroy the stored config.
              <SystemState
                kind="error"
                recovery="available"
                scope="section"
                title="Settings could not be loaded"
                description={valuesError}
                action={<Button variant="outline" onClick={refreshValues}>Try again</Button>}
              />
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
          </PageBody>
        ) : (
          <PageBody
            label="Active settings category"
            gap="content"
            className="min-w-0"
            state={
              <SystemState
                kind="initial-empty"
                title="No category selected"
                description="Choose a settings category from the list."
              />
            }
          />
        )}
      </div>
    </SettingsFrame>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/settings',
  component: SettingsRoute,
})
