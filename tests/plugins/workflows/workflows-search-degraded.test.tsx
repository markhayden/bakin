// @vitest-environment jsdom

/**
 * WorkflowsPage — honest search signals (spec D11 / search-trust-and-speed
 * WS6/T16).
 *
 * Unlike workflows-page.test.tsx (which stubs useSearch wholesale), this file
 * keeps the REAL `useSearch` hook and stubs `fetch` so the plugin search
 * route answers 503 `{ error: 'search_unavailable' }` (engine down) or a
 * `meta.partial` response (budget degrade). The page must show:
 *   - a loading indicator while the search is in flight,
 *   - the "Search is unavailable — showing basic text matching" chip on 503
 *     WHILE the substring fallback keeps the list browsable,
 *   - the SearchPartialChip when the response is partial.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Test isolation mocks (mandatory per CLAUDE.md) ─────────────────────────

const testDir = join(tmpdir(), `bakin-test-workflows-degraded-${process.pid}-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
  watchPath: mock(),
}))

mock.module('@/core/task-store', () => ({
  createTask: mock(),
  addTaskLog: mock(),
  moveTask: mock(),
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  getTask: mock(() => null),
  getTaskWithColumn: mock(() => null),
}))

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Stubbed dep web (per workflows-page.test.tsx) ──────────────────────────

// useQueryState backed by React state so typing in the search input works.
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))

mock.module('@bakin/workflows/components/workflow-card', () => ({
  WorkflowCard: ({ template }: { template: { filename: string; name: string } }) => (
    <div data-testid={`card-${template.filename}`}>{template.name}</div>
  ),
}))

// Import AFTER mocks. useSearch stays REAL — engine states arrive via fetch.
import { WorkflowsPage } from '../../../plugins/workflows/components/workflows-page'

// ─── Fixtures + fetch stub ──────────────────────────────────────────────────

const TEMPLATES = [
  { filename: 'content-pipeline', name: 'Content Pipeline', source: 'plugin', definition: { name: 'Content Pipeline', description: 'Generate and publish content', steps: [] } },
  { filename: 'onboarding', name: 'onboarding', source: 'user', definition: { name: 'onboarding', description: 'Welcome new agents', steps: [] } },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubSearchFetch(searchImpl: () => Response) {
  vi.stubGlobal('fetch', mock(async (url: string | URL) => {
    const u = String(url)
    if (u.includes('/search')) return searchImpl()
    return json({ templates: TEMPLATES })
  }))
}

async function renderAndSearch(query: string) {
  render(<WorkflowsPage />)
  await waitFor(() => {
    expect(screen.getByTestId('card-content-pipeline')).toBeDefined()
  })
  fireEvent.change(screen.getByRole('searchbox', { name: 'Workflow search' }), { target: { value: query } })
}

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('WorkflowsPage — search signals', () => {
  it('shows loading, then the degraded chip on 503 — substring fallback keeps working', async () => {
    stubSearchFetch(() => json({ error: 'search_unavailable' }, 503))

    await renderAndSearch('onboard')

    // In-flight search → progress stays inside the field so the page does not reflow.
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Workflow search' }).getAttribute('aria-busy')).toBe('true')
      expect(screen.getByRole('status').textContent).toContain('Searching Workflow search')
    })

    // Engine down → the honest degraded chip…
    await waitFor(() => {
      expect(screen.getByTestId('workflows-search-degraded')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.getByRole('searchbox', { name: 'Workflow search' }).getAttribute('aria-busy')).toBeNull()
    expect(document.querySelector('[data-slot="search-input-progress"]')).toBeNull()

    // …while basic text matching keeps the list usable.
    expect(screen.getByTestId('card-onboarding')).toBeDefined()
    expect(screen.queryAllByTestId('card-content-pipeline').length).toBe(0)
  })

  it('shows the SearchPartialChip when the response is partial', async () => {
    stubSearchFetch(() => json({
      results: [{ id: 'def:onboarding', table: 'bakin_workflows', score: 0.9, fields: { name: 'onboarding' } }],
      aggregations: {},
      meta: {
        query: 'onboard',
        total: 1,
        took_ms: 7,
        source: 'search',
        partial: true,
        tables: [{ table: 'bakin_workflows', hits: 1, took_ms: 7, budget: 'degraded' as const }],
      },
    }))

    await renderAndSearch('onboard')

    await waitFor(() => {
      expect(screen.getByTestId('search-partial-chip')).toBeDefined()
    }, { timeout: 3000 })
    expect(screen.queryAllByTestId('workflows-search-degraded').length).toBe(0)
    expect(screen.getByTestId('card-onboarding')).toBeDefined()
  })

  it('renders no signal row for a healthy complete search', async () => {
    stubSearchFetch(() => json({
      results: [{ id: 'def:onboarding', table: 'bakin_workflows', score: 0.9, fields: { name: 'onboarding' } }],
      aggregations: {},
      meta: { query: 'onboard', total: 1, took_ms: 3, source: 'search' },
    }))

    await renderAndSearch('onboard')

    await waitFor(() => {
      expect(screen.getByTestId('card-onboarding')).toBeDefined()
      expect(screen.getByRole('searchbox', { name: 'Workflow search' }).getAttribute('aria-busy')).toBeNull()
      expect(document.querySelector('[data-slot="search-input-progress"]')).toBeNull()
    }, { timeout: 3000 })
    expect(screen.queryAllByTestId('workflows-search-degraded').length).toBe(0)
    expect(screen.queryAllByTestId('search-partial-chip').length).toBe(0)
  })
})
