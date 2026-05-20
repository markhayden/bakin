import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

let nextQuestionAnswer = 'y'
let prompts: string[] = []

mock.module('node:readline/promises', () => ({
  createInterface: () => ({
    question: async (prompt: string) => {
      prompts.push(prompt)
      return nextQuestionAnswer
    },
    close: () => {},
  }),
}))

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
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>
  const fetchMock = mock()

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  function loggedOutput(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  function headerCount(output: string): number {
    return output.split("┃ 🐷 Bakin'               (v0.0.0-dev) ┃").length - 1
  }

  beforeEach(() => {
    mock.clearAllMocks()
    prompts = []
    nextQuestionAnswer = 'y'
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
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
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

  it('renders the TTY repair plan with the shared doctor repair UI', async () => {
    const emptyPlan = {
      ...mockPlan,
      diagnostics: [],
      items: [],
      summary: { diagnostics: 0, repairableChecks: 0, totalItems: 0, safeItems: 0, blockedItems: 0, planErrors: 0 },
    }
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(emptyPlan),
      text: () => Promise.resolve(''),
    })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output).toContain('Doctor repair plan')
    expect(output).toContain('No deterministic repairs available.')
    expect(output).not.toContain('[SAFE]')
  })

  it('renders TTY repair application results with the shared doctor repair UI', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApply),
      text: () => Promise.resolve(''),
    })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Doctor repair results')
    expect(output).toContain('APPLIED\n------------')
    expect(output).toContain('Taskboard healthy')
    expect(output).not.toContain('[APPLIED]')
  })

  it('continues interactive repair results without replaying the brand header', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPlan),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApply),
        text: () => Promise.resolve(''),
      })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--fix']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(prompts[0]).toStartWith('\nApply 1 safe repair item? [y/N]')
    expect(output).toContain('Doctor repair plan')
    expect(output).toContain('Doctor repair results')
    expect(headerCount(output)).toBe(1)
    const logLines: string[] = log.mock.calls.map((call: unknown[]) => String(call[0] ?? ''))
    const resultIndex = logLines.findIndex(line => line.includes('Doctor repair results'))
    expect(logLines[resultIndex - 1]).toBe('')
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
    fetchMock.mockResolvedValue({
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

  it('renders TTY delegated repair results with the shared doctor repair UI', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDelegate),
      text: () => Promise.resolve(''),
    })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', '--delegate', '--yes']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Delegated doctor repair')
    expect(output).toContain('task-repair-1')
    expect(output).toContain('Watch the board for task-repair-1')
    expect(output).not.toContain('Task: task-repair-1')
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

  it('renders TTY delegated repair request lists with the shared doctor repair UI', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requests: [mockDelegate.request] }),
      text: () => Promise.resolve(''),
    })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'list']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output).toContain('Doctor repair requests')
    expect(output).toContain('REQUESTS')
    expect(output).toContain('repair-1')
    expect(output).toContain('task-repair-1')
    expect(output).not.toContain('repair-1  sent  task=task-repair-1')
  })

  it('renders TTY delegated repair request details with the shared doctor repair UI', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ request: mockDelegate.request }),
      text: () => Promise.resolve(''),
    })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'show', 'repair-1']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Doctor repair request')
    expect(output).toContain('REQUEST')
    expect(output).toContain('UNRESOLVED FINDINGS')
    expect(output).toContain('task-repair-1')
    expect(output).not.toContain('"request"')
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

  it('renders TTY delegated repair verification with the shared doctor repair UI', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ request: { ...mockDelegate.request, status: 'verified' }, remaining: [], verified: true }),
      text: () => Promise.resolve(''),
    })
    setStdoutIsTTY(true)
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'verify', 'repair-1']

    const { main } = await import('../../cli/bakin')
    await main()

    const output = loggedOutput()
    expect(output).toContain('Doctor repair verification')
    expect(output).toContain('RESULT')
    expect(output).toContain('Original delegated findings are resolved.')
    expect(output).not.toContain('"verified"')
  })
})
