import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { ExplorePage } from '../components/explore-page'
import { catalogEntries } from './ui.fixture-data'

createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/explore?tab=capabilities', network: [
    { path: '/api/plugins/explore/catalog', status: 200, json: { ok: true, entries: catalogEntries, activeAdapter: 'pi', updatedAt: '2026-01-15T12:00:00.000Z', remoteUpdatedAt: null } },
    { path: '/api/skills', status: 200, json: { managed: [
      { skillName: 'brave-search', packageId: 'web-search-brave@1.0.0', version: '1.0.0', source: 'github:markhayden/bakin-bits-official#packs/web-search-brave', hub: false },
      { skillName: 'publication-research-and-source-verification', packageId: 'hub-research@2.0.1', version: '2.0.1', source: 'github:example/research-skills#skills/publication-research-and-source-verification', hub: true },
    ], unmanaged: [] } },
  ] }} registrations={[{ id: 'explore', routes: { '/explore': ExplorePage } }]} />)
