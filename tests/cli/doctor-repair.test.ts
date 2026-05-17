import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const mockPlan = {
  diagnostics: [{ check: 'taskboard', status: 'warn', message: 'Missing columns', autoFixable: true }],
  items: [{
    id: 'repair.taskboard',
    checkId: 'taskboard',
    healthCheckId: 'tasks.taskboard',
    pluginId: 'tasks',
    checkName: 'Task board',
    title: 'Repair taskboard',
    reason: 'Missing columns',
    safety: 'safe',
    requiresConfirmation: true,
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
  errors: [],
  summary: { diagnostics: 1, repairableChecks: 1, totalItems: 1, safeItems: 1, blockedItems: 0, planErrors: 0 },
}

const mockApply = {
  status: 'applied',
  plan: mockPlan,
  applied: [{
    id: 'repair.taskboard',
    checkId: 'taskboard',
    status: 'applied',
    message: 'Added missing columns',
    changes: [{ kind: 'file', target: 'tasks/board.json', action: 'update', description: 'Add missing columns' }],
  }],
  skipped: [],
  errors: [],
  verification: [{ check: 'taskboard', status: 'ok', message: 'Taskboard healthy', autoFixable: false }],
  summary: { planned: 1, applied: 1, skipped: 0, failed: 0, verificationErrors: 0, verificationWarnings: 0 },
}

const mockDelegate = {
  status: 'sent',
  request: {
    id: 'repair-1',
    kind: 'delegate',
    status: 'sent',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:01:00.000Z',
    plan: mockPlan,
    unresolved: mockPlan.diagnostics,
    taskId: 'task-repair-1',
    agentId: 'main',
    events: [],
  },
  unresolved: mockPlan.diagnostics,
}

describe('legacy CLI doctor repair', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>
  const fetchMock = mock()

  beforeEach(() => {
    mock.clearAllMocks()
    process.argv = originalArgv
    globalThis.fetch = fetchMock as unknown as typeof fetch
    log = spyOn(console, 'log').mockImplementation(() => {})
    error = spyOn(console, 'error').mockImplementation(() => {})
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`)
    }) as never
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    globalThis.fetch = originalFetch
    log.mockRestore()
    error.mockRestore()
  })

  it('prints a JSON repair plan and does not mutate without --yes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockPlan),
      text: () => Promise.resolve(''),
    })
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--json']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair/plan')
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined()
    const body = JSON.parse(String(log.mock.calls[0][0]))
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED')
    expect(body.data.plan.summary.safeItems).toBe(1)
  })

  it('applies deterministic repairs with --yes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApply),
      text: () => Promise.resolve(''),
    })
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair/apply')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ accepted: true }))
    const body = JSON.parse(String(log.mock.calls[0][0]))
    expect(body.ok).toBe(true)
    expect(body.data.summary.applied).toBe(1)
  })

  it('previews delegated repair without creating the task when --yes is omitted', async () => {
    const delegatePlan = {
      ...mockPlan,
      diagnostics: [
        ...mockPlan.diagnostics,
        { check: 'runtime', status: 'error', message: 'Runtime unreachable', autoFixable: false },
      ],
      summary: { ...mockPlan.summary, diagnostics: 2 },
    }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(delegatePlan),
      text: () => Promise.resolve(''),
    })
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--json']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair/plan')
    const body = JSON.parse(String(log.mock.calls[0][0]))
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED')
    expect(body.data.unresolved).toHaveLength(1)
  })

  it('creates a delegated repair task with --yes', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockDelegate),
      text: () => Promise.resolve(''),
    })
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--json', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/delegate')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ accepted: true }))
    const body = JSON.parse(String(log.mock.calls[0][0]))
    expect(body.ok).toBe(true)
    expect(body.data.request.taskId).toBe('task-repair-1')
  })

  it('lists delegated repair requests', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requests: [mockDelegate.request] }),
      text: () => Promise.resolve(''),
    })
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'list', '--json']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair')
    const body = JSON.parse(String(log.mock.calls[0][0]))
    expect(body.data.requests[0].id).toBe('repair-1')
  })

  it('verifies delegated repair requests', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ request: { ...mockDelegate.request, status: 'verified' }, remaining: [], verified: true }),
      text: () => Promise.resolve(''),
    })
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'verify', 'repair-1', '--json']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(fetchMock.mock.calls[0][0]).toContain('/api/plugins/health/doctor/repair/repair-1/verify')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    const body = JSON.parse(String(log.mock.calls[0][0]))
    expect(body.data.verified).toBe(true)
  })
})
