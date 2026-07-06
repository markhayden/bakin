/**
 * #189: `bakin tasks create --team=<id>` — flag parsing + request body.
 * Exercises the REAL command module (src/cli/commands/tasks.ts) with the
 * HTTP client mocked; the server-side validation itself is covered by the
 * tasks-plugin route tests.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-cli-tasks-team-${Date.now()}`)
process.env.BAKIN_HOME = testHome

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))

// Defensive isolation (checker-required): the CLI module talks HTTP only,
// but nothing transitively imported may touch the store either.
mock.module('../../src/core/task-store', () => ({}))
mock.module('@/core/task-store', () => ({}))

const apiPostSpy = mock(async (_path: string, _body: Record<string, unknown>) => ({ ok: true, id: 'task-cli-1' }))
mock.module('../../src/cli/http', () => ({
  apiGet: mock(async () => ({ columns: {} })),
  apiPost: (path: string, body: Record<string, unknown>) => apiPostSpy(path, body),
  getCliAgent: async () => 'cli',
}))

const printSpy = mock((_v: unknown) => {})
mock.module('../../src/cli/output', () => ({
  print: printSpy,
  printTable: mock(),
}))

class ExitCalled extends Error {}
const exitUsageSpy = mock(async (_usage: string): Promise<never> => { throw new ExitCalled('usage') })
mock.module('../../src/cli/help', () => ({
  exitUsage: exitUsageSpy,
  exitCommandIssue: mock(async (): Promise<never> => { throw new ExitCalled('issue') }),
  exitUnknownSubcommand: mock(async (): Promise<never> => { throw new ExitCalled('unknown') }),
  exitCommandFailure: mock(async (): Promise<never> => { throw new ExitCalled('failure') }),
}))

mock.module('../../src/core/cli/ui/render-report', () => ({
  renderInkReport: mock(async () => {}),
}))

import { run } from '../../src/cli/commands/tasks'

beforeEach(() => {
  apiPostSpy.mockClear()
  exitUsageSpy.mockClear()
})

describe('bakin tasks create --team (#189)', () => {
  it('sends team (and no assignee) in the create body', async () => {
    await run(['tasks', 'create', 'Review the auth PR', '--team=development'])
    expect(apiPostSpy).toHaveBeenCalledTimes(1)
    const [path, body] = apiPostSpy.mock.calls[0]
    expect(path).toBe('/api/plugins/tasks/')
    expect(body.team).toBe('development')
    expect(body.assignee).toBeUndefined()
    expect(body.title).toBe('Review the auth PR')
  })

  it('positional agent still maps to assignee with no team', async () => {
    await run(['tasks', 'create', 'Fix bug', 'dev-agent'])
    const [, body] = apiPostSpy.mock.calls[0]
    expect(body.assignee).toBe('dev-agent')
    expect(body.team).toBeUndefined()
  })

  it('agent + --team together exits with usage', async () => {
    await expect(run(['tasks', 'create', 'Bad', 'dev-agent', '--team=development'])).rejects.toThrow(ExitCalled)
    expect(exitUsageSpy).toHaveBeenCalled()
    expect(apiPostSpy).not.toHaveBeenCalled()
  })
})
