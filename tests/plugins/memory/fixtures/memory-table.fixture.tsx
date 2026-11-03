/**
 * Browser fixture for tests/plugins/memory/memory-table-layout.browser.test.ts:
 * the Memory results table mounted directly (no shell, no search request)
 * with the #1040 rows, so the test can show the debug-only Score column —
 * the shell only adds it when global debug is on AND a query is active,
 * and a live query would need the search endpoint. The query is injected
 * at build time (`process.env.MEMORY_FIXTURE_QUERY`), and debug mode is
 * switched on through the public `useDebug` toggle on mount when
 * `process.env.MEMORY_FIXTURE_DEBUG` is set (the host shell's initializer,
 * which reads the localStorage seed, does not run inside a fixture).
 */
import '@makinbakin/sdk/styles.css'
import { useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useDebug } from '@makinbakin/sdk/hooks'
import { DEFAULT_PLUGIN_UI_FIXTURE, PluginUiFixtureHost } from '@makinbakin/sdk/testing/ui'
import { MemorySearchResults } from '../../../../plugins/memory/components/memory-search-results'

const query = process.env.MEMORY_FIXTURE_QUERY ?? ''
const wantDebug = process.env.MEMORY_FIXTURE_DEBUG === '1'
const updated = 1768474800000
const indexScores = { fts: 0.42, semantic: 0.37 }
const results = [
  { id: 'durable:editorial', table: 'bakin_memory', score: 0.9, indexScores, fields: {
    title: 'Editorial review and cross-channel publication guidelines', tier: 'durable', agent: 'pixel',
    snippet: 'Keep source attribution and approval evidence with the finished publication. Review before posting.', updated_at: updated,
  } },
  { id: 'session:notes', table: 'bakin_memory', score: 0.5, indexScores, fields: {
    title: 'Archive review notes', tier: 'session', agent: 'editorial-review-and-publication',
    snippet: 'A completed session with a longer agent identity and unknown update date.',
  } },
  { id: 'session:saved', table: 'bakin_memory', score: 0.4, indexScores, fields: {
    title: 'assets.asset.saved', tier: 'session', agent: 'pixel',
    snippet: 'Saved launch-hero-v3.png as a new asset version with enrichment queued, thumbnails rendered, and the manifest pointer moved to the newest file so the board shows the latest render.', updated_at: updated,
  } },
  { id: 'durable:iterate', table: 'bakin_memory', score: 0.3, indexScores, fields: {
    title: "Iterate on what's wrong, not on the whole thing", tier: 'durable', agent: 'pixel',
    snippet: 'When a review flags one section, revise that section and keep the approved parts verbatim rather than regenerating the complete draft from scratch.', updated_at: updated,
  } },
  { id: 'session:exec', table: 'bakin_memory', score: 0.2, indexScores, fields: {
    title: 'exec:bakin_exec_assets_save:launch-hero-v3-final-approved-render-2026-01-15', tier: 'session', agent: 'pixel',
    snippet: 'Exec tool call completed in 412ms with one asset written and no warnings.', updated_at: updated,
  } },
]

function MemoryTablePage() {
  const [debug, toggleDebug] = useDebug()
  useEffect(() => {
    if (wantDebug && !debug) toggleDebug()
  }, [debug, toggleDebug])
  if (wantDebug && !debug) return null
  return (
    <div className="p-bakin-4">
      <MemorySearchResults results={results} loading={false} error={null} query={query} onSelect={() => {}} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<PluginUiFixtureHost
  fixture={{ ...DEFAULT_PLUGIN_UI_FIXTURE, route: '/memory', network: [] }}
  registrations={[{ id: 'memory', routes: { '/memory': MemoryTablePage } }]}
/>)
