// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState, type ReactNode } from 'react'
import '../../rtl-settle'
import type { HealthIncident, HealthRepairTarget } from '@makinbakin/sdk/types'

let requestedTab = 'overview'
let currentPath = '/health'
let queryWrites: string[] = []
let panelMounts: string[] = []
let overviewHookCalls = 0
let capturedRepairTarget: HealthRepairTarget | null = null

let overviewRunChecks = mock(async () => ({ id: 'report-2' }))
let overviewRefresh = mock(async () => undefined)

const repairIncident = {
  id: 'incident-1',
  title: 'Search index is stale',
} as HealthIncident

mock.module('@makinbakin/sdk/hooks', () => ({
  usePathname: () => currentPath,
  useQueryState: (_key: string, defaultValue: string) => {
    const [value, setValue] = useState(requestedTab || defaultValue)
    const writeValue = (next: string) => {
      queryWrites.push(next)
      setValue(next)
    }
    return [value, writeValue, writeValue]
  },
}))

mock.module('../../../plugins/health/hooks/use-overview-data', () => ({
  useOverviewData: () => {
    overviewHookCalls += 1
    return {
      model: { reportId: 'report-1' },
      runChecks: () => overviewRunChecks(),
      refresh: () => overviewRefresh(),
    }
  },
}))

function MountedPanel({ name, children }: { name: string; children?: ReactNode }) {
  useEffect(() => {
    panelMounts.push(name)
  }, [name])
  return <div data-testid={`${name}-panel`}>{children}</div>
}

mock.module('../../../plugins/health/components/overview-tab', () => ({
  OverviewTab: ({
    onRepair,
    onRerun,
  }: {
    onRepair?: (incident: HealthIncident) => void
    onRerun?: (incident: HealthIncident) => void
  }) => (
    <MountedPanel name="overview">
      <button type="button" onClick={() => onRepair?.(repairIncident)}>Review repair</button>
      <button type="button" onClick={() => onRerun?.(repairIncident)}>Check again</button>
    </MountedPanel>
  ),
}))

mock.module('../../../plugins/health/components/agents-tab', () => ({
  AgentsTab: () => <MountedPanel name="agents" />,
}))

mock.module('../../../plugins/health/components/activity-tab', () => ({
  ActivityTab: () => <MountedPanel name="activity" />,
}))

mock.module('../../../plugins/health/components/system-tab', () => ({
  SystemTab: () => <MountedPanel name="system" />,
}))

mock.module('../../../plugins/health/components/repair-dialog', () => ({
  RepairDialog: ({
    open,
    target,
    title,
    onApplied,
  }: {
    open: boolean
    target: HealthRepairTarget
    title?: string
    onApplied?: () => void
  }) => {
    capturedRepairTarget = target
    if (!open) return null
    return (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={onApplied}>Apply repair</button>
      </div>
    )
  },
}))

import { HealthPage } from '../../../plugins/health/components/health-page'
import { HEALTH_REPORT_SWEEP_TIMEOUT_MS } from '../../../plugins/health/hooks/use-health-report'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  requestedTab = 'overview'
  currentPath = '/health'
  queryWrites = []
  panelMounts = []
  overviewHookCalls = 0
  capturedRepairTarget = null
  overviewRunChecks = mock(async () => ({ id: 'report-2' }))
  overviewRefresh = mock(async () => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  vi.unstubAllGlobals()
})

