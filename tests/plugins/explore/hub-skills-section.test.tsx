// @vitest-environment jsdom
/**
 * #687 unified ecosystem lane (Capabilities tab): paste-ref CTA → trust
 * preview in a DRAWER (risk warnings, requirements, verdict) → consent →
 * install call shape; installed ecosystem list with modal-confirmed
 * removal. Stubbed fetch; no server.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { TEST_BOOT_ID, finishedOperation, operationResponse, operationStarted } from '../../helpers/operation-fetch'
import { settleReact } from '../../rtl-settle'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-hub-skills-unused',
  getBakinPaths: () => ({}),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('@makinbakin/sdk/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Drawer: ({ children, open, title }: { children: ReactNode; open: boolean; title?: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label="drawer">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}))

const toasts: string[] = []
// Captured BEFORE the module is mocked (live namespace binding): the SDK's render helpers (useKeyedState, useNow, useMediaQuery) stay real under the narrow mock.
import * as realSdkHooks from '@makinbakin/sdk/hooks'
mock.module('@makinbakin/sdk/hooks', () => ({
  ...realSdkHooks,
  toast: (message: string) => {
    toasts.push(message)
  },
  useJsonFetch: (url: string) => ({
    data: url === '/api/packages/capabilities' ? capabilitiesData : listData,
    loading: false,
    error: null,
    refresh: () => {
      refreshCalls.push(url)
    },
  }),
}))

// `?capability=` is URL state; the section reads it through the navigation kit.
const queryValues: Record<string, string> = {}
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, ...props }: { children: ReactNode; to: string }) => <a href={to} {...props}>{children}</a>,
  useQueryState: (key: string, initial = '') => [queryValues[key] ?? initial, () => {}, () => {}],
}))

mock.module('@makinbakin/sdk/patterns', () => ({
  ConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) =>
    open ? (
      <div role="alertdialog">
        <span>{title}</span>
        <button onClick={onConfirm}>confirm-remove</button>
      </div>
    ) : null,
}))

let listData: { managed: unknown[]; unmanaged: unknown[] } = { managed: [], unmanaged: [] }
let capabilitiesData: { capabilities: unknown[] } | null = { capabilities: [] }
const refreshCalls: string[] = []
const fetchCalls: Array<{ url: string; body?: unknown }> = []
let fetchResponses: Record<string, unknown> = {}
const OPERATION_ROUTES = new Set(['/api/skills/preview', '/api/skills/install', '/api/skills/map/preview'])
let operationCount = 0
/** Removal is an operation (#895): the DELETE answers with a start, the outcome is served from here. */
const operations = new Map([
  ['op-remove', finishedOperation('op-remove', { httpStatus: 200, body: { ok: true, result: { removed: ['hub-weather@2.0.1'] } } })],
])

import { HubSkillsSection } from '../../../plugins/explore/components/hub-skills-section'

const PREVIEW = {
  ref: 'clawhub:@steipete/weather',
  packageId: 'hub-weather',
  skillName: 'weather',
  version: '2.0.1',
  description: 'Get the weather',
  sourceKind: 'clawhub',
  pinnedRef: '2.0.1',
  files: [{ path: 'SKILL.md', bytes: 200 }, { path: 'scripts/get.sh', bytes: 60 }],
  requirements: {
    secrets: [{ name: 'WEATHER_KEY', required: true, secretSlot: 'skills.hub-weather.WEATHER_KEY' }],
    prereqs: [{ name: 'jq', probe: 'jq', optional: false }],
    bins: [], npm: [], models: [], dependencies: [],
  },
  mentions: ['SOME_OTHER_VAR'],
  warnings: [],
  risk: [{ file: 'SKILL.md', line: 9, pattern: 'curl-pipe-shell', snippet: 'curl x | bash' }],
  hub: { downloads: 12345, stars: 67 },
  verdictState: 'clean',
  consentToken: 'tok-ui-1',
}

