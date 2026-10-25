// @vitest-environment jsdom

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { HealthRepairTarget, OperationView } from '@makinbakin/sdk/types'
import { emitPluginEvent } from '@makinbakin/sdk/hooks'
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
      id: 'team.sync-agents:local', localId: 'local', actionId: 'team.sync-agents', title: 'Sync agents locally',
      reason: 'Two agent projections are stale.', effects: { deletesUserContent: false, spendsMoney: false, widensAuthorization: false }, mode: 'self-heal',
      incidentIds: target.ids, observationIds: ['team.sync:drift'], preconditions: [],
      changes: [{ kind: 'runtime', target: 'pixel', action: 'update', description: 'Recompose agent projection.' }],
    },
    {
      id: 'team.migrate-agent-blocks:legacy', localId: 'legacy', actionId: 'team.migrate-agent-blocks', title: 'Migrate legacy agent blocks',
      reason: 'Legacy blocks would be overwritten.', effects: { deletesUserContent: true, spendsMoney: false, widensAuthorization: false }, mode: 'one-click',
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
  remainingIncidentIds: [],
  report: healthyReport,
}

let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let staleApply = false

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

const OP_ID = 'op-repair-1'
const NOW = Date.now()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

/** The repair operation as the server would publish it. */
function repairView(over: Partial<OperationView> = {}): OperationView {
  return {
    id: OP_ID,
    children: ['op-child-1'],
    rev: 1,
    bootId: 'boot-1',
    kind: 'repair',
    owner: 'core',
    origin: 'web',
    title: 'Apply a Health repair',
    href: '/health',
    fingerprint: 'repair:x',
    resources: [],
    status: 'running',
    plan: { stages: [{ id: 'apply', kind: 'installing', label: 'Apply repairs' }, { id: 'verify', kind: 'verifying', label: 'Re-check Health' }], pointOfNoReturn: null },
    stages: [
      { id: 'apply', kind: 'installing', label: 'Apply repairs', status: 'active', startedAt: iso(5_000) },
      { id: 'verify', kind: 'verifying', label: 'Re-check Health', status: 'pending' },
    ],
    cancellable: true,
    startedAt: iso(5_000),
    lastProgressAt: iso(0),
    lastLivenessAt: iso(0),
    log: [],
    ...over,
  }
}

function childView(over: Partial<OperationView> = {}): OperationView {
  return repairView({
    id: 'op-child-1',
    parentId: OP_ID,
    children: [],
    kind: 'repair:team.sync-agents',
    title: 'Sync agents locally',
    plan: { stages: [{ id: 'sync', kind: 'downloading', label: 'Download agent sources' }], pointOfNoReturn: null },
    stages: [{ id: 'sync', kind: 'downloading', label: 'Download agent sources', status: 'active', startedAt: iso(5_000), bytes: { received: 2_000_000, total: 8_000_000 } }],
    ...over,
  })
}

let served: { operation: OperationView; children: OperationView[] } = { operation: repairView(), children: [childView()] }

function finishedView(): OperationView {
  return repairView({
    rev: 9,
    status: 'succeeded',
    endedAt: iso(0),
    cancellable: false,
    stages: [
      { id: 'apply', kind: 'installing', label: 'Apply repairs', status: 'done', startedAt: iso(5_000), endedAt: iso(1_000) },
      { id: 'verify', kind: 'verifying', label: 'Re-check Health', status: 'done', startedAt: iso(1_000), endedAt: iso(0) },
    ],
    outcome: { code: 'ok', message: 'Applied and verified.' },
    result: { httpStatus: 200, body: applied },
  })
}

function publish(view: OperationView) {
  act(() => emitPluginEvent({ event: 'operation.updated', view }))
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  cleanup()
  fetchCalls = []
  staleApply = false
  served = { operation: repairView(), children: [childView()] }
  globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url)
    fetchCalls.push({ url: path, init })
    if (path.endsWith('/repair/plan')) return json(plan)
    if (path.endsWith('/repair/apply') && staleApply) return json({ error: 'Evidence changed.', code: 'STALE_PLAN' }, 409)
    if (path.endsWith('/repair/apply')) return json({ operationId: OP_ID, bootId: 'boot-1' }, 202)
    if (path.endsWith(`/api/operations/${OP_ID}/cancel`)) return json({ bootId: 'boot-1', status: 'cancelling' }, 202)
    if (path.includes(`/api/operations/${OP_ID}`)) return json({ bootId: 'boot-1', operation: served.operation, children: served.children })
    return json({ error: 'not found' }, 404)
  }) as unknown as typeof fetch
})