describe('HealthPage tab shell', () => {
  it('normalizes an invalid tab to Overview and exposes linked tab semantics', async () => {
    requestedTab = 'not-a-health-tab'

    render(<HealthPage />)

    const page = screen.getByTestId('health-page')
    const overviewTab = screen.getByRole('tab', { name: 'Overview' })
    const panel = screen.getByRole('tabpanel')

    expect(page.getAttribute('data-archetype')).toBe('page')
    expect(page.getAttribute('data-width')).toBe('full')
    expect(page.getAttribute('data-slot')).toBe('page-shell')
    expect(page.classList.contains('health-page')).toBe(true)
    expect(screen.getByRole('heading', { name: 'Health' })).toBeDefined()
    expect(screen.getByText('Monitor operational readiness, investigate failed work, and repair issues before they block agents.')).toBeDefined()
    expect(screen.queryByTestId('plugin-header')).toBeNull()
    expect(page.querySelector('[data-slot="page-header"]')).not.toBeNull()
    expect(page.querySelector('[data-slot="page-body"]')).not.toBeNull()
    expect(screen.getByRole('tablist', { name: 'Health sections' }).getAttribute('data-variant')).toBe('underline')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Agents',
      'Activity',
      'System',
    ])
    expect(overviewTab.getAttribute('aria-selected')).toBe('true')
    expect(overviewTab.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-labelledby')).toBe(overviewTab.id)
    expect(screen.getByTestId('overview-panel')).toBeDefined()
    expect(screen.queryByTestId('agents-panel')).toBeNull()
    expect(screen.queryByTestId('activity-panel')).toBeNull()
    expect(screen.queryByTestId('system-panel')).toBeNull()
    await waitFor(() => expect(panelMounts).toEqual(['overview']))
    expect(queryWrites).toEqual(['overview'])
  })

  it('does not rewrite the next route while Health is unmounting', async () => {
    requestedTab = 'diagnostics'
    currentPath = '/team/main'

    render(<HealthPage />)

    await act(async () => { await Promise.resolve() })
    expect(queryWrites).toEqual([])
  })

  it('syncs the selected tab to the URL and mounts only the active panel', async () => {
    render(<HealthPage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Agents' }))

    await waitFor(() => expect(queryWrites).toEqual(['agents']))
    expect(screen.getByRole('tab', { name: 'Agents' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('agents-panel')).toBeDefined()
    expect(screen.queryByTestId('overview-panel')).toBeNull()
    expect(screen.queryByTestId('activity-panel')).toBeNull()
    expect(screen.queryByTestId('system-panel')).toBeNull()
    expect(panelMounts).toEqual(['overview', 'agents'])

    const agentsTab = screen.getByRole('tab', { name: 'Agents' })
    await act(async () => {
      agentsTab.focus()
      fireEvent.keyDown(agentsTab, { key: 'ArrowRight' })
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true'))
    expect(queryWrites).toEqual(['agents', 'activity'])
    expect(screen.getByTestId('activity-panel')).toBeDefined()
    expect(screen.queryByTestId('agents-panel')).toBeNull()
    expect(panelMounts).toEqual(['overview', 'agents', 'activity'])
  })

  it('runs fresh checks explicitly and announces only that explicit workflow', async () => {
    let finishChecks: ((value: { id: string }) => void) | undefined
    overviewRunChecks = mock(() => new Promise<{ id: string }>((resolve) => {
      finishChecks = resolve
    }))

    render(<HealthPage />)

    const status = screen.getByTestId('health-action-status')
    expect(status.textContent).toBe('')
    expect(screen.queryByTestId('health-action-visible-status')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    expect(status.textContent).toBe('Running health checks.')
    expect(screen.getByTestId('health-action-visible-status').textContent).toBe('Running health checks.')
    expect(screen.getByRole('button', { name: 'Running checks…' }).hasAttribute('disabled')).toBe(true)
    expect(overviewRunChecks).toHaveBeenCalledTimes(1)

    finishChecks?.({ id: 'report-2' })
    await waitFor(() => expect(status.textContent).toBe('Health checks completed.'))
    expect(screen.getByTestId('health-action-visible-status').textContent).toBe('Health checks completed.')

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(status.textContent).toBe('Running health checks.')
    expect(overviewRunChecks).toHaveBeenCalledTimes(2)
  })

  it('keeps Overview unmounted while another tab runs checks on demand', async () => {
    requestedTab = 'agents'
    const fetchMock = mock((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ error: 'unavailable' }, 503)))
    vi.stubGlobal('fetch', fetchMock)

    render(<HealthPage />)

    expect(screen.getByTestId('agents-panel')).toBeDefined()
    expect(overviewHookCalls).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/plugins/health/doctor/run')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    const failure = 'Health checks could not be completed. Existing evidence remains visible.'
    expect(screen.getByTestId('health-action-status').textContent).toBe(failure)
    expect(screen.getByTestId('health-action-visible-status').textContent).toBe(failure)
    expect(overviewHookCalls).toBe(0)
    expect(screen.getByTestId('agents-panel')).toBeDefined()
  })

  it('times out a hung on-demand check and makes Run checks available again', async () => {
    vi.useFakeTimers()
    requestedTab = 'agents'
    let requestSignal: AbortSignal | undefined
    const fetchMock = mock((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<HealthPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    expect(screen.getByRole('button', { name: 'Running checks…' }).hasAttribute('disabled')).toBe(true)

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_REPORT_SWEEP_TIMEOUT_MS) })

    expect(requestSignal?.aborted).toBe(true)
    const failure = 'Health checks could not be completed. Existing evidence remains visible.'
    expect(screen.getByTestId('health-action-status').textContent).toBe(failure)
    expect(screen.getByRole('button', { name: 'Run checks' }).hasAttribute('disabled')).toBe(false)
  })

  it('also times out when a check responds but its body never settles', async () => {
    vi.useFakeTimers()
    requestedTab = 'system'
    let requestSignal: AbortSignal | undefined
    const fetchMock = mock((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | undefined
      const response = jsonResponse({})
      response.json = () => new Promise<never>(() => {})
      return Promise.resolve(response)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<HealthPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByRole('button', { name: 'Running checks…' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_REPORT_SWEEP_TIMEOUT_MS) })

    expect(requestSignal?.aborted).toBe(true)
    expect(screen.getByTestId('health-action-status').textContent)
      .toBe('Health checks could not be completed. Existing evidence remains visible.')
    expect(screen.getByRole('button', { name: 'Run checks' }).hasAttribute('disabled')).toBe(false)
  })

  it('does not announce success for a malformed 200 diagnostic response', async () => {
    requestedTab = 'agents'
    vi.stubGlobal('fetch', mock(async () => jsonResponse({ id: 'not-a-health-report' })))

    render(<HealthPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))

    await waitFor(() => expect(screen.getByTestId('health-action-status').textContent)
      .toBe('Health checks could not be completed. Existing evidence remains visible.'))
  })

  it('opens a report-scoped incident repair and refreshes Overview after apply', async () => {
    render(<HealthPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Review repair' }))

    expect(screen.getByRole('dialog', { name: 'Repair Search index is stale' })).toBeDefined()
    expect(capturedRepairTarget).toEqual({
      type: 'incidents',
      reportId: 'report-1',
      ids: ['incident-1'],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Apply repair' }))
    await waitFor(() => expect(overviewRefresh).toHaveBeenCalledTimes(1))
  })
})
