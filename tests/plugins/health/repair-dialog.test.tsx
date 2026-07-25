// @vitest-environment jsdom

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { HealthRepairTarget } from '@makinbakin/sdk/types'
import '../../rtl-settle'
import { RepairDialog } from '../../../plugins/health/components/repair-dialog'
import { useRepairPlan } from '../../../plugins/health/hooks/use-repair-plan'

const target: HealthRepairTarget = {
  type: 'incidents',
  reportId: 'health-report-1',
  ids: ['team:agents:drift'],
}

const plan = {
  planId: 'repair-plan-1',
  basedOnReportId: 'health-report-1',
  target,
  createdAt: '2026-07-12T12:00:00.000Z',
  expiresAt: '2026-07-12T12:10:00.000Z',
  items: [
    {
      id: 'team.sync-agents:local', actionId: 'team.sync-agents', title: 'Sync agents locally',
      reason: 'Two agent projections are stale.', safety: 'safe',
      incidentIds: target.ids, observationIds: ['team.sync:drift'], preconditions: [],
      changes: [{ kind: 'runtime', target: 'pixel', action: 'update', description: 'Recompose agent projection.' }],
    },
    {
      id: 'team.migrate-agent-blocks:legacy', actionId: 'team.migrate-agent-blocks', title: 'Migrate legacy agent blocks',
      reason: 'Legacy blocks would be overwritten.', safety: 'destructive',
      incidentIds: target.ids, observationIds: ['team.sync:legacy'], preconditions: [],
      changes: [{ kind: 'file', target: 'AGENTS.md', action: 'update', description: 'Replace legacy blocks.' }],
    },
  ],
}

const healthyReport = {
  id: 'health-report-2',
  revision: 2,
  generatedAt: '2026-07-12T12:01:00.000Z',
  overallStatus: 'healthy',
  sensitivity: 'standard',
  lastFullSweep: null,
  checks: [],
  observations: [],
  incidents: [],
  subsystems: {
    search: {
      status: 'unknown',
      summary: 'Search has not been checked yet.',
      observedAt: null,
      staleAt: null,
      stages: ['engine', 'queries', 'indexes', 'journal'].map((key) => ({
        key,
        label: key[0]!.toUpperCase() + key.slice(1),
        status: 'unknown',
        summary: 'Not checked.',
        observedAt: null,
        staleAt: null,
        observationIds: [],
      })),
      incidentIds: [],
    },
  },
  summary: {
    checks: { registered: 0, completed: 0, failed: 0, invalid: 0, notApplicable: 0 },
    incidents: { actionRequired: 0, watching: 0, advisory: 0, unknown: 0, acknowledged: 0 },
  },
}

const applied = {
  planId: plan.planId,
  basedOnReportId: plan.basedOnReportId,
  results: [{
    itemId: plan.items[0].id, actionId: plan.items[0].actionId, status: 'applied',
    message: 'Synced two agents.', affectedCheckIds: ['team.agent-sync'], changes: plan.items[0].changes,
  }],
  affectedCheckIds: ['team.agent-sync'],
  verifiedReportId: 'health-report-2',
  verifiedIncidentIds: [],
  report: healthyReport,
}

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let staleApply = false

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

beforeEach(() => {
  cleanup()
  fetchCalls = []
  staleApply = false
  globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init })
    if (String(url).endsWith('/repair/plan')) return new Response(JSON.stringify(plan), { status: 200 })
    if (String(url).endsWith('/repair/apply') && staleApply) {
      return new Response(JSON.stringify({ error: 'Evidence changed.', code: 'STALE_PLAN' }), { status: 409 })
    }
    if (String(url).endsWith('/repair/apply')) return new Response(JSON.stringify(applied), { status: 200 })
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  }) as unknown as typeof fetch
})

