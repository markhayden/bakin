// @vitest-environment jsdom
/**
 * Dedicated doc editor route + doc lists (UX cleanup spec §7d/§7e): rows open
 * the editor route, the Always-in-context switch stages cardDocs, the new-doc
 * dialog auto-appends .md, delete confirms, and the editor page saves with
 * dirty state + honest not-found.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-brand-doc-editor')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

const navigateMock = mock()
let routeParams: Record<string, string> = {}
let routeSearch: Record<string, string> = {}
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useParams: () => routeParams,
  useSearch: () => routeSearch,
  useLocation: () => ({ pathname: '/brands/acme/docs/guidelines/voice.md', search: routeSearch }),
  useRouter: () => ({ history: { block: () => () => {} }, parseLocation: (l: unknown) => l }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (_key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    return React.useState(defaultValue)
  },
}))
// The brainstorm panel pulls the conversation kit + agent store — its own concern.
mock.module('../../../plugins/brands/components/brand-doc-brainstorm', () => ({
  DocBrainstormPanel: () => <div data-testid="brainstorm-panel" />,
}))

import { BrandDetail } from '../../../plugins/brands/components/brand-detail'
import { BrandDocEditorPage } from '../../../plugins/brands/components/brand-doc-editor'

const BRAND = {
  id: 'acme',
  name: 'Acme',
  palette: [],
  logos: [],
  assetGroups: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
}

const DETAIL = {
  brand: BRAND,
  guidelines: [
    { name: 'voice.md', description: 'How Acme talks', bytes: 1200 },
    { name: 'style-guide.md', bytes: 900 },
  ],
  lessons: [{ name: 'launch-learnings.md', description: 'What the launch taught us', bytes: 400 }],
  fingerprint: 'sha256:x',
}

let fetchCalls: Array<{ url: string; method: string; body?: unknown }>
beforeEach(() => {
  navigateMock.mockClear()
  fetchCalls = []
  routeParams = { brandId: 'acme', kind: 'guidelines', name: 'voice.md' }
  routeSearch = {}
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    fetchCalls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/docs/guidelines/voice.md') && method === 'GET') {
      return new Response(JSON.stringify({ content: '# Voice\n\nSharp and warm.' }), { status: 200 })
    }
    if (url.endsWith('/docs/guidelines/voice.md') && method === 'PUT') {
      return new Response('{}', { status: 200 })
    }
    if (url.endsWith('/docs/guidelines/ghost.md') && method === 'GET') {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }
    if (url.endsWith('/docs/guidelines/imagery.md') && method === 'GET') {
      // fresh name — create mode's fetch-first probe sees a 404
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }
    if (url.endsWith('/docs/guidelines/existing.md') && method === 'GET') {
      return new Response(JSON.stringify({ content: '# Existing\n\nAlready authored.' }), { status: 200 })
    }
    if (url.includes('/docs/') && method === 'DELETE') {
      return new Response('{}', { status: 200 })
    }
    if (url.endsWith('/api/plugins/brands/acme')) {
      return new Response(JSON.stringify(DETAIL), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
})

afterEach(() => cleanup())

async function renderGuidelines() {
  render(<BrandDetail brandId="acme" onBack={() => {}} />)
  await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
  fireEvent.click(screen.getByRole('tab', { name: 'Guidelines' }))
  await waitFor(() => expect(document.querySelector('[data-doc-row="voice.md"]')).not.toBeNull())
}

describe('doc lists', () => {
  it('doc rows show description and Edit navigates to the editor route', async () => {
    await renderGuidelines()
    expect(screen.getByText('How Acme talks')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: /Edit/ })[0])
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/brands/acme/docs/guidelines/voice.md',
      }),
    )
    await settleReact()
  })

  it('Always-in-context switch STAGES cardDocs (SaveBar appears, no immediate PUT)', async () => {
    await renderGuidelines()
    const row = document.querySelector('[data-doc-row="style-guide.md"]')!
    fireEvent.click(row.querySelector('[role="switch"]')!)
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    expect(fetchCalls.filter((c) => c.method === 'PUT').length).toBe(0)
    await settleReact()
  })

  it('new-doc dialog auto-appends .md and navigates to the editor in create mode', async () => {
    await renderGuidelines()
    fireEvent.click(document.querySelector('[data-new-doc]')!)
    const input = await screen.findByLabelText('File name')
    fireEvent.change(input, { target: { value: 'imagery' } })
    fireEvent.click(document.querySelector('[data-new-doc-create]')!)
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/brands/acme/docs/guidelines/imagery.md',
        search: { create: '1' },
      }),
    )
    await settleReact()
  })

  it('lessons get an Active switch that STAGES disabledLessons (SaveBar up, no PUT)', async () => {
    render(<BrandDetail brandId="acme" onBack={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Lessons' }))
    await waitFor(() => expect(document.querySelector('[data-doc-row="launch-learnings.md"]')).not.toBeNull())

    const row = document.querySelector('[data-doc-row="launch-learnings.md"]')!
    fireEvent.click(row.querySelector('[role="switch"]')!)
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    expect(fetchCalls.filter((c) => c.method === 'PUT').length).toBe(0)
    await settleReact()
  })

  it('delete confirms then DELETEs and refreshes', async () => {
    await renderGuidelines()
    fireEvent.click(screen.getByLabelText('Delete style-guide.md'))
    await screen.findByText('Delete style-guide.md?')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(fetchCalls.some((c) => c.method === 'DELETE' && c.url.endsWith('/docs/guidelines/style-guide.md'))).toBe(true),
    )
    await settleReact()
  })
})

describe('BrandDocEditorPage', () => {
  it('loads the doc, edits raise the SaveBar, Save PUTs the content', async () => {
    render(<BrandDocEditorPage />)
    await waitFor(() => expect(screen.getByLabelText('Acme guidelines content')).toBeDefined())
    expect((screen.getByLabelText('Acme guidelines content') as HTMLTextAreaElement).value).toContain('Sharp and warm')
    expect(document.querySelector('[data-archetype="page"][data-width="full"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="page-header"]')).not.toBeNull()
    expect(document.querySelector('[data-savebar]')).toBeNull()

    fireEvent.change(screen.getByLabelText('Acme guidelines content'), { target: { value: '# Voice\n\nSharper.' } })
    await waitFor(() => expect(document.querySelector('[data-savebar]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Save doc' }))
    await waitFor(() =>
      expect(
        fetchCalls.some(
          (c) => c.method === 'PUT' && c.url.endsWith('/docs/guidelines/voice.md') && (c.body as { content: string }).content.includes('Sharper'),
        ),
      ).toBe(true),
    )
    await settleReact()
  })

  it('brainstorm toggle opens the side panel', async () => {
    render(<BrandDocEditorPage />)
    await waitFor(() => expect(screen.getByLabelText('Acme guidelines content')).toBeDefined())
    expect(screen.queryByTestId('brainstorm-panel')).toBeNull()
    fireEvent.click(document.querySelector('[data-brainstorm-toggle]')!)
    await waitFor(() => expect(screen.getByTestId('brainstorm-panel')).toBeDefined())
    expect(document.querySelector('[data-slot="page-aside"]')).not.toBeNull()
    await settleReact()
  })

  it('create mode starts with the teaching template and the SaveBar up', async () => {
    routeParams = { brandId: 'acme', kind: 'guidelines', name: 'imagery.md' }
    routeSearch = { create: '1' }
    render(<BrandDocEditorPage />)
    await waitFor(() => expect(screen.getByLabelText('Acme guidelines content')).toBeDefined())
    expect((screen.getByLabelText('Acme guidelines content') as HTMLTextAreaElement).value).toContain('description:')
    expect(document.querySelector('[data-savebar]')).not.toBeNull() // unsaved new doc
    await settleReact()
  })

  it('missing doc renders the honest not-found state', async () => {
    routeParams = { brandId: 'acme', kind: 'guidelines', name: 'ghost.md' }
    render(<BrandDocEditorPage />)
    await waitFor(() => expect(screen.getByText(/This document doesn't exist/)).toBeDefined())
    expect(document.querySelector('[data-slot="page-header"]')).not.toBeNull()
    await settleReact()
  })

  it('create mode with a COLLIDING name loads the existing doc — never a blank template over real content', async () => {
    routeParams = { brandId: 'acme', kind: 'guidelines', name: 'existing.md' }
    routeSearch = { create: '1' }
    render(<BrandDocEditorPage />)
    await waitFor(() => expect(screen.getByLabelText('Acme guidelines content')).toBeDefined())
    expect((screen.getByLabelText('Acme guidelines content') as HTMLTextAreaElement).value).toContain('Already authored')
    expect(document.querySelector('[data-savebar]')).toBeNull() // it exists; nothing unsaved
    await settleReact()
  })

  it('a load FAILURE renders a retryable error, not "doesn\'t exist"', async () => {
    routeParams = { brandId: 'acme', kind: 'guidelines', name: 'voice.md' }
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/docs/guidelines/voice.md')) return new Response('boom', { status: 500 })
      if (url.endsWith('/api/plugins/brands/acme')) return new Response(JSON.stringify(DETAIL), { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    render(<BrandDocEditorPage />)
    await waitFor(() => expect(screen.getByText(/Couldn't load this doc/)).toBeDefined())
    expect(screen.queryByText(/This document doesn't exist/)).toBeNull()
    expect(document.querySelector('[data-slot="page-header"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="system-state"]')).not.toBeNull()
    await settleReact()
  })
})
