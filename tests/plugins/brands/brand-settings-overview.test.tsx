// @vitest-environment jsdom
/**
 * Settings + DangerZone, publish confirm, drafting banner, overview kit
 * checklist, and route states (UX cleanup spec §7b/§7g/§7h).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

// jsdom component test — no storage access. Defensive content-dir mocks per
// the repo's test-isolation convention.
const testDir = join(tmpdir(), 'bakin-test-brand-settings')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
// Defensive: this is a pure fetch-mocked component test; the tasks board is
// only ever reached through the mocked global fetch, never the task store.
mock.module('../../../src/core/task-store', () => ({}))

const navigateMock = mock()
mock.module('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ brandId: 'acme' }),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}))

// Parametrizable query-state mock: tab starts at default; draftTask reads a var.
let draftTaskParam = ''
mock.module('@/hooks/use-query-state', () => ({
  useQueryState: (key: string, defaultValue: string) => {
    const React = require('react') as typeof import('react')
    const [v, setV] = React.useState(key === 'draftTask' ? draftTaskParam : defaultValue)
    return [v, setV]
  },
}))
mock.module('@/components/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => <pre>{content}</pre>,
}))

import { BrandDetail } from '../../../plugins/brands/components/brand-detail'

function makeBrand(draft: boolean) {
  return {
    id: 'acme',
    name: 'Acme',
    palette: [],
    logos: [],
    assetGroups: [],
    ...(draft ? { draft: true } : {}),
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

const COMPLETENESS = {
  percent: 25,
  items: [
    { key: 'logo', label: 'Add a logo', done: false, hint: 'The face of the brand.', fixTab: 'assets' },
    { key: 'palette', label: 'Set at least 3 colors', done: false, hint: 'Agents pull these exact values.', fixTab: 'identity' },
    { key: 'description', label: 'Write a description', done: true, hint: 'First thing agents read.', fixTab: 'identity' },
  ],
}

let calls: Array<{ url: string; method: string }>
function mockApi({ draft = false, blocked = {} as Record<string, string>, notFound = false } = {}) {
  calls = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url.endsWith('/api/plugins/brands/acme') && method === 'GET') {
      if (notFound) return new Response(JSON.stringify({ error: 'brand not found' }), { status: 404 })
      return new Response(
        JSON.stringify({ brand: makeBrand(draft), guidelines: [], lessons: [], fingerprint: 'sha256:x', completeness: COMPLETENESS }),
        { status: 200 },
      )
    }
    if (url.endsWith('/blocked-tasks')) return new Response(JSON.stringify({ perTask: blocked }), { status: 200 })
    if (url.endsWith('/publish')) return new Response(JSON.stringify({ brand: makeBrand(false) }), { status: 200 })
    if (method === 'DELETE') return new Response('{}', { status: 200 })
    if (url.endsWith('/api/plugins/tasks/')) {
      return new Response(JSON.stringify({ columns: { todo: [{ brandId: 'acme' }, { brandId: 'other' }] } }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  navigateMock.mockClear()
  draftTaskParam = ''
  mockApi()
})

afterEach(() => cleanup())

async function renderDetail(onBack = () => {}) {
  render(<BrandDetail brandId="acme" onBack={onBack} />)
  await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
}

describe('overview kit checklist', () => {
  it('renders server completeness with percent and jump links', async () => {
    await renderDetail()
    expect(screen.getByText('Finish your kit')).toBeDefined()
    expect(screen.getByText('25%')).toBeDefined()
    fireEvent.click(document.querySelector('[data-kit-item="logo"]')!)
    // jump link lands on the assets tab
    await waitFor(() => expect(screen.getByText(/The face of the brand — the first logo/)).toBeDefined())
    await settleReact()
  })
})

describe('drafting banner', () => {
  it('renders for drafts with the blocked-task count', async () => {
    mockApi({ draft: true, blocked: { 't1': 'acme', 't2': 'acme', 't3': 'other' } })
    await renderDetail()
    await waitFor(() => expect(document.querySelector('[data-draft-banner]')).not.toBeNull())
    expect(screen.getByText(/2 tasks are waiting on this brand/)).toBeDefined()
    expect(document.querySelector('[data-draft-task-link]')).toBeNull() // no task id known
    await settleReact()
  })

  it('links the drafting task when ?draftTask= is present', async () => {
    draftTaskParam = 'task-99'
    mockApi({ draft: true })
    await renderDetail()
    await waitFor(() => expect(document.querySelector('[data-draft-task-link]')).not.toBeNull())
    fireEvent.click(document.querySelector('[data-draft-task-link]')!)
    expect(navigateMock).toHaveBeenCalledWith(expect.objectContaining({ to: '/tasks', search: { taskId: 'task-99' } }))
    await settleReact()
  })

  it('absent for published brands', async () => {
    await renderDetail()
    expect(document.querySelector('[data-draft-banner]')).toBeNull()
    await settleReact()
  })
})

describe('publish flow', () => {
  it('publish goes through a confirm and POSTs on confirm', async () => {
    mockApi({ draft: true })
    await renderDetail()
    await waitFor(() => expect(document.querySelector('[data-draft-banner]')).not.toBeNull())
    fireEvent.click(screen.getAllByRole('button', { name: /Publish/ })[0])
    await screen.findByText('Publish Acme?')
    expect(calls.some((c) => c.url.endsWith('/publish'))).toBe(false) // not yet
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }))
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/publish') && c.method === 'POST')).toBe(true))
    await settleReact()
  })
})

describe('settings + danger zone', () => {
  async function openSettings() {
    await renderDetail()
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(document.querySelector('[data-danger-zone]')).not.toBeNull())
  }

  it('danger zone sits at the bottom and names the open-task consequences', async () => {
    await openSettings()
    const settingsCards = Array.from(document.querySelectorAll('[data-section-card], [data-danger-zone]'))
    expect(settingsCards[settingsCards.length - 1]?.hasAttribute('data-danger-zone')).toBe(true)
    await waitFor(() => expect(screen.getByText(/1 open task links to it and will pause/)).toBeDefined())
    await settleReact()
  })

  it('delete requires typing the brand id, then DELETEs and navigates back', async () => {
    const onBack = mock()
    render(<BrandDetail brandId="acme" onBack={onBack} />)
    await waitFor(() => expect(screen.getAllByText('Acme').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(document.querySelector('[data-danger-zone-trigger]')).not.toBeNull())

    fireEvent.click(document.querySelector('[data-danger-zone-trigger]')!)
    const confirmBtn = await screen.findByTestId('danger-zone-confirm')
    expect(confirmBtn).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByPlaceholderText('acme'), { target: { value: 'acme' } })
    fireEvent.click(screen.getByTestId('danger-zone-confirm'))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    await settleReact()
  })
})

describe('route states', () => {
  it('bad brand id renders the honest not-found state', async () => {
    mockApi({ notFound: true })
    render(<BrandDetail brandId="acme" onBack={() => {}} />)
    await waitFor(() => expect(screen.getByText("This brand doesn't exist")).toBeDefined())
    await settleReact()
  })

  it('shows a skeleton while loading, never a blank pane', () => {
    globalThis.fetch = mock(() => new Promise(() => {})) as unknown as typeof fetch
    render(<BrandDetail brandId="acme" onBack={() => {}} />)
    expect(document.querySelector('[data-brand-detail-loading]')).not.toBeNull()
  })
})