describe('RepairDialog', () => {
  it('plans only the selected incident and preselects safe items alone', async () => {
    render(<RepairDialog open target={target} onOpenChange={() => {}} />)
    await screen.findByText('Sync agents locally')

    const safeRepair = screen.getByRole('checkbox', { name: 'Select repair: Sync agents locally' })
    const manualRepair = screen.getByRole('checkbox', { name: 'Select and confirm repair: Migrate legacy agent blocks' })
    expect(safeRepair.getAttribute('data-slot')).toBe('checkbox')
    expect(safeRepair.getAttribute('aria-checked')).toBe('true')
    expect(manualRepair.getAttribute('aria-checked')).toBe('false')

    const request = fetchCalls.find((call) => call.url.endsWith('/repair/plan'))!
    expect(request.init?.method).toBe('POST')
    expect(JSON.parse(String(request.init?.body))).toEqual({ target })
  })

  it('sends plan id, selected items, and only individually confirmed non-safe ids', async () => {
    const onApplied = mock(() => {})
    render(<RepairDialog open target={target} onOpenChange={() => {}} onApplied={onApplied} />)
    await screen.findByText('Migrate legacy agent blocks')

    fireEvent.click(screen.getByLabelText('Select and confirm repair: Migrate legacy agent blocks'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 2 repairs' }))
    await screen.findByText('Synced two agents.')

    const request = fetchCalls.find((call) => call.url.endsWith('/repair/apply'))!
    expect(JSON.parse(String(request.init?.body))).toEqual({
      planId: plan.planId,
      itemIds: [plan.items[0].id, plan.items[1].id],
      confirmedItemIds: [plan.items[1].id],
    })
    expect(screen.getByText('Fresh checks no longer show the selected issue.')).toBeDefined()
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  it('offers a fresh re-plan after a typed stale-plan conflict', async () => {
    staleApply = true
    render(<RepairDialog open target={target} onOpenChange={() => {}} />)
    await screen.findByText('Sync agents locally')

    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 repair' }))
    await screen.findByText('The evidence changed before apply.')
    expect(screen.getByRole('button', { name: 'Re-plan from fresh evidence' })).toBeDefined()

    staleApply = false
    fireEvent.click(screen.getByRole('button', { name: 'Re-plan from fresh evidence' }))
    await waitFor(() => expect(fetchCalls.filter((call) => call.url.endsWith('/repair/plan'))).toHaveLength(2))
  })

  it('cannot be dismissed while an apply and verification request is in flight', async () => {
    const pending = deferred<Response>()
    const onOpenChange = mock(() => {})
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      if (String(url).endsWith('/repair/plan')) return new Response(JSON.stringify(plan), { status: 200 })
      if (String(url).endsWith('/repair/apply')) return pending.promise
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }) as unknown as typeof fetch

    render(<RepairDialog open target={target} onOpenChange={onOpenChange} />)
    await screen.findByText('Sync agents locally')
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 repair' }))

    const cancel = await screen.findByRole('button', { name: 'Cancel' }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => { pending.resolve(new Response(JSON.stringify(applied), { status: 200 })) })
    await screen.findByText('Fresh checks no longer show the selected issue.')
  })

  it('ignores a late apply response after an external unmount', async () => {
    const pending = deferred<Response>()
    const onApplied = mock(() => {})
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      if (String(url).endsWith('/repair/plan')) return new Response(JSON.stringify(plan), { status: 200 })
      if (String(url).endsWith('/repair/apply')) return pending.promise
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }) as unknown as typeof fetch

    const view = render(<RepairDialog open target={target} onOpenChange={() => {}} onApplied={onApplied} />)
    await screen.findByText('Sync agents locally')
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 repair' }))
    view.unmount()

    await act(async () => { pending.resolve(new Response(JSON.stringify(applied), { status: 200 })) })
    expect(onApplied).not.toHaveBeenCalled()
  })

  it('bounds a stalled repair plan request and aborts its transport', async () => {
    let signal: AbortSignal | undefined
    globalThis.fetch = mock(async (_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return await new Promise<Response>(() => {})
    }) as unknown as typeof fetch
    const { result } = renderHook(() => useRepairPlan(target, { planMs: 1 }))

    await act(async () => {
      expect(await result.current.planRepair()).toBeNull()
    })

    expect(result.current.planning).toBe(false)
    expect(result.current.error).toContain('timed out')
    expect(signal?.aborted).toBe(true)
  })

  it('marks a stalled repair apply as an unknown outcome', async () => {
    let applySignal: AbortSignal | undefined
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/repair/plan')) return new Response(JSON.stringify(plan), { status: 200 })
      applySignal = init?.signal ?? undefined
      return await new Promise<Response>(() => {})
    }) as unknown as typeof fetch
    const { result } = renderHook(() => useRepairPlan(target, { applyMs: 1 }))

    await act(async () => { await result.current.planRepair() })
    await act(async () => {
      expect(await result.current.applyRepair([plan.items[0].id], [])).toBeNull()
    })

    expect(result.current.applying).toBe(false)
    expect(result.current.outcomeUnknown).toBe(true)
    expect(result.current.error).toContain('may still have completed')
    expect(applySignal?.aborted).toBe(true)
  })
})
