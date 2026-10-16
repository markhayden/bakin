/**
 * CLI actor identity (spec D12): who a `bakin tasks …` / `bakin workflows
 * submit` command acts as. ONE resolver: `--as <agent|human>` → the
 * `.bakin-run.json` sidecar found walking up from cwd (an agent's dispatch
 * shell) → the roster's main agent (today's default). Exercises the REAL
 * command modules and the real resolver with the HTTP client mocked.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testHome = join(tmpdir(), `bakin-cli-actor-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testHome
mkdirSync(testHome, { recursive: true })

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), tasks: join(testHome, 'tasks') }),
}))
mock.module('../../src/core/task-store', () => ({}))
mock.module('@/core/task-store', () => ({}))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

const apiPostSpy = mock(async (_path: string, _body: Record<string, unknown>) => ({ ok: true, id: 'task-cli-1' }))
const apiGetSpy = mock(async (path: string) => {
  if (path === '/api/plugins/team/') return { agents: [{ id: 'main' }, { id: 'patch' }], mainAgentId: 'main' }
  return { columns: {} }
})
mock.module('../../src/cli/http', () => ({
  apiGet: (path: string) => apiGetSpy(path),
  apiPost: (path: string, body: Record<string, unknown>) => apiPostSpy(path, body),
}))
mock.module('../../src/cli/output', () => ({ print: mock(), printTable: mock() }))
class ExitCalled extends Error {}
mock.module('../../src/cli/help', () => ({
  exitUsage: mock(async (): Promise<never> => { throw new ExitCalled('usage') }),
  exitCommandIssue: mock(async (): Promise<never> => { throw new ExitCalled('issue') }),
  exitUnknownSubcommand: mock(async (): Promise<never> => { throw new ExitCalled('unknown') }),
  exitCommandFailure: mock(async (): Promise<never> => { throw new ExitCalled('failure') }),
}))
mock.module('../../src/core/cli/ui/render-report', () => ({ renderInkReport: mock(async () => {}) }))

import { run as runTasks } from '../../src/cli/commands/tasks'
import { run as runWorkflows } from '../../src/cli/commands/workflows'
import { stripActorFlag, resolveCliActor } from '../../src/cli/actor'

const originalCwd = process.cwd()
const neutralDir = join(testHome, 'neutral')
mkdirSync(neutralDir, { recursive: true })

/** A run directory shaped exactly like allocateRunWorkspace writes it, with a bound-repo worktree below. */
function makeRunDir(agentId: string): { runDir: string; repoDir: string } {
  const runDir = join(testHome, 'run-workspaces', agentId, `task_abc_d1-${randomUUID().slice(0, 6)}`)
  const repoDir = join(runDir, 'repo', 'src')
  mkdirSync(repoDir, { recursive: true })
  writeFileSync(join(runDir, '.bakin-run.json'), JSON.stringify({
    version: 1,
    threadId: 'task:abc:d1',
    taskId: 'abc',
    agentId,
    createdAt: new Date().toISOString(),
    status: 'running',
  }, null, 2))
  return { runDir, repoDir }
}

beforeEach(() => {
  apiPostSpy.mockClear()
  apiGetSpy.mockClear()
  process.chdir(neutralDir)
})

afterAll(() => {
  process.chdir(originalCwd)
  rmSync(testHome, { recursive: true, force: true })
})

function lastBody(): Record<string, unknown> {
  const call = apiPostSpy.mock.calls.at(-1)
  if (!call) throw new Error('no apiPost call')
  return call[1]
}

describe('stripActorFlag', () => {
  it('removes --as <value> and --as=<value> wherever they sit, leaving positionals in order', () => {
    expect(stripActorFlag(['tasks', 'move', '--as', 'human', 't1', 'todo'])).toEqual({ as: 'human', rest: ['tasks', 'move', 't1', 'todo'] })
    expect(stripActorFlag(['tasks', 'move', 't1', 'todo', '--as=patch'])).toEqual({ as: 'patch', rest: ['tasks', 'move', 't1', 'todo'] })
    expect(stripActorFlag(['tasks', 'list'])).toEqual({ as: undefined, rest: ['tasks', 'list'] })
  })
})