async function startApply(labels: string[] = []) {
  await screen.findByText('Sync agents locally')
  for (const label of labels) fireEvent.click(screen.getByLabelText(label))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Apply \d+ repairs?$/ })) })
  await screen.findByRole('region', { name: 'Apply a Health repair' })
}

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

  it('starts the repair, shows its progress with each action as a child, then the rows and verification', async () => {
    const onApplied = mock(() => {})
    render(<RepairDialog open target={target} onOpenChange={() => {}} onApplied={onApplied} />)
    await startApply(['Select and confirm repair: Migrate legacy agent blocks'])

    const request = fetchCalls.find((call) => call.url.endsWith('/repair/apply'))!
    expect(JSON.parse(String(request.init?.body))).toEqual({
      planId: plan.planId,
      itemIds: [plan.items[0].id, plan.items[1].id],
      confirmedItemIds: [plan.items[1].id],
    })
    // Live progress: the child action and its download.
    await screen.findByRole('list', { name: 'Apply a Health repair included operations' })
    expect(screen.getByText('2.0 MB of 8.0 MB')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Close — it keeps running' })).toBeDefined()
    expect(onApplied).not.toHaveBeenCalled()

    publish(finishedView())
    await screen.findByText('Synced two agents.')
    expect(screen.getByText('Fresh checks no longer show the selected issue.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Done' })).toBeDefined()
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  it('offers a fresh re-plan after a typed stale-plan conflict', async () => {
    staleApply = true
    render(<RepairDialog open target={target} onOpenChange={() => {}} />)
    await screen.findByText('Sync agents locally')

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply 1 repair' })) })
    await screen.findByText('The evidence changed before apply.')
    expect(screen.getByRole('button', { name: 'Re-plan from fresh evidence' })).toBeDefined()

    staleApply = false
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Re-plan from fresh evidence' })) })
    await waitFor(() => expect(fetchCalls.filter((call) => call.url.endsWith('/repair/plan'))).toHaveLength(2))
  })

  it('can be closed while the repair runs — the repair keeps going on the server', async () => {
    const onOpenChange = mock((_open: boolean) => {})
    render(<RepairDialog open target={target} onOpenChange={onOpenChange} />)
    await startApply()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close — it keeps running' })) })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(fetchCalls.some((call) => call.url.endsWith('/cancel'))).toBe(false)
  })

  it('cancels through the operations API while cancel is allowed', async () => {
    render(<RepairDialog open target={target} onOpenChange={() => {}} />)
    await startApply()
    const region = screen.getByRole('region', { name: 'Apply a Health repair' })
    await act(async () => { fireEvent.click(within(region).getByRole('button', { name: 'Cancel' })) })
    await waitFor(() => expect(fetchCalls.some((call) => call.url.endsWith(`/api/operations/${OP_ID}/cancel`) && call.init?.method === 'POST')).toBe(true))
  })

  it('margo at the UI: a stalled download reads as stuck, then the failure keeps every row', async () => {
    render(<RepairDialog open target={target} onOpenChange={() => {}} />)
    await startApply()
    publish(repairView({ rev: 2, lastProgressAt: iso(200_000), lastLivenessAt: iso(1_000) }))
    publish(childView({ rev: 2, lastProgressAt: iso(200_000), stages: [{ id: 'sync', kind: 'downloading', label: 'Download agent sources', status: 'active', startedAt: iso(200_000), bytes: { received: 2_000_000, total: 8_000_000 }, attempt: { n: 2, of: 2, reason: 'stalled', detail: 'no bytes for 30s' } }] }))
    await screen.findByText(/^No progress for/)

    const failedBody = { ...applied, results: [{ ...applied.results[0]!, status: 'failed', message: 'Download stalled twice.' }], remainingIncidentIds: ['team:agents:drift'] }
    publish(repairView({ rev: 9, status: 'failed', endedAt: iso(0), cancellable: false, outcome: { code: 'apply_failed', message: '1 repair item(s) failed.' }, result: { httpStatus: 200, body: failedBody } }))
    await screen.findByText('Download stalled twice.')
    expect(screen.getByText('The repair ran, but 1 related incident remain.')).toBeDefined()
  })

  it('ignores a late start answer after an external unmount', async () => {
    const pending = deferred<Response>()
    const onApplied = mock(() => {})
    globalThis.fetch = mock(async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      if (String(url).endsWith('/repair/plan')) return json(plan)
      if (String(url).endsWith('/repair/apply')) return pending.promise
      return json({ error: 'not found' }, 404)
    }) as unknown as typeof fetch

    const view = render(<RepairDialog open target={target} onOpenChange={() => {}} onApplied={onApplied} />)
    await screen.findByText('Sync agents locally')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply 1 repair' })) })
    view.unmount()

    await act(async () => { pending.resolve(json({ operationId: OP_ID, bootId: 'boot-1' }, 202)) })
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
})
