/**
 * IncidentRow (#690): cards render EFFECTIVE urgency with a plain-language
 * category chip, and a demoted incident says so instead of hiding it.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-incident-row-${Date.now()}`)

// Defensive content-dir mocks per CLAUDE.md.
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const routerPush = mock()
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, className, ...rest }: { children: React.ReactNode; to: string; className?: string; [key: string]: unknown }) => <a href={to} className={className} {...rest}>{children}</a>,
  useRouter: () => ({ push: routerPush, replace: mock(), back: mock(), forward: mock(), prefetch: mock(), refresh: mock() }),
}))
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'
import type { HealthIncident } from '@makinbakin/sdk/types'
import { IncidentRow } from '@bakin/health/components/incident-row'
import { resetTerminalHandoffForTests } from '@bakin/health/components/use-terminal-handoff'
import { isHandoffReturnArmed, resetHandoffReturnForTests } from '@bakin/health/components/handoff-return'
import type { OverviewIncident } from '@bakin/health/lib/health-view-model'

afterEach(cleanup)

function item(overrides: Partial<HealthIncident> = {}): OverviewIncident {
  return {
    incident: {
      id: 'health:test:incident',
      status: 'warning',
      disposition: 'watch',
      effectiveDisposition: 'watch',
      title: 'Something needs review',
      impact: 'Operator impact statement.',
      subject: { kind: 'system', id: 'fixture' },
      resources: [],
      resolution: { key: 'diagnose-check-failure', type: 'repair', label: 'Investigate', actionId: 'core.diagnose' },
      declarationId: 'fixture',
      required: false,
      observationIds: ['obs-1'],
      observedAt: '2026-07-13T12:00:00.000Z',
      staleAt: '2026-07-13T12:30:00.000Z',
      stale: false,
      ...overrides,
    },
    observations: [],
    oldestEvidenceAt: '2026-07-13T12:00:00.000Z',
    freshness: 'fresh',
    verificationFailure: false,
  }
}

describe('IncidentRow (#690)', () => {
  it('links the open repair task working the incident (spec D-G2), and shows no link without one', () => {
    render(<IncidentRow item={item({ repairTaskId: 'task-abc' })} />)
    const link = screen.getByRole('link', { name: 'Open the repair task for Something needs review' })
    expect(link.getAttribute('href')).toBe('/tasks?taskId=task-abc')
    cleanup()
    render(<IncidentRow item={item()} />)
    expect(screen.queryByRole('link', { name: /Open the repair task/ })).toBeNull()
  })

  it('links the Updates row that would resolve the incident (#1007 D7.7), and shows no link without one', () => {
    const linked = item({ resources: [{ kind: 'plugin', id: 'terminal', label: 'Terminal' }] })
    linked.updateId = 'plugin:terminal'
    render(<IncidentRow item={linked} />)
    const link = screen.getByRole('link', { name: 'View the update for Something needs review' })
    expect(link.getAttribute('href')).toBe('/health?tab=updates&update=plugin%3Aterminal')
    cleanup()
    render(<IncidentRow item={item({ resources: [{ kind: 'plugin', id: 'terminal', label: 'Terminal' }] })} />)
    expect(screen.queryByRole('link', { name: /View the update/ })).toBeNull()
  })

  it('a human decision without a handoff is one link to its control — no disclosure, no command', () => {
    render(<IncidentRow item={item({
      status: 'error', class: 'policy_denial', disposition: 'action_required', effectiveDisposition: 'action_required',
      resolution: { key: 'search-service-access', type: 'human', needs: 'decision', label: 'Configure isolated search', href: '/settings?tab=search' },
    })} />)
    expect(screen.getByRole('link', { name: 'Configure isolated search' }).getAttribute('href')).toBe('/settings?tab=search')
    expect(screen.queryByRole('button', { name: 'Run it yourself' })).toBeNull()
    expect(document.querySelector('code')).toBeNull()
  })

  it('a repair resolution is the repair button', () => {
    const onRepair = mock()
    render(<IncidentRow item={item({ resolution: { key: 'fix', type: 'repair', label: 'Restart search', actionId: 'health.search-engine-restart' } })} onRepair={onRepair} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart search' }))
    expect(onRepair).toHaveBeenCalledTimes(1)
  })

  it.each(['acked', 'snoozed'] as const)('keeps %s incident metadata soft beside the solid primary status', (ackState) => {
    const incident = item({ class: 'cleanup_backlog', effectiveDisposition: 'advisory', ackState })
    incident.freshness = 'stale'
    render(<IncidentRow item={incident} />)
    expect(screen.getByText('Advisory').closest('[data-status-badge]')?.getAttribute('data-variant')).toBe('solid')
    for (const label of ['Housekeeping', 'Calmed from watch', 'Last known', ackState === 'acked' ? 'Acknowledged' : 'Snoozed']) {
      const badge = screen.getByText(label).closest('[data-status-badge]')
      expect(badge?.getAttribute('data-variant')).toBe('soft')
      expect(badge?.getAttribute('data-tone')).toBe('neutral')
    }
  })

  it('renders the plain-language category chip for a classified incident', () => {
    render(<IncidentRow item={item({ class: 'policy_denial' })} />)
    expect(screen.getByText('Guardrail worked')).toBeTruthy()
  })

  it('a demoted incident renders calm with an honest provenance badge', () => {
    render(<IncidentRow item={item({
      class: 'cleanup_backlog',
      disposition: 'watch',
      effectiveDisposition: 'advisory',
    })} />)
    expect(screen.getByText('Advisory')).toBeTruthy()
    expect(screen.getByText('Housekeeping')).toBeTruthy()
    expect(screen.getByText('Calmed from watch')).toBeTruthy()
    expect(screen.queryByText('Watch')).toBeNull()
  })

  it('an undemoted watch incident renders as Watch with no provenance badge', () => {
    render(<IncidentRow item={item({ class: 'unattributed_usage' })} />)
    expect(screen.getByText('Watch')).toBeTruthy()
    expect(screen.getByText('Unattributed usage')).toBeTruthy()
    expect(screen.queryByText(/Calmed from/)).toBeNull()
  })

  it('error incidents stay Critical — never demoted, never calmed', () => {
    render(<IncidentRow item={item({
      class: 'runaway_usage',
      status: 'error',
      disposition: 'action_required',
      effectiveDisposition: 'action_required',
    })} />)
    expect(screen.getByText('Critical')).toBeTruthy()
    expect(screen.getByText('Runaway usage')).toBeTruthy()
  })
})

describe('IncidentRow decision choices (card buttons)', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const decision = (choices: HealthIncident['resolution']['choices']) => item({
    title: 'Unclaimed Search tables',
    resolution: { key: 'tables', type: 'human', needs: 'decision', label: 'Review tables', href: '/health?tab=system', choices },
  })

  it('a link choice is a link to its control; a request choice without confirm posts at once and reports the decision', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return Response.json({ ok: true }) }) as unknown as typeof fetch
    const onDecided = mock()
    const row = decision([
      { key: 'guest', kind: 'link', label: 'Use as guest', href: '/settings?tab=system&field=search.settings.url' },
      { key: 'resume', kind: 'request', label: 'Resume', method: 'POST', url: '/api/plugins/spend/resume', body: { id: 'i-1' } },
    ])
    await act(async () => { render(<IncidentRow item={row} onDecided={onDecided} />) })
    expect((screen.getByRole('link', { name: 'Use as guest' }) as HTMLAnchorElement).getAttribute('href')).toContain('field=search.settings.url')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume' })) })
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(calls).toEqual([{ url: '/api/plugins/spend/resume', init: expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'i-1' }) }) }])
    expect(onDecided.mock.calls[0]![1]).toMatchObject({ key: 'resume' })
  })

  it('a request choice with confirm asks in a dialog first; a refused request shows the error and reports nothing', async () => {
    globalThis.fetch = mock(async () => Response.json({ error: 'still over the limit' }, { status: 409 })) as unknown as typeof fetch
    const onDecided = mock()
    const row = decision([{ key: 'keep', kind: 'request', label: 'Keep', method: 'POST', url: '/api/plugins/health/search/keep', tone: 'danger', confirm: { title: 'Keep these tables?', description: 'They stay out of the index.' } }])
    await act(async () => { render(<IncidentRow item={row} onDecided={onDecided} />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Keep' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Keep these tables?' })
    expect(within(dialog).getByText('Keep these tables?')).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' })) })
    await waitFor(() => expect(within(dialog).getByText(/still over the limit/)).toBeTruthy())
    expect(onDecided).not.toHaveBeenCalled()
  })
})

describe('IncidentRow handoff (self-healing 1.4c)', () => {
  const realFetch = globalThis.fetch
  let requests: Array<{ url: string; method: string; body?: unknown }>
  let terminalActive: boolean
  const commandItem = (handoff: { command: string; cwd?: string } = { command: 'pi' }) => item({
    title: 'Pi has no usable model provider',
    resolution: { key: 'configure-provider', type: 'human', needs: 'credential', label: 'Configure a Pi provider', href: '/runtime?tab=overview&field=credentials', handoff },
  })
  function stubFetch() {
    requests = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url === '/api/plugins/manifest') return Response.json({ plugins: [{ id: 'health', status: 'active' }, ...(terminalActive ? [{ id: 'terminal', status: 'active' }] : [])] })
      if (url === '/api/plugins/terminal/options') return Response.json({ defaults: { cwd: '/Users/me/.bakin' } })
      if (url === '/api/plugins/terminal/sessions') return Response.json({ id: 'sess-1', generation: 1, inputSequence: 0 })
      if (url === '/api/plugins/terminal/session') return Response.json({ ok: true })
      return Response.json({})
    }) as unknown as typeof fetch
  }
  afterEach(() => { globalThis.fetch = realFetch; resetTerminalHandoffForTests(); resetHandoffReturnForTests(); routerPush.mockClear() })

  it('a command resolution renders the HandoffCard; without the Terminal plugin it is copy-only', async () => {
    terminalActive = false
    resetTerminalHandoffForTests()
    stubFetch()
    await act(async () => { render(<IncidentRow item={commandItem()} />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run it yourself' })) })
    const card = screen.getByRole('region', { name: 'Run this yourself' })
    expect(within(card).getByText('pi')).toBeTruthy()
    await waitFor(() => expect(requests.some((r) => r.url === '/api/plugins/manifest')).toBe(true))
    expect(within(card).queryByRole('button', { name: 'Open in Terminal' })).toBeNull()
  })

  it('with the Terminal plugin active, Open in Terminal creates a human shell session in the declared cwd with the command PREFILLED, goes to it, and arms the return check', async () => {
    terminalActive = true
    resetTerminalHandoffForTests()
    stubFetch()
    const row = commandItem({ command: 'pi', cwd: '/Users/me/repo' })
    await act(async () => { render(<IncidentRow item={row} />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run it yourself' })) })
    const button = await screen.findByRole('button', { name: 'Open in Terminal' })
    expect(isHandoffReturnArmed(row.incident.id)).toBe(false)
    await act(async () => { fireEvent.click(button) })
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/terminal/sess-1'))
    expect(requests.find((r) => r.url === '/api/plugins/terminal/sessions')).toMatchObject({ method: 'POST', body: { title: 'Pi has no usable model provider', cwd: '/Users/me/repo', program: 'shell' } })
    expect(requests.find((r) => r.url === '/api/plugins/terminal/session')).toMatchObject({ body: { id: 'sess-1', operation: 'write', generation: 1, sequence: 1, data: 'pi' } })
    // The row cannot own the rerun (it unmounts with the navigation): the page's useHandoffReturn reads this.
    expect(isHandoffReturnArmed(row.incident.id)).toBe(true)
  })

  it('without a declared cwd the session uses the Terminal plugin default; a refused session disarms the return check and keeps the copy block', async () => {
    terminalActive = true
    resetTerminalHandoffForTests()
    stubFetch()
    const inner = globalThis.fetch
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/plugins/terminal/sessions') {
        requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
        return Response.json({ error: 'pty limit reached' }, { status: 503 })
      }
      return inner(input, init)
    }) as unknown as typeof fetch
    const row = commandItem()
    await act(async () => { render(<IncidentRow item={row} />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run it yourself' })) })
    const button = await screen.findByRole('button', { name: 'Open in Terminal' })
    await act(async () => { fireEvent.click(button) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('pty limit reached'))
    expect(requests.find((r) => r.url === '/api/plugins/terminal/sessions')).toMatchObject({ body: { cwd: '/Users/me/.bakin' } })
    expect(isHandoffReturnArmed(row.incident.id)).toBe(false)
    expect(screen.getByText('pi')).toBeTruthy()
  })

  it('copying the command (the clipboard write succeeding) arms the return check; without a terminal that is the only handoff', async () => {
    terminalActive = false
    resetTerminalHandoffForTests()
    stubFetch()
    const writeText = mock(async () => {})
    const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      const row = commandItem()
      await act(async () => { render(<IncidentRow item={row} />) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run it yourself' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy Command' })) })
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('pi'))
      await waitFor(() => expect(isHandoffReturnArmed(row.incident.id)).toBe(true))
    } finally {
      if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore)
      else delete (navigator as { clipboard?: unknown }).clipboard
    }
  })
})