describe('resolveCliActor', () => {
  it('--as human is the operator: agent human + channel human', async () => {
    expect(await resolveCliActor('human')).toEqual({ agent: 'human', channel: 'human' })
    expect(apiGetSpy).not.toHaveBeenCalled()
  })

  it('--as <agent> is that agent, no channel', async () => {
    expect(await resolveCliActor('patch')).toEqual({ agent: 'patch' })
    expect(apiGetSpy).not.toHaveBeenCalled()
  })

  it('without a flag, a sidecar in the cwd or any parent names the agent (bound-repo worktree included)', async () => {
    const { runDir, repoDir } = makeRunDir('jessica')
    process.chdir(repoDir)
    expect(await resolveCliActor(undefined)).toEqual({ agent: 'jessica' })
    process.chdir(runDir)
    expect(await resolveCliActor(undefined)).toEqual({ agent: 'jessica' })
    expect(apiGetSpy).not.toHaveBeenCalled()
  })

  it('without a flag or a run dir, falls back to the roster main agent exactly as before', async () => {
    expect(await resolveCliActor(undefined)).toEqual({ agent: 'main' })
    expect(apiGetSpy).toHaveBeenCalledWith('/api/plugins/team/')
  })
})

describe('bakin tasks … --as', () => {
  it('move: --as human sends agent human + channel human, so the server treats it as an operator move', async () => {
    await runTasks(['tasks', 'move', 't1', 'todo', '--as', 'human'])
    expect(apiPostSpy).toHaveBeenCalledTimes(1)
    expect(apiPostSpy.mock.calls[0][0]).toBe('/api/plugins/tasks/t1/move')
    expect(lastBody()).toMatchObject({ id: 't1', to: 'todo', agent: 'human', channel: 'human' })
  })

  it('move: --as patch sends agent patch and no channel; flag position does not disturb positionals', async () => {
    await runTasks(['tasks', '--as=patch', 'move', 't1', 'inProgress'])
    expect(lastBody()).toEqual({ id: 't1', to: 'inProgress', agent: 'patch' })
  })

  it('move: inside a run dir with no flag, attributes to that run\'s agent', async () => {
    const { repoDir } = makeRunDir('pixel')
    process.chdir(repoDir)
    await runTasks(['tasks', 'move', 't1', 'todo'])
    expect(lastBody()).toEqual({ id: 't1', to: 'todo', agent: 'pixel' })
  })

  it('move: bare command outside any run dir attributes to roster main', async () => {
    await runTasks(['tasks', 'move', 't1', 'todo'])
    expect(lastBody()).toEqual({ id: 't1', to: 'todo', agent: 'main' })
  })

  it('log: author is the actor', async () => {
    await runTasks(['tasks', 'log', 't1', 'did', 'things', '--as', 'patch'])
    expect(lastBody()).toEqual({ id: 't1', author: 'patch', message: 'did things' })
  })

  it('block: agent is the actor; human carries the channel', async () => {
    await runTasks(['tasks', 'block', 't1', 'waiting', '--as', 'human'])
    expect(lastBody()).toMatchObject({ id: 't1', reason: 'waiting', agent: 'human', channel: 'human' })
  })

  it('depend: sends the actor so the server can attribute the dependency', async () => {
    await runTasks(['tasks', 'depend', 't1', 't0', '--as', 'patch'])
    expect(apiPostSpy.mock.calls[0][0]).toBe('/api/plugins/tasks/t1/dependency')
    expect(lastBody()).toEqual({ id: 't1', dependsOn: 't0', agent: 'patch' })
  })

  it('complete: the log author and the done move both carry the actor', async () => {
    await runTasks(['tasks', 'complete', 't1', 'all', 'done', '--as', 'patch'])
    expect(apiPostSpy).toHaveBeenCalledTimes(2)
    expect(apiPostSpy.mock.calls[0][1]).toEqual({ id: 't1', author: 'patch', message: 'Task complete: all done' })
    expect(apiPostSpy.mock.calls[1][1]).toEqual({ id: 't1', to: 'done', agent: 'patch' })
  })

  it('create: createdBy is the actor', async () => {
    await runTasks(['tasks', 'create', 'Write the docs', '--as', 'patch'])
    expect(lastBody()).toMatchObject({ title: 'Write the docs', createdBy: 'patch' })
  })
})

describe('bakin workflows submit --as', () => {
  it('agentId is the actor', async () => {
    await runWorkflows(['workflows', 'submit', 't1', 'draft', '{"ok":true}', '--as', 'patch'])
    expect(apiPostSpy.mock.calls[0][0]).toBe('/api/plugins/workflows/steps/t1/complete')
    expect(lastBody()).toEqual({ stepId: 'draft', agentId: 'patch', output: { ok: true } })
  })
})
