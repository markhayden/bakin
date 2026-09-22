import '@makinbakin/sdk/styles.css'
import { createRoot } from 'react-dom/client'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { MemoryShell } from '../components/memory-shell'

const results = [
  { id: 'durable:editorial', table: 'bakin_memory', score: 0.9, fields: {
    title: 'Editorial review and cross-channel publication guidelines', tier: 'durable', agent: 'pixel',
    snippet: 'Keep source attribution and approval evidence with the finished publication. Review before posting.', updated_at: 1768474800000,
  } },
  { id: 'session:notes', table: 'bakin_memory', score: 0.5, fields: {
    title: 'Archive review notes', tier: 'session', agent: 'editorial-review-and-publication',
    snippet: 'A completed session with a longer agent identity and unknown update date.',
  } },
]
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/memory', network: [
    { path: '/api/plugins/memory/recent?limit=30', status: 200, json: { results } },
    { path: '/api/plugins/memory/status', status: 200, json: { countsByTier: { durable: 1, session: 1 }, totalRows: 2, offsetsTracked: 2, lastUpdated: 1768474800000 } },
  ] }} registrations={[{ id: 'memory', routes: { '/memory': MemoryShell } }]} />)
