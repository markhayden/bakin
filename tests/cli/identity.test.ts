/**
 * CLI identity (#898 D-H4/D-H5): detected BEFORE `--as` is honored — the
 * env marker an agent shell carries, a run-dir sidecar above cwd, and (only
 * for `--as human`) the server's workspace check. An agent context
 * overrides the operator declaration on the wire.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { identityHeaders, resolveCliIdentity } from '../../src/cli/identity'

const root = mkdtempSync(join(tmpdir(), 'bakin-cli-identity-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const runDir = join(root, 'run-workspaces', 'researcher', 'run-1')
mkdirSync(join(runDir, 'repo', 'src'), { recursive: true })
writeFileSync(join(runDir, '.bakin-run.json'), JSON.stringify({ version: 1, threadId: 'task:t1:d1', taskId: 't1', agentId: 'researcher', createdAt: '2026-10-18T00:00:00.000Z', status: 'running' }))
const plain = join(root, 'plain')
mkdirSync(plain, { recursive: true })

const noProbe = async () => { throw new Error('probe must not run') }

describe('resolveCliIdentity', () => {
  it('--as human from a plain directory declares the operator', async () => {
    const identity = await resolveCliIdentity({ argv: ['doctor', '--fix', '--as=human'], cwd: plain, env: {}, probeWorkspace: async () => null })
    expect(identity).toEqual({ agentContext: null, operatorDeclared: true })
    expect(identityHeaders(identity)).toEqual({ 'X-Bakin-Operator': 'declared' })
  })

  it('the agent shell env marker wins over --as human, without asking the server', async () => {
    const identity = await resolveCliIdentity({ argv: ['--as', 'human'], cwd: plain, env: { BAKIN_AGENT_CONTEXT: 'researcher' }, probeWorkspace: noProbe })
    expect(identityHeaders(identity)).toEqual({ 'X-Bakin-Agent-Context': 'researcher' })
  })

  it('a run-dir sidecar above cwd (even deep in a worktree) is an agent context', async () => {
    const identity = await resolveCliIdentity({ argv: ['--as', 'human'], cwd: join(runDir, 'repo', 'src'), env: {}, probeWorkspace: noProbe })
    expect(identity.agentContext).toBe('researcher')
  })

  it('the workspace check runs only for --as human, and its answer overrides the declaration', async () => {
    const asked: string[] = []
    const probe = async (cwd: string) => { asked.push(cwd); return 'writer' }
    expect((await resolveCliIdentity({ argv: ['tasks', 'list'], cwd: plain, env: {}, probeWorkspace: probe })).agentContext).toBeNull()
    expect(asked).toEqual([])
    const identity = await resolveCliIdentity({ argv: ['--as', 'human'], cwd: plain, env: {}, probeWorkspace: probe })
    expect(identityHeaders(identity)).toEqual({ 'X-Bakin-Agent-Context': 'writer' })
  })

  it('an unreachable workspace check never blocks the operator', async () => {
    const identity = await resolveCliIdentity({ argv: ['--as', 'human'], cwd: plain, env: {}, probeWorkspace: async () => { throw new Error('down') } })
    expect(identity).toEqual({ agentContext: null, operatorDeclared: true })
  })

  it('no flag and no context sends nothing', async () => {
    expect(identityHeaders(await resolveCliIdentity({ argv: ['doctor'], cwd: plain, env: {}, probeWorkspace: noProbe }))).toEqual({})
  })
})
