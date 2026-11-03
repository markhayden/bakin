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
  // Title-width regression rows (#1040): a dotted identifier, a long sentence,
  // and an unbroken exec identifier (audit-shaped titles on an always-visible
  // tier), each beside a snippet long enough to claim the whole row under
  // automatic table layout.
  { id: 'audit:saved', table: 'bakin_memory', score: 0.4, fields: {
    title: 'assets.asset.saved', tier: 'session', agent: 'pixel',
    snippet: 'Saved launch-hero-v3.png as a new asset version with enrichment queued, thumbnails rendered, and the manifest pointer moved to the newest file so the board shows the latest render.', updated_at: 1768474800000,
  } },
  { id: 'durable:iterate', table: 'bakin_memory', score: 0.3, fields: {
    title: "Iterate on what's wrong, not on the whole thing", tier: 'durable', agent: 'pixel',
    snippet: 'When a review flags one section, revise that section and keep the approved parts verbatim rather than regenerating the complete draft from scratch.', updated_at: 1768474800000,
  } },
  { id: 'audit:exec', table: 'bakin_memory', score: 0.2, fields: {
    title: 'exec:bakin_exec_assets_save:launch-hero-v3-final-approved-render-2026-01-15', tier: 'session', agent: 'pixel',
    snippet: 'Exec tool call completed in 412ms with one asset written and no warnings.', updated_at: 1768474800000,
  } },
]
createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/memory', network: [
    { path: '/api/plugins/memory/recent?limit=30', status: 200, json: { results } },
    { path: '/api/plugins/memory/status', status: 200, json: { countsByTier: { durable: 2, session: 3 }, totalRows: 5, offsetsTracked: 5, lastUpdated: 1768474800000 } },
  ] }} registrations={[{ id: 'memory', routes: { '/memory': MemoryShell } }]} />)
