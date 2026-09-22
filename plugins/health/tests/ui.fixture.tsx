import '@makinbakin/sdk/styles.css'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { SystemInventory, type SystemInventoryHandle } from '../components/system-inventory'
import { SystemSearchSection } from '../components/system-search-section'
import type { SystemRegistryData, SystemPluginManifestData } from '../hooks/use-system-data'
import type { SearchHealthData } from '../types'
import { collectionReport } from './collection-report'
import { OverviewAlerts } from '../components/overview-alerts'
import { buildHealthOverviewViewModel } from '../lib/health-view-model'

const registry: SystemRegistryData = { plugins: [
  { id: 'assets', name: 'Assets', version: '1.2.0', source: 'built-in', status: 'active', routes: 12, description: 'Asset management' },
  { id: 'editorial', name: 'Editorial publishing and cross-channel approval connector', version: '1.0.0', source: 'user', status: 'active', routes: 3, description: 'Publishing' },
  { id: 'broken', name: 'Unavailable connector', version: '1.0.0', source: 'user', status: 'failed', routes: 0, description: 'Missing integration', errorMessage: 'Activation stopped because a required integration was not available.', missingDependencies: ['external-calendar-provider'] },
] }
const manifest: SystemPluginManifestData = { plugins: registry.plugins.map(plugin => ({
  id: plugin.id, name: plugin.name, version: plugin.version, source: 'local', status: plugin.status,
  installed: { version: plugin.version }, upgradeAvailable: plugin.id === 'editorial', latestVersion: '1.1.0', staleHintDays: null,
})) }
const search: SearchHealthData = { enabled: true, engineReachable: true, tables: [
  { logical: 'bakin_editorial_publication_history', physical: 'bakin_editorial_publication_history_v3_fp123', pluginId: 'editorial', schemaVersion: 3, state: 'migrating', phase: 'parked', healthy: false, docCount: 142, journalPending: 7, lastIndexedAt: 1768474800000, lastRebuildAt: null, legs: [{ name: 'embedding', totalIndexed: 120, rebuilding: true, pending: 22, error: 'Embedding provider temporarily unavailable' }] },
  { logical: 'bakin_assets', physical: 'bakin_assets_v1_fp456', pluginId: 'assets', schemaVersion: 1, state: 'active', phase: null, healthy: true, docCount: null, journalPending: 0, lastIndexedAt: null, lastRebuildAt: null, legs: [] },
] }
const idle = { status: 'idle' as const, message: null, target: null }
function SystemFixture() {
  const inventory = useRef<SystemInventoryHandle>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { inventory.current?.revealPlugins(); inventory.current?.revealChecks() }, [])
  return <Page><PageHeader title="Health" description="System inventories" /><PageBody>
    <OverviewAlerts model={buildHealthOverviewViewModel({ report: collectionReport })} onRerun={() => {}} />
    <SystemSearchSection readiness={null} status={search} telemetry={null} mutation={idle} onReindex={() => {}} technicalDetailsOpen />
    <SystemInventory ref={inventory} report={collectionReport} live={null} registry={registry} manifest={manifest}
      pluginInventoryCurrent pluginMutation={idle} pluginSearch={query} onPluginSearchChange={setQuery}
      onCheckUpdates={() => {}} onUpgrade={() => {}} />
  </PageBody></Page>
}
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/health?tab=system' }}
  registrations={[{ id: 'health', routes: { '/health': SystemFixture } }]}
/> )
