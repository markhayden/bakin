/**
 * Read-only CLI TTY commands — tasks and workflows: argument validation,
 * board/detail rendering, task actions, and workflow list/actions. Split
 * from readonly-commands.test.ts (B7).
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

// These flows are HTTP-only (fetch is mocked), but the isolation mocks are
// mandatory insurance: nothing this test transitively imports may ever
// resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-readonly-tasks-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { fetchMock, output, errorOutput, setStdoutIsTTY, jsonResponse } = harness

describe('read-only CLI TTY commands — tasks and workflows', () => {
  it('renders missing-argument usage with the shared TUI when stdout is a TTY', async () => {
    process.argv = ['bun', 'cli/bakin.ts', 'tasks', 'get']

    const { main } = await import('../../cli/bakin')
    await expect(main()).rejects.toThrow('exit:1')

    expect(output()).toContain("┃ 🐷 Bakin'")
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

  it('renders the task board with the shared TUI screen', async () => {
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
  })

  it('renders task detail with the shared TUI screen in a TTY', async () => {
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

    expect(output()).toContain("┃ 🐷 Bakin'")
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

    harness.log.mockClear()
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

    harness.log.mockClear()
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
})
