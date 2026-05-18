import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'

const fetchMock = mock()

describe('read-only CLI TTY commands', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>

  function setStdoutIsTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true })
  }

  function jsonResponse(body: unknown): Response {
    return {
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(''),
    } as Response
  }

  function output(): string {
    return log.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    process.argv = originalArgv
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    log = spyOn(console, 'log').mockImplementation(() => {})
    process.exit = ((code?: number) => {
      if (code === 0) return undefined as never
      throw new Error(`exit:${code}`)
    }) as never
    setStdoutIsTTY(true)
  })

  afterEach(() => {
    process.argv = originalArgv
    process.exit = originalExit
    globalThis.fetch = originalFetch
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
  })

  it('renders status with the shared TUI when stdout is a TTY', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        intervalMin: 5,
        lastRun: '2026-05-18T04:00:00.000Z',
        nextRun: '2026-05-18T04:05:00.000Z',
        secondsUntilNext: 120,
        dispatchedCount: 7,
      }))
      .mockResolvedValueOnce(jsonResponse({ agents: [{ id: 'main' }, { id: 'patch' }], mainAgentId: 'main' }))
    process.argv = ['bun', 'cli/bakin.ts', 'status']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(output()).toContain('Status')
    expect(output()).toContain('DISPATCH')
    expect(output()).not.toContain('=== Bakin Status ===')
  })

  it('renders tasks, agents, and plugins with shared TUI screens', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      columns: {
        todo: [{ id: 'task-1', title: 'Write docs', agent: 'patch' }],
        blocked: [{ id: 'task-2', title: 'Waiting on runtime', agent: 'main' }],
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'list']
    await main()
    expect(output()).toContain('Tasks')
    expect(output()).toContain('BOARD')
    expect(output()).toContain('COLUMN')
    expect(output()).toContain('AGENT')
    expect(output()).not.toContain('=== todo ===')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      agents: [
        { id: 'main', name: 'Main Agent', status: 'online', model: 'gpt-5.5' },
        { id: 'patch', name: 'Patch', status: 'working', model: 'gpt-5.5' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list']
    await main()
    expect(output()).toContain('Agents')
    expect(output()).toContain('MODEL')
    expect(output()).toContain('Main Agent')
    expect(output()).not.toContain('○ main:')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      routes: [
        { pluginId: 'tasks' },
        { pluginId: 'tasks' },
        { pluginId: 'team' },
        { pluginId: 'core' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'list']
    await main()
    expect(output()).toContain('Plugins')
    expect(output()).toContain('ROUTES')
    expect(output()).toContain('tasks')
    expect(output()).not.toContain('Installed plugins:')
  })

  it('renders workflows list with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      templates: [
        {
          filename: 'release.yml',
          name: 'Release',
          description: 'Prepare release notes and verification',
          stepCount: 4,
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'workflows', 'list']
    await main()

    expect(output()).toContain("┃  🐷 Bakin'                  (v1.0.0) ┃")
    expect(output()).toContain('Workflows')
    expect(output()).toContain('DEFINITIONS')
    expect(output()).toContain('FILENAME')
    expect(output()).toContain('STEPS')
    expect(output()).toContain('release.yml')
    expect(output()).not.toContain('-----------  -------')
  })

  it('renders package-oriented list commands with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      agents: [
        { agentId: 'patch', state: 'managed', packageId: 'bakin.patch' },
        { agentId: 'docs', state: 'adopted', packageId: 'bakin.docs' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list', '--packages']
    await main()
    expect(output()).toContain('Agent Packages')
    expect(output()).toContain('PACKAGE')
    expect(output()).toContain('bakin.patch')
    expect(output()).not.toContain('Agents (package state):')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      packageId: 'bakin.patch',
      lessons: [
        { lessonId: 'handoff', title: 'Handoff Notes', tags: ['workflow'], enabled: true },
        { lessonId: 'release', title: 'Release Notes', tags: [], enabled: false },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'lessons', 'list', 'patch']
    await main()
    expect(output()).toContain('Agent Lessons')
    expect(output()).toContain('LESSON')
    expect(output()).toContain('handoff')
    expect(output()).not.toContain('Lessons for patch')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      packages: [
        { id: 'bakin.patch', kind: 'agent', version: '1.0.0', refCount: 2, dependents: ['patch', 'docs'] },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'list']
    await main()
    expect(output()).toContain('Packages')
    expect(output()).toContain('DEPENDENTS')
    expect(output()).toContain('patch, docs')
    expect(output()).not.toContain('Installed packages:')
  })
})
