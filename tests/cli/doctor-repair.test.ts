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
})
