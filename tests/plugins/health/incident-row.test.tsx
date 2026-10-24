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

describe('IncidentRow handoff (self-healing 1.4c)', () => {
  const realFetch = globalThis.fetch
  let requests: Array<{ url: string; method: string; body?: unknown }>
  let terminalActive: boolean
  const commandItem = () => item({
    title: 'Pi has no usable model provider',
    resolution: { key: 'configure-provider', type: 'human', needs: 'credential', label: 'Configure a Pi provider', href: '/runtime?tab=overview&field=credentials', handoff: { command: 'pi' } },
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
  afterEach(() => { globalThis.fetch = realFetch; resetTerminalHandoffForTests(); routerPush.mockClear() })

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

  it('with the Terminal plugin active, Open in Terminal creates a human shell session with the command PREFILLED, goes to it, and reruns the check when the tab regains focus', async () => {
    terminalActive = true
    resetTerminalHandoffForTests()
    stubFetch()
    const onRerun = mock()
    await act(async () => { render(<IncidentRow item={commandItem()} onRerun={onRerun} />) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run it yourself' })) })
    const button = await screen.findByRole('button', { name: 'Open in Terminal' })
    await act(async () => { fireEvent.click(button) })
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/terminal/sess-1'))
    expect(requests.find((r) => r.url === '/api/plugins/terminal/sessions')).toMatchObject({ method: 'POST', body: { title: 'Pi has no usable model provider', cwd: '/Users/me/.bakin', program: 'shell' } })
    expect(requests.find((r) => r.url === '/api/plugins/terminal/session')).toMatchObject({ body: { id: 'sess-1', operation: 'write', generation: 1, sequence: 1, data: 'pi' } })
    expect(onRerun).not.toHaveBeenCalled()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(onRerun).toHaveBeenCalledTimes(1)
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(onRerun).toHaveBeenCalledTimes(1)
  })
})