beforeEach(() => {
  toasts.length = 0
  fetchCalls.length = 0
  refreshCalls.length = 0
  listData = { managed: [], unmanaged: [] }
  capabilitiesData = { capabilities: [] }
  for (const key of Object.keys(queryValues)) delete queryValues[key]
  fetchResponses = {}
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const operation = operationResponse(url, operations)
    if (operation) return operation
    const responseBody = fetchResponses[url] ?? { ok: false, error: 'unexpected url' }
    // The preview / install / map routes are operations (#895): 202 at once,
    // their old body served as the finished operation's result.
    if (OPERATION_ROUTES.has(url)) {
      const id = `op-${url.split('/').pop()}-${++operationCount}`
      operations.set(id, finishedOperation(id, { httpStatus: 200, body: responseBody }))
      return operationStarted(id)
    }
    return new Response(JSON.stringify(responseBody), { status: 200 })
  }) as typeof fetch
})

afterEach(() => {
  // rtl-settle unmounts; fetch stub replaced per-test.
})

describe('ecosystem lane — install flow (drawer)', () => {
  it('paste → preview drawer with trust signals and risk warnings → consent → install', async () => {
    fetchResponses['/api/skills/preview'] = { ok: true, preview: PREVIEW }
    fetchResponses['/api/skills/install'] = { ok: true, installed: { packageId: 'hub-weather' }, warnings: [] }

    render(<HubSkillsSection />)
    act(() => { fireEvent.change(screen.getByTestId('hub-ref-input'), { target: { value: 'https://clawhub.ai/steipete/skills/weather' } }) })
    await act(async () => { fireEvent.click(screen.getByTestId('hub-preview-button')) })

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/Install weather v2\.0\.1/)).toBeTruthy()
    expect(screen.getByText(/verdict: clean/)).toBeTruthy()
    expect(screen.getByTestId('risk-warnings').textContent).toContain('curl-pipe-shell')
    // Name AND its core-minted slot both render (slot disclosure).
    expect(screen.getAllByText(/WEATHER_KEY/).length).toBeGreaterThan(0)
    expect(screen.getByText(/skills\.hub-weather\.WEATHER_KEY/)).toBeTruthy()
    // Hub stats are a labelled KeyValue strip, so the count and its label are
    // separate elements rather than one pre-joined "12,345 downloads" string.
    expect(screen.getByText('Downloads')).toBeTruthy()
    expect(screen.getByText('12,345')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByTestId('confirm-install')) })

    const install = fetchCalls.find((c) => c.url === '/api/skills/install')
    expect(install?.body).toMatchObject({ consentToken: 'tok-ui-1' })
    expect(toasts.join(' ')).toContain('add its key')
    expect(refreshCalls.length).toBeGreaterThan(0)
    await settleReact()
  })

  it('refusals render in the CTA box, no drawer opens', async () => {
    fetchResponses['/api/skills/preview'] = { ok: false, refused: true, error: 'ClawHub has blocked this skill as malware' }
    render(<HubSkillsSection />)
    act(() => { fireEvent.change(screen.getByTestId('hub-ref-input'), { target: { value: 'clawhub:@evil/bad' } }) })
    await act(async () => { fireEvent.click(screen.getByTestId('hub-preview-button')) })
    await waitFor(() => expect(screen.getByTestId('hub-box-error').textContent).toContain('Refused'))
    expect(screen.queryByRole('dialog')).toBeNull()
    // The finally-phase setPreviewBusy(false) re-render lands after the
    // assertion — leaving it in flight can pin a React root open past the
    // test, which hangs the worker on slow CI runners (see tests/rtl-settle).
    await settleReact()
  })
})

