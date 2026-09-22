import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { ExplorePage } from '../components/explore-page'
import { catalogEntries } from './ui.fixture-data'

createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/explore', network: [
    { path: '/api/plugins/explore/catalog', status: 200, json: { ok: true, entries: catalogEntries, activeAdapter: 'pi', updatedAt: '2026-01-15T12:00:00.000Z', remoteUpdatedAt: null } },
  ] }} registrations={[{ id: 'explore', routes: { '/explore': ExplorePage } }]} />)
