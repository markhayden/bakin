import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { APP_VERSION } from '../../packages/core/src/constants'

const fetchMock = mock()

describe('read-only CLI TTY commands', () => {
  const originalArgv = process.argv
  const originalExit = process.exit
  const originalFetch = globalThis.fetch
  const originalCwd = process.cwd()
  const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  let log: ReturnType<typeof spyOn>
  let error: ReturnType<typeof spyOn>

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

  function errorOutput(): string {
    return error.mock.calls
      .map((call: unknown[]) => call.map(part => String(part)).join(' '))
      .join('\n')
  }

  beforeEach(() => {
    mock.clearAllMocks()
    process.argv = originalArgv
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }))
    log = spyOn(console, 'log').mockImplementation(() => {})
    error = spyOn(console, 'error').mockImplementation(() => {})
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
    process.chdir(originalCwd)
    if (originalStdoutIsTTY) Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY)
    else delete (process.stdout as { isTTY?: boolean }).isTTY
    log.mockRestore()
    error.mockRestore()
  })

  it('renders top-level help with the shared TUI when stdout is a TTY', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    process.argv = ['bun', 'cli/bakin.ts', '--help']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:0')

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Help')
    expect(output()).toContain('LIFECYCLE')
    expect(output()).toContain('TASKS AND WORKFLOWS')
    expect(output()).not.toContain('Usage: bakin <command> [options]')
    expect(errorOutput()).toBe('')
  })

  it('accepts help as a source CLI alias for the shared TUI help', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    process.argv = ['bun', 'cli/bakin.ts', 'help']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:0')

    expect(output()).toContain('Help')
    expect(output()).toContain('LIFECYCLE')
    expect(errorOutput()).toBe('')
  })

  it('renders source CLI version with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'version']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain(`Version  v${APP_VERSION}`)
    expect(output()).toContain(APP_VERSION)
    expect(errorOutput()).toBe('')
  })

  it('renders unknown top-level commands with help in the shared TUI', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    fetchMock.mockResolvedValueOnce(jsonResponse({ plugins: [] }))
    process.argv = ['bun', 'cli/bakin.ts', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(errorOutput()).toBe('')
    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Help  unknown command')
    expect(output()).toContain('ISSUE')
    expect(output()).toContain('Unknown command: wat')
    expect(output()).not.toContain('Usage: bakin <command> [options]')
  })

  it('still renders unknown-command help when plugin command lookup cannot reach the server', async () => {
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code ?? 0}`)
    }) as never
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    process.argv = ['bun', 'cli/bakin.ts', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(errorOutput()).toBe('')
    expect(output()).toContain('Help  unknown command')
    expect(output()).toContain('Plugin command lookup skipped')
    expect(output()).not.toContain('Error: Cannot connect to Bakin')
  })

  it('renders plugin-contributed command results with the shared TUI in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        plugins: [{
          id: 'demo',
          contributes: {
            cliCommands: [{
              name: 'demo:run',
              usage: 'bakin demo run <target>',
              summary: 'Run demo command.',
              dispatch: { type: 'apiRoute', method: 'POST', path: '/run' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        accepted: true,
        target: 'smoke',
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'demo', 'run', 'smoke', '--loud=true']

    await main()

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3737/api/plugins/demo/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ loud: true, target: 'smoke' }),
      }),
    )
    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('bakin demo run smoke --loud=true')
    expect(output()).toContain('DATA')
    expect(output()).toContain('"target": "smoke"')
    expect(errorOutput()).toBe('')
  })

  it('honors --json for plugin-contributed commands even in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        plugins: [{
          id: 'demo',
          contributes: {
            cliCommands: [{
              name: 'demo:json',
              usage: 'bakin demo json <target> [--json]',
              summary: 'Show JSON command.',
              dispatch: { type: 'apiRoute', method: 'GET', path: '/json' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        target: 'machine',
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'demo', 'json', 'machine', '--json']

    await main()

    expect(output()).toBe('{\n  "target": "machine"\n}')
    expect(output()).not.toContain("Bakin'")
    expect(errorOutput()).toBe('')
  })

  it('keeps plugin-contributed command results raw outside TTY', async () => {
    setStdoutIsTTY(false)
    const { main } = await import('../../cli/bakin')

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        plugins: [{
          id: 'demo',
          contributes: {
            cliCommands: [{
              name: 'demo:show',
              usage: 'bakin demo show <target>',
              summary: 'Show demo command.',
              dispatch: { type: 'apiRoute', method: 'GET', path: '/show' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        target: 'plain',
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'demo', 'show', 'plain']

    await main()

    expect(output()).toBe('{\n  "target": "plain"\n}')
    expect(output()).not.toContain("Bakin'")
    expect(errorOutput()).toBe('')
  })

  it('renders missing-argument usage with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'get']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Command issue  bakin tasks get <id>')
    expect(output()).toContain('Missing required arguments.')
    expect(output()).toContain('USAGE')
    expect(output()).toContain('bakin tasks get <id>')
    expect(errorOutput()).toBe('')
  })

  it('renders unknown subcommands with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command issue  bakin tasks')
    expect(output()).toContain('Unknown tasks subcommand: wat')
    expect(output()).toContain('AVAILABLE')
    expect(output()).toContain('list | get | create')
    expect(errorOutput()).toBe('')
  })

  it('keeps missing-argument usage plain outside TTY', async () => {
    setStdoutIsTTY(false)
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'get']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toBe('')
    expect(errorOutput()).toBe('Usage: bakin tasks get <id>')
  })

  it('renders invalid task list columns with the shared TUI when stdout is a TTY', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ columns: { todo: [], done: [] } }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'list', '--column=blocked']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command issue  bakin tasks list')
    expect(output()).toContain('Unknown tasks column: blocked')
    expect(output()).toContain('USAGE')
    expect(output()).toContain('bakin tasks list [--column=<column>]')
    expect(output()).toContain('AVAILABLE')
    expect(output()).toContain('columns')
    expect(output()).toContain('todo | done')
    expect(errorOutput()).toBe('')
  })

  it('renders invalid workflow submit JSON with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'workflows', 'submit', 'task-1', 'step-1', '{bad']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command issue  bakin workflows submit')
    expect(output()).toContain('Invalid JSON for output.')
    expect(output()).toContain('Output must parse as a JSON object.')
    expect(output()).toContain('bakin workflows submit <taskId> <stepId>')
    expect(errorOutput()).toBe('')
  })

  it('renders task creation result errors with the shared TUI when stdout is a TTY', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Task title is invalid.' }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'create', 'Bad task']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command failed  bakin tasks create')
    expect(output()).toContain('Task title is invalid.')
    expect(output()).toContain('TASK_CREATE_FAILED')
    expect(errorOutput()).toBe('')
  })

  it('renders missing task lookups with the shared TUI when stdout is a TTY', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      columns: {
        todo: [],
        done: [],
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'get', 'missing-task']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command failed  bakin tasks get')
    expect(output()).toContain('Task missing-task not found')
    expect(output()).toContain('TASK_NOT_FOUND')
    expect(output()).toContain('Run `bakin tasks list`')
    expect(errorOutput()).toBe('')
  })

  it('renders missing audit log failures with the shared TUI when stdout is a TTY', async () => {
    const originalBakinHome = process.env.BAKIN_HOME
    const tempHome = mkdtempSync(join(tmpdir(), 'bakin-cli-missing-audit-'))
    const { resetContentDir } = await import('../../packages/core/src/content-dir')
    process.env.BAKIN_HOME = tempHome
    resetContentDir()
    process.argv = ['bun', 'cli/bakin.ts', 'logs']

    try {
      const { main } = await import('../../cli/bakin')
      await expect(main()).rejects.toThrow('exit:1')
    } finally {
      if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
      else process.env.BAKIN_HOME = originalBakinHome
      resetContentDir()
    }

    expect(output()).toContain('Command failed  bakin logs')
    expect(output()).toContain('AUDIT_LOG_NOT_FOUND')
    expect(output()).toContain('Run `bakin mkdir`')
    expect(errorOutput()).toBe('')
  })

  it('renders audit logs as compact rows in a TTY', async () => {
    const originalBakinHome = process.env.BAKIN_HOME
    const tempHome = mkdtempSync(join(tmpdir(), 'bakin-cli-logs-tty-'))
    const { resetContentDir } = await import('../../packages/core/src/content-dir')
    process.env.BAKIN_HOME = tempHome
    resetContentDir()
    writeFileSync(join(tempHome, 'audit.jsonl'), [
      JSON.stringify({
        ts: '2026-05-19T19:36:18.405Z',
        event: 'doctor.run',
        agent: 'system',
        channel: null,
        data: { total: 81, errors: 0, warnings: 1 },
      }),
      JSON.stringify({
        ts: '2026-05-19T19:36:23.900Z',
        event: 'system.shutdown',
        agent: 'system',
        channel: null,
        data: { signal: 'SIGINT' },
      }),
    ].join('\n'))
    process.argv = ['bun', 'cli/bakin.ts', 'logs', '--no-follow']

    try {
      const { main } = await import('../../cli/bakin')
      await main()
    } finally {
      if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
      else process.env.BAKIN_HOME = originalBakinHome
      resetContentDir()
    }

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Logs  filter: all')
    expect(output()).toContain('RECENT EVENTS')
    expect(output()).toContain('doctor.run')
    expect(output()).toContain('total=81 errors=0 warnings=1')
    expect(output()).not.toContain('{\n  "ts"')
    expect(errorOutput()).toBe('')
  })

  it('emits newline-delimited JSON for audit logs with --json', async () => {
    const originalBakinHome = process.env.BAKIN_HOME
    const tempHome = mkdtempSync(join(tmpdir(), 'bakin-cli-logs-json-'))
    const { resetContentDir } = await import('../../packages/core/src/content-dir')
    process.env.BAKIN_HOME = tempHome
    resetContentDir()
    writeFileSync(join(tempHome, 'audit.jsonl'), [
      JSON.stringify({
        ts: '2026-05-19T19:36:18.405Z',
        event: 'doctor.run',
        agent: 'system',
        channel: null,
        data: { total: 81 },
      }),
      JSON.stringify({
        ts: '2026-05-19T19:36:46.301Z',
        event: 'plugin.activate',
        agent: 'system',
        channel: 'system',
        data: { pluginId: 'team' },
      }),
    ].join('\n'))
    process.argv = ['bun', 'cli/bakin.ts', 'logs', '--json', '--no-follow']

    try {
      const { main } = await import('../../cli/bakin')
      await main()
    } finally {
      if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
      else process.env.BAKIN_HOME = originalBakinHome
      resetContentDir()
    }

    expect(output()).toContain('{"ts":"2026-05-19T19:36:18.405Z","event":"doctor.run"')
    expect(output()).toContain('{"ts":"2026-05-19T19:36:46.301Z","event":"plugin.activate"')
    expect(output()).not.toContain('Tailing')
    expect(output()).not.toContain('filter: --json')
    expect(errorOutput()).toBe('')
  })

  it('defaults audit logs to newline-delimited JSON outside TTY', async () => {
    setStdoutIsTTY(false)
    const originalBakinHome = process.env.BAKIN_HOME
    const tempHome = mkdtempSync(join(tmpdir(), 'bakin-cli-logs-pipe-'))
    const { resetContentDir } = await import('../../packages/core/src/content-dir')
    process.env.BAKIN_HOME = tempHome
    resetContentDir()
    writeFileSync(join(tempHome, 'audit.jsonl'), JSON.stringify({
      ts: '2026-05-19T19:36:18.405Z',
      event: 'doctor.run',
      agent: 'system',
      channel: null,
      data: { total: 81 },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'logs', '--no-follow']

    try {
      const { main } = await import('../../cli/bakin')
      await main()
    } finally {
      if (originalBakinHome === undefined) delete process.env.BAKIN_HOME
      else process.env.BAKIN_HOME = originalBakinHome
      resetContentDir()
    }

    expect(output()).toBe('{"ts":"2026-05-19T19:36:18.405Z","event":"doctor.run","agent":"system","channel":null,"data":{"total":81}}')
    expect(errorOutput()).toBe('')
  })

  it('renders doctor repair command issues with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'doctor', 'repair', 'wat']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain('Command issue  bakin doctor repair')
    expect(output()).toContain('Unknown doctor repair subcommand: wat')
    expect(output()).toContain('list | show | verify')
    expect(errorOutput()).toBe('')
  })

  it('renders agent-rules command help with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'agent-rules']

    const { main } = await import('../../cli/bakin')
    await main()

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Help')
    expect(output()).toContain('AGENT RULES')
    expect(output()).toContain('bakin agent-rules --apply')
    expect(output()).not.toContain('Usage: bakin agent-rules --apply')
    expect(errorOutput()).toBe('')
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

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Status')
    expect(output()).toContain('DISPATCH')
    expect(output()).not.toContain('=== Bakin Status ===')
  })

  it('renders runtime action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, ts: '2026-05-18T09:00:00.000Z' }))
    process.argv = ['bun', 'cli/bakin.ts', 'dispatch']
    await main()
    expect(output()).toContain('Runtime action')
    expect(output()).toContain('Triggered immediate task dispatch.')
    expect(output()).toContain('RESULT')
    expect(output()).not.toContain('"ok": true')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, reply: 'Message accepted' }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'send', 'patch', 'Check the build']
    await main()
    expect(output()).toContain('Runtime action')
    expect(output()).toContain('Sent message to patch.')
    expect(output()).toContain('Message accepted')
    expect(output()).not.toContain('"reply"')
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
      plugins: [
        { id: 'team', name: 'Team', version: '1.0.0', source: 'core', status: 'active' },
        { id: 'tasks', name: 'Tasks', version: '2.1.0', source: 'core', status: 'active' },
        { id: 'schedule', name: 'Schedule', version: '2.0.0', source: 'core', status: 'active' },
        { id: 'assets', name: 'Assets', version: '2.0.0', source: 'core', status: 'active' },
        { id: 'health', name: 'Health', version: '1.0.0', source: 'core', status: 'active' },
        { id: 'models', name: 'Models', version: '2.1.0', source: 'core', status: 'active' },
        { id: 'messaging', name: 'Messaging', version: '2.0.0', source: 'github', status: 'active' },
        { id: 'projects', name: 'Projects', version: '2.0.0', source: 'github', status: 'active' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'list']
    await main()
    expect(output()).toContain('Plugins')
    expect(output()).toContain('SOURCE')
    expect(output()).toContain('tasks')
    expect(output()).toContain('schedule')
    expect(output()).toContain('assets')
    expect(output()).toContain('health')
    expect(output()).toContain('models')
    expect(output()).toContain('messaging')
    expect(output()).toContain('projects')
    expect(output()).not.toContain('Installed plugins:')
  })

  it('renders task and agent detail commands with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      columns: {
        inProgress: [{ id: 'task-1', title: 'Write docs', agent: 'patch', priority: 'high' }],
        todo: [],
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'get', 'task-1']
    await main()
    expect(output()).toContain('Task Detail')
    expect(output()).toContain('id: task-1')
    expect(output()).toContain('Write docs')
    expect(output()).toContain('FIELDS')
    expect(output()).not.toContain('Column: inProgress')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'patch',
      name: 'Patch',
      role: 'Engineer',
      model: 'gpt-5.5',
      workspacePath: '/tmp/patch',
      soul: '# Patch Soul\n',
      identity: '# Identity\n',
      rules: '',
      tools: null,
      heartbeatMd: '# Heartbeat\nWorking on docs',
      subagentPerms: ['docs'],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'status', 'patch']
    await main()
    expect(output()).toContain('Agent Status')
    expect(output()).toContain('agent: patch')
    expect(output()).toContain('PROFILE')
    expect(output()).toContain('Patch')
    expect(output()).toContain('WORKSPACE')
    expect(output()).not.toContain('"workspacePath"')
  })

  it('renders task action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'task-1',
      workflowId: 'release',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'create', 'Write docs', 'patch', '--workflow=release']
    await main()

    expect(output()).toContain('Task action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('task-1')
    expect(output()).toContain('Created task Write docs.')
    expect(output()).toContain('workflow')
    expect(output()).not.toContain('"ok": true')
  })

  it('honors --json for task detail commands even in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      columns: {
        inProgress: [{ id: 'task-1', title: 'Write docs', agent: 'patch' }],
        todo: [],
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'get', 'task-1', '--json']
    await main()

    expect(output()).toContain('"column": "inProgress"')
    expect(output()).toContain('"title": "Write docs"')
    expect(output()).not.toContain('Task Detail')
    expect(output()).not.toContain('Column: inProgress')
  })

  it('honors --json for taxonomy list commands even in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      agents: [
        { id: 'pixel', name: 'Pixel', status: 'online', model: 'openai-codex/gpt-5.5' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list', '--json']
    await main()
    expect(output()).toContain('"agents": [')
    expect(output()).toContain('"id": "pixel"')
    expect(output()).not.toContain('ROSTER')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      plugins: [
        { id: 'tasks', name: 'Tasks', version: '2.1.0', source: 'core', status: 'active' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'list', '--check', '--json']
    await main()
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/plugins/manifest?check=1')
    expect(output()).toContain('"plugins": [')
    expect(output()).toContain('"id": "tasks"')
    expect(output()).not.toContain('Installed plugins')
    expect(output()).not.toContain('SOURCE')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      packages: [
        { id: 'shared-skills', kind: 'skill-pack', version: '1.0.0', refCount: 0, dependents: [] },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'list', '--json']
    await main()
    expect(output()).toContain('"packages": [')
    expect(output()).toContain('"id": "shared-skills"')
    expect(output()).not.toContain('INSTALLED PACKAGES')
  })

  it('renders setup configuration summaries with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      dispatch: { intervalMs: 300000, maxRetries: 3 },
      runtime: { adapter: 'openclaw' },
      plugins: { requireSignatures: false },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'get']
    await main()
    expect(output()).toContain('Settings')
    expect(output()).toContain('CONFIGURATION')
    expect(output()).toContain('dispatch.intervalMs')
    expect(output()).not.toContain('"dispatch"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      isBakinHome: true,
      paths: {
        home: '/Users/roscoe/.bakin',
        tasks: '/Users/roscoe/.bakin/tasks',
        audit: '/Users/roscoe/.bakin/audit.jsonl',
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'paths']
    await main()
    expect(output()).toContain('Paths')
    expect(output()).toContain('DIRECTORIES')
    expect(output()).toContain('/Users/roscoe/.bakin')
    expect(output()).not.toContain('Content dir:')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dispatch: { intervalMs: 300000, maxRetries: 3 },
      runtime: { adapter: 'openclaw' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'get', 'dispatch.intervalMs']
    await main()
    expect(output()).toContain('Settings')
    expect(output()).toContain('dispatch.intervalMs')
    expect(output()).toContain('300000')
    expect(output()).toContain('CONFIGURATION')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'set', 'dispatch.intervalMs', '300000']
    await main()
    expect(output()).toContain('Settings action')
    expect(output()).toContain('Updated setting dispatch.intervalMs.')
    expect(output()).toContain('Value: 300000')
    expect(output()).not.toContain('"ok": true')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      dispatch: { intervalMs: 300000, maxRetries: 3 },
      runtime: { adapter: 'openclaw' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'settings', 'get', 'dispatch.intervalMin', '--json']
    await main()
    expect(output()).toBe('null')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      path: '/Users/roscoe/.bakin/assets',
      isBakinHome: true,
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'paths', 'assets']
    await main()
    expect(output()).toContain('Paths')
    expect(output()).toContain('assets')
    expect(output()).toContain('/Users/roscoe/.bakin/assets')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({ path: '/Users/roscoe/.bakin/assets' }))
    process.argv = ['bun', 'cli/bakin.ts', 'paths', 'assets', '--json']
    await main()
    expect(output()).toContain('"path": "/Users/roscoe/.bakin/assets"')
    expect(output()).not.toContain('Paths')
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

    expect(output()).toContain("┃ 🐷 Bakin'               (v0.0.0-dev) ┃")
    expect(output()).toContain('Workflows')
    expect(output()).toContain('DEFINITIONS')
    expect(output()).toContain('FILENAME')
    expect(output()).toContain('STEPS')
    expect(output()).toContain('release.yml')
    expect(output()).not.toContain('-----------  -------')
  })

  it('renders workflow actions with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      instance: { taskId: 'task-1', workflowId: 'release', status: 'in_progress', currentStepId: 'draft' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'workflows', 'start', 'task-1', 'release']
    await main()
    expect(output()).toContain('Workflow action')
    expect(output()).toContain('Started workflow release')
    expect(output()).toContain('RESULT')
    expect(output()).not.toContain('"instance"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      stepId: 'draft',
      label: 'Draft release notes',
      type: 'agent',
      agent: 'patch',
      status: 'in_progress',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'workflows', 'step', 'task-1']
    await main()
    expect(output()).toContain('Current workflow step draft')
    expect(output()).toContain('Draft release')

    log.mockClear()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ agents: [{ id: 'patch' }], mainAgentId: 'patch' }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        workflowComplete: false,
        nextStep: { stepId: 'review', label: 'Review release notes', status: 'pending' },
      }))
    process.argv = ['bun', 'cli/bakin.ts', 'workflows', 'submit', 'task-1', 'draft', '{"summary":"done"}']
    await main()
    expect(output()).toContain('Completed workflow step draft.')
    expect(output()).toContain('Next step review')
    expect(output()).not.toContain('"success": true')
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
        { id: 'lessons', kind: 'lesson-pack', version: '1.0.0', refCount: 0, dependents: [] },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'list']
    await main()
    expect(output()).toContain('Packages')
    expect(output()).toContain('DEPENDENTS')
    expect(output()).toContain('lessons')
    expect(output()).not.toContain('bakin.patch')
    expect(output()).not.toContain('Installed packages:')
  })

  it('renders package action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.patch',
        kind: 'agent',
        createdAgent: true,
        adopted: false,
        dependencies: [],
        skipped: [],
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'install', 'github:markhayden/bakin-patch']
    await main()
    expect(output()).toContain('Package action')
    expect(output()).toContain('Installed agent package bakin.patch.')
    expect(output()).toContain('Created runtime agent.')
    expect(output()).not.toContain('"packageId"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.patch',
        lessonId: 'style',
        enabled: false,
        changed: true,
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'lessons', 'disable', 'patch', 'style']
    await main()
    expect(output()).toContain('Package action')
    expect(output()).toContain('Disabled lesson style for patch.')
    expect(output()).not.toContain('"enabled": false')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.patch',
        lessonId: 'style',
        enabled: true,
        changed: true,
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'lessons', 'enable', 'patch', 'style', '--json']
    await main()
    expect(output()).toContain('"enabled": true')
    expect(output()).not.toContain('Package action')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.workflow',
        changed: true,
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'update', 'bakin.workflow']
    await main()
    expect(output()).toContain('Package action')
    expect(output()).toContain('Updated package bakin.workflow.')
    expect(output()).toContain('1.0.0 -> 1.1.0')
    expect(output()).not.toContain('"fromVersion"')
  })

  it('renders schedule list and run history with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      jobs: [
        {
          id: 'job-1',
          displayName: 'Daily Doctor',
          agentId: 'main',
          humanSchedule: 'Every day at 9:00 AM',
          paused: false,
          enabled: true,
          isBakinJob: true,
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'schedule', 'list']
    await main()
    expect(output()).toContain('Schedule')
    expect(output()).toContain('JOBS')
    expect(output()).toContain('Daily Doctor')
    expect(output()).not.toContain('Name                      Agent')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      runs: [
        { runId: 'run-1', timestamp: '2026-05-18T09:00:00.000Z', status: 'ok', taskId: 'task-1' },
        { runId: 'run-2', timestamp: '2026-05-17T09:00:00.000Z', status: 'error', error: 'timeout' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'schedule', 'runs', 'job-1']
    await main()
    expect(output()).toContain('Schedule Runs')
    expect(output()).toContain('RUN HISTORY')
    expect(output()).toContain('task-1')
    expect(output()).toContain('timeout')
    expect(output()).not.toContain('Time                   Status')
  })

  it('renders trash list with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      count: 1,
      assets: [{
        filename: 'doc.md__deleted-20260518',
        originalFilename: 'doc.md',
        type: 'markdown',
        size: 2048,
        deletedAt: '2026-05-18T09:00:00.000Z',
        expiresAt: '2026-05-25T09:00:00.000Z',
        metadata: { agent: 'patch' },
      }],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'list']
    await main()

    expect(output()).toContain('Trash')
    expect(output()).toContain('TRASHED ASSETS')
    expect(output()).toContain('doc.md')
    expect(output()).toContain('bakin trash restore <trashName>')
    expect(output()).not.toContain('item in trash:')
  })

  it('renders trash action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      restoredPath: '/Users/roscoe/.bakin/assets/doc.md',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'restore', 'doc.md__deleted-20260518']
    await main()
    expect(output()).toContain('Trash action')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Restored doc.md__deleted-20260518.')
    expect(output()).not.toContain('Restored →')

    log.mockClear()
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ count: 2 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, deleted: 2 }))
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'empty']
    await main()
    expect(output()).toContain('Trash action')
    expect(output()).toContain('Permanently deleted 2 items.')
    expect(output()).toContain('RESULT')
  })

  it('renders parsed API JSON errors without raw response bodies', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Failed to restore asset' }),
      text: () => Promise.resolve('{"error":"Failed to restore asset"}'),
    } as Response)
    process.argv = ['bun', 'cli/bakin.ts', 'trash', 'restore', 'test']

    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toContain('Command failed  bakin trash restore test')
    expect(output()).toContain('HTTP 500: Failed to restore asset')
    expect(output()).not.toContain('{"error"')
    expect(errorOutput()).toBe('')
  })

  it('renders server connection failures with the shared TUI when stdout is a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'list']

    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toContain('Command failed  bakin tasks list')
    expect(output()).toContain('Cannot connect to Bakin. Is the server running?')
    expect(output()).toContain('SERVER_UNREACHABLE')
    expect(output()).toContain('Run `bakin start`')
    expect(errorOutput()).toBe('')
  })

  it('keeps server connection failures plain outside TTY', async () => {
    setStdoutIsTTY(false)
    const { main } = await import('../../cli/bakin')

    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'list']

    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toBe('')
    expect(errorOutput()).toContain('Error: Cannot connect to Bakin. Is the server running?')
    expect(errorOutput()).toContain('Run `bakin start` to launch the server.')
  })

  it('renders agent task lists with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      tasks: [
        { id: 'task-1', title: 'Write docs', column: 'todo' },
        { id: 'task-2', title: 'Waiting on review', column: 'blocked' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'tasks', 'patch']
    await main()

    expect(output()).toContain('Agent Tasks')
    expect(output()).toContain('agent: patch')
    expect(output()).toContain('TASKS')
    expect(output()).toContain('Write docs')
    expect(output()).not.toContain('id      title')
  })

  it('renders docs and search read-only commands with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      routes: [
        { method: 'GET', fullPath: '/api/plugins/tasks/', pluginId: 'tasks', description: 'List tasks' },
        { method: 'POST', fullPath: '/api/plugins/tasks/', pluginId: 'tasks', description: 'Create task' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'docs']
    await main()
    expect(output()).toContain('Docs')
    expect(output()).toContain('ROUTES')
    expect(output()).toContain('/api/plugins/tasks/')
    expect(output()).not.toContain('GET /api/plugins/tasks/')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      results: [
        {
          id: 'task-1',
          score: 0.9123,
          table: 'bakin_tasks',
          fields: { title: 'Blocked task' },
        },
      ],
      aggregations: { status: [{ value: 'blocked', count: 1 }] },
      meta: { query: 'blocked task', total: 1, took_ms: 4, source: 'tantivy' },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'search', 'blocked', 'task', '--table=tasks']
    await main()
    expect(output()).toContain('Search')
    expect(output()).toContain('RESULTS')
    expect(output()).toContain('Blocked task')
    expect(output()).toContain('tasks')
    expect(output()).toContain('task-1')
    expect(output()).toContain('FACETS')
    expect(output()).not.toContain('Search: "blocked task"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      enabled: true,
      tables: [
        {
          table: 'bakin_tasks',
          pluginId: 'tasks',
          stats: { num_docs: 12 },
          healthy: true,
          indexHealth: [],
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'search:stats']
    await main()
    expect(output()).toContain('Search Stats')
    expect(output()).toContain('TABLES')
    expect(output()).toContain('bakin_tasks')
    expect(output()).not.toContain('Search: enabled')
  })

  it('renders reindex results with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: false,
      total: 12,
      errors: 1,
      enrichmentErrors: 1,
      tables: [
        { table: 'bakin_tasks', indexed: 12, enrichment: { healthy: true, indexes: [] } },
        { table: 'agent_lessons', indexed: 0, error: 'schema missing' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'reindex', '--table', 'tasks', '--rebuild']
    await main()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3737/api/reindex?table=tasks&rebuild=true',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(output()).toContain('Reindex')
    expect(output()).toContain('target: tasks')
    expect(output()).toContain('TABLES')
    expect(output()).toContain('bakin_tasks')
    expect(output()).toContain('agent_lessons')
    expect(output()).toContain('schema missing')
    expect(output()).not.toContain('Reindexing tasks into search')
  })

  it('renders plugin lifecycle actions with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'messaging',
      version: '2.0.0',
      activated: true,
      runtimeVersion: 4,
      message: 'Installed "messaging" and activated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'install', 'github:markhayden/bakin-bits-official#plugins/messaging']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Installed "messaging" and activated it.')
    expect(output()).toContain('Runtime version: 4')
    expect(output()).not.toContain('"id": "messaging"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'messaging',
      snapshot: '/Users/roscoe/.bakin/.uninstalled/messaging.tar.gz',
      skills: { removed: 2, kept: 0 },
      message: 'Removed "messaging" and deactivated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'remove', 'messaging']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Removed "messaging" and deactivated it.')
    expect(output()).toContain('Runtime skills: 2 removed, 0 kept')
    expect(output()).not.toContain('"snapshot"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'local-tools',
      linkedSource: '/Users/roscoe/dev/local-tools',
      pluginDir: '/Users/roscoe/.bakin/plugins/local-tools',
      watching: true,
      message: 'Linked "local-tools" and activated it with dev hot reload.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'link', './local-tools', '--force']
    await main()
    expect(output()).toContain('Linked "local-tools" and activated it with dev')
    expect(output()).toContain('hot reload.')
    expect(output()).toContain('Dev hot reload is watching the linked source.')
    expect(output()).not.toContain('"linkedSource"')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'local-tools',
      message: 'Unlinked "local-tools" and deactivated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'unlink', 'local-tools']
    await main()
    expect(output()).toContain('Unlinked "local-tools" and deactivated it.')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'messaging',
      before: { version: '1.0.0', commitSha: '1111111111111111111111111111111111111111' },
      after: { version: '2.0.0', commitSha: '2222222222222222222222222222222222222222' },
      pluginAssets: { installed: [{ name: 'compose' }], skipped: [] },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'upgrade', 'messaging', '--yes']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Upgraded plugin messaging 1.0.0 -> 2.0.0.')
    expect(output()).toContain('Runtime skills: 1 applied, 0 skipped')
    expect(output()).not.toContain('"before"')

    log.mockClear()
    error.mockClear()
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'cannot upgrade core plugin: tasks' }),
      text: () => Promise.resolve('{"error":"cannot upgrade core plugin: tasks"}'),
    } as Response)
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'upgrade', 'tasks', '--yes', '--json']
    await expect(main()).rejects.toThrow('exit:1')
    expect(output()).toContain('"ok": false')
    expect(output()).toContain('"status": 400')
    expect(output()).toContain('"error": "cannot upgrade core plugin: tasks"')
    expect(errorOutput()).not.toContain('cannot upgrade core plugin')

    log.mockClear()
    const scaffoldDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-scaffold-'))
    process.chdir(scaffoldDir)
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'scaffold', 'smoke-plugin']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Scaffolded plugin smoke-plugin.')
    expect(output()).toContain('Next: cd smoke-plugin && bun install && bakin')
    expect(output()).toContain('plugins install .')
    expect(existsSync(join(scaffoldDir, 'smoke-plugin', 'bakin-plugin.json'))).toBe(true)

    log.mockClear()
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'scaffold', 'json-smoke-plugin', '--json']
    await main()
    expect(output()).toContain('"ok": true')
    expect(output()).toContain('"id": "json-smoke-plugin"')
    expect(output()).not.toContain('Plugin action')
    expect(existsSync(join(scaffoldDir, 'json-smoke-plugin', 'bakin-plugin.json'))).toBe(true)

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'json-plugin',
      message: 'Installed "json-plugin" and activated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'install', './json-plugin', '--json']
    await main()
    expect(output()).toContain('"id": "json-plugin"')
    expect(output()).not.toContain('Plugin action')

    log.mockClear()
    const dir = mkdtempSync(join(tmpdir(), 'bakin-plugin-import-'))
    const manifest = join(dir, 'plugins.json')
    writeFileSync(manifest, JSON.stringify({
      version: 1,
      plugins: [
        { id: 'projects', source: 'github:markhayden/bakin-bits-official#plugins/projects', type: 'github', ref: '', commitSha: '' },
      ],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      id: 'projects',
      message: 'Installed "projects" and activated it.',
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'import', manifest, '--yes']
    await main()
    expect(output()).toContain('Plugin action')
    expect(output()).toContain('Imported 1 plugin.')
    expect(output()).toContain('Installed: projects')
    expect(output()).not.toContain('Installing projects from')
  })

  it('renders plugin restore snapshots and results with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      snapshots: [
        {
          timestamp: '2026-05-04T00-00-00-000Z',
          createdAt: '2026-05-04T00:00:00.000Z',
          filename: 'demo-plugin-2026.tar.gz',
          sizeBytes: 4096,
        },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'restore', 'demo-plugin', '--list']
    await main()

    expect(output()).toContain('Plugin Restore')
    expect(output()).toContain('plugin: demo-plugin')
    expect(output()).toContain('SNAPSHOTS')
    expect(output()).toContain('demo-plugin-2026.tar.gz')
    expect(output()).not.toContain('Uninstall snapshots for')

    log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      message: 'Restored "demo-plugin".',
      snapshotInfo: {
        timestamp: '2026-05-04T00-00-00-000Z',
        createdAt: '2026-05-04T00:00:00.000Z',
        filename: 'demo-plugin-2026.tar.gz',
        sizeBytes: 4096,
      },
      skills: { restored: 2 },
      activated: false,
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'restore', 'demo-plugin', '--snapshot', 'demo-plugin-2026.tar.gz', '--force']
    await main()

    expect(output()).toContain('Plugin Restore')
    expect(output()).toContain('RESULT')
    expect(output()).toContain('Restored "demo-plugin".')
    expect(output()).toContain('demo-plugin-2026.tar.gz')
    expect(output()).toContain('Activation deferred until next server start.')
    expect(output()).not.toContain('Restored plugin:')
  })
})