describe('ecosystem lane — Installed grouping', () => {
  it('ONE list holds curated packs and hub installs, grouped by installed-ness with source chips', async () => {
    listData = {
      managed: [
        { skillName: 'weather', packageId: 'hub-weather@2.0.1', version: '2.0.1', source: 'clawhub:@steipete/weather', hub: true },
        { skillName: 'brave-search', packageId: 'web-search-brave@1.0.0', version: '1.0.0', source: 'github:markhayden/bakin-bits-official#packs/web-search-brave', hub: false },
      ],
      unmanaged: [{ name: 'hand-rolled', scope: 'global' }],
    }
    fetchResponses[`/api/packages/${encodeURIComponent('hub-weather@2.0.1')}`] = { operationId: 'op-remove', bootId: TEST_BOOT_ID }

    render(<HubSkillsSection />)
    expect(screen.getByText('Installed')).toBeTruthy()
    // Curated installs live in the SAME list as hub installs (live-test
    // feedback: group by installed vs available, never by source)…
    expect(screen.getByText('weather')).toBeTruthy()
    expect(screen.getByText('brave-search')).toBeTruthy()
    // …with source as a chip.
    expect(screen.getByText('clawhub')).toBeTruthy()
    expect(screen.getByText('official')).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByLabelText('Remove weather')) })
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByText('confirm-remove')) })

    const del = fetchCalls.find((c) => c.url.includes('/api/packages/'))
    expect(del?.url).toBe(`/api/packages/${encodeURIComponent('hub-weather@2.0.1')}`)
    await waitFor(() => expect(toasts.join(' ')).toContain('removed'))
    await settleReact()
  })

  it('readiness legs ride each installed row; ?capability= highlights, focuses and offers the key link (1.4c-2)', async () => {
    listData = {
      managed: [
        { skillName: 'weather', packageId: 'hub-weather@2.0.1', version: '2.0.1', source: 'clawhub:@steipete/weather', hub: true },
        { skillName: 'brave-search', packageId: 'web-search-brave@1.0.0', version: '1.0.0', source: 'github:markhayden/bakin-bits-official#packs/web-search-brave', hub: false, capability: 'web-search' },
      ],
      unmanaged: [],
    }
    capabilitiesData = {
      capabilities: [
        { capability: 'weather', packageId: 'hub-weather', version: '2.0.1', name: 'Weather', ready: true, missing: [], secrets: [], prereqs: [] },
        {
          capability: 'web-search', packageId: 'web-search-brave', version: '1.0.0', name: 'Brave web search', ready: false,
          missing: ['Secret BRAVE_API_KEY is not set (skills.web-search-brave.BRAVE_API_KEY)', 'jq is not installed: brew install jq'],
          secrets: [{ name: 'BRAVE_API_KEY', required: true, secretSlot: 'skills.web-search-brave.BRAVE_API_KEY', status: 'missing' }],
          prereqs: [{ name: 'jq', kind: 'binary', help: 'brew install jq', optional: false, status: 'missing' }],
        },
      ],
    }
    queryValues.capability = 'web-search'

    render(<HubSkillsSection />)
    await settleReact()
    // Every installed row says whether it can run — the engine's verdict, never a guess.
    expect(screen.getByText('Ready')).toBeTruthy()
    const legs = screen.getByTestId('capability-legs-web-search')
    expect(legs.textContent).toContain('Not ready')
    expect(legs.textContent).toContain('Secret BRAVE_API_KEY is not set')
    expect(legs.textContent).toContain('brew install jq')
    const keyLink = screen.getByRole('link', { name: /Add the key in Settings/ })
    expect(keyLink.getAttribute('href')).toBe('/settings?tab=integrations')
    // The deep-linked row is the highlighted, focused one; the ready row is not.
    const rows = document.querySelectorAll<HTMLElement>('[data-capability-row]')
    const highlighted = Array.from(rows).filter((row) => row.getAttribute('data-highlighted') === 'true')
    expect(highlighted.map((row) => row.getAttribute('data-capability-row'))).toEqual(['web-search-brave@1.0.0'])
    expect(document.activeElement).toBe(highlighted[0]!)
  })

  it('a ready-only install shows no Not-ready legs and no key link', async () => {
    listData = { managed: [{ skillName: 'weather', packageId: 'hub-weather@2.0.1', version: '2.0.1', source: 'clawhub:@steipete/weather', hub: true }], unmanaged: [] }
    capabilitiesData = { capabilities: [{ capability: 'weather', packageId: 'hub-weather', version: '2.0.1', name: 'Weather', ready: true, missing: [], secrets: [], prereqs: [] }] }
    render(<HubSkillsSection />)
    await settleReact()
    expect(screen.queryByText('Not ready')).toBeNull()
    expect(screen.queryByRole('link', { name: /Add the key/ })).toBeNull()
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull()
  })

  it('empty install state shows only the get-more section', async () => {
    render(<HubSkillsSection />)
    expect(screen.queryByText('Installed')).toBeNull()
    expect(screen.getByText('Get more capabilities')).toBeTruthy()
    await settleReact()
  })
})
