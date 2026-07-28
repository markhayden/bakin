// @vitest-environment jsdom
/**
 * #687 unified ecosystem lane (Capabilities tab): paste-ref CTA → trust
 * preview in a DRAWER (risk warnings, requirements, verdict) → consent →
 * install call shape; installed ecosystem list with modal-confirmed
 * removal. Stubbed fetch; no server.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
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
}))

const toasts: string[] = []
mock.module('@makinbakin/sdk/hooks', () => ({
  toast: (message: string) => {
    toasts.push(message)
  },
  useJsonFetch: (url: string) => ({
    data: listData,
    loading: false,
    error: null,
    refresh: () => {
      refreshCalls.push(url)
    },
  }),
}))

mock.module('@makinbakin/sdk/components', () => ({
  BakinDrawer: ({ children, open, title }: { children: ReactNode; open: boolean; title?: ReactNode }) =>
    open ? (
      <div role="dialog" aria-label="drawer">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
  ConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) =>
    open ? (
      <div role="alertdialog">
        <span>{title}</span>
        <button onClick={onConfirm}>confirm-remove</button>
      </div>
    ) : null,
}))

let listData: { managed: unknown[]; unmanaged: unknown[] } = { managed: [], unmanaged: [] }
const refreshCalls: string[] = []
const fetchCalls: Array<{ url: string; body?: unknown }> = []
let fetchResponses: Record<string, unknown> = {}

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
  requirements: { secrets: [{ name: 'WEATHER_KEY', required: true }], prereqs: [{ name: 'jq', probe: 'jq', optional: false }] },
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
  fetchResponses = {}
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const responseBody = fetchResponses[url] ?? { ok: false, error: 'unexpected url' }
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
    fireEvent.change(screen.getByTestId('hub-ref-input'), { target: { value: 'https://clawhub.ai/steipete/skills/weather' } })
    fireEvent.click(screen.getByTestId('hub-preview-button'))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText(/Install weather v2\.0\.1/)).toBeTruthy()
    expect(screen.getByText(/verdict: clean/)).toBeTruthy()
    expect(screen.getByTestId('risk-warnings').textContent).toContain('curl-pipe-shell')
    expect(screen.getByText(/WEATHER_KEY/)).toBeTruthy()
    expect(screen.getByText(/12,345 downloads/)).toBeTruthy()

    fireEvent.click(screen.getByTestId('confirm-install'))
    await settleReact()

    const install = fetchCalls.find((c) => c.url === '/api/skills/install')
    expect(install?.body).toMatchObject({ consentToken: 'tok-ui-1' })
    expect(toasts.join(' ')).toContain('add its key')
    expect(refreshCalls.length).toBeGreaterThan(0)
  })

  it('refusals render in the CTA box, no drawer opens', async () => {
    fetchResponses['/api/skills/preview'] = { ok: false, refused: true, error: 'ClawHub has blocked this skill as malware' }
    render(<HubSkillsSection />)
    fireEvent.change(screen.getByTestId('hub-ref-input'), { target: { value: 'clawhub:@evil/bad' } })
    fireEvent.click(screen.getByTestId('hub-preview-button'))
    await waitFor(() => expect(screen.getByTestId('hub-box-error').textContent).toContain('Refused'))
    expect(screen.queryByRole('dialog')).toBeNull()
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
    fetchResponses[`/api/packages/${encodeURIComponent('hub-weather@2.0.1')}`] = { ok: true }

    render(<HubSkillsSection />)
    expect(screen.getByText('Installed')).toBeTruthy()
    // Curated installs live in the SAME list as hub installs (live-test
    // feedback: group by installed vs available, never by source)…
    expect(screen.getByText('weather')).toBeTruthy()
    expect(screen.getByText('brave-search')).toBeTruthy()
    // …with source as a chip.
    expect(screen.getByText('clawhub')).toBeTruthy()
    expect(screen.getByText('official')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Remove weather'))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    fireEvent.click(screen.getByText('confirm-remove'))
    await settleReact()

    const del = fetchCalls.find((c) => c.url.includes('/api/packages/'))
    expect(del?.url).toBe(`/api/packages/${encodeURIComponent('hub-weather@2.0.1')}`)
    expect(toasts.join(' ')).toContain('removed')
  })

  it('empty install state shows only the get-more section', () => {
    render(<HubSkillsSection />)
    expect(screen.queryByText('Installed')).toBeNull()
    expect(screen.getByText('Get more capabilities')).toBeTruthy()
  })
})
