/**
 * Re-homing table rows 194–195 (git.worktrees): a missing TASK worktree is
 * the self-heal release; a missing terminal-session worktree is the
 * operator's decision in Terminal; an unreadable registry is an observation.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-git-rehoming-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { describe, expect, it, mock } from 'bun:test'
import type { PluginContextLite } from '@bakin/core/routing'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

import { GIT_WORKTREES_INCIDENTS, checkWorktrees, gitReleaseWorktreeRepair } from '../../../plugins/git'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import { stampPlanItems } from '../../helpers/repair-contract'

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id, repoPath: '/tmp/repo', worktreePath: `/tmp/definitely-not-a-bakin-worktree-${id}`, branch: `feat/${id}`, baseRef: 'main',
  taskId: `task-${id}`, agent: 'main', state: 'active', createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z', ...over,
})
const ctx = (initial: unknown): PluginContextLite => ({ storage: { read: () => (typeof initial === 'string' ? initial : JSON.stringify(initial)), write: () => {} }, activity: { log: () => {} } } as unknown as PluginContextLite)
async function rows(initial: unknown) {
  const parsed = parseHealthCheckRunInput(await checkWorktrees(ctx(initial)))
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

describe('git re-homing', () => {
  it('catalog: 194 split into the task repair and the session decision; 195 is not a family', () => {
    expect(GIT_WORKTREES_INCIDENTS).toEqual([
      { id: 'missing', subjectKind: 'task', resolution: { type: 'repair', actionId: 'git-release-worktree' }, required: 'always' },
      { id: 'missing-session', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
    ])
    expect(gitReleaseWorktreeRepair(ctx(null)).effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
  })
  it('row 194: task variant → self-heal repair; session variant → decision in Terminal', async () => {
    const found = await rows({ version: 1, worktrees: [entry('wt-1'), entry('wt-2', { taskId: undefined, sessionId: 'sess-9' })] })
    expect(found.find((r) => r.key === 'missing.wt-1')!.incident).toMatchObject({ declarationId: 'missing', subject: { kind: 'task', id: 'task-wt-1' }, resolution: { type: 'repair', actionId: 'git-release-worktree' } })
    expect(found.find((r) => r.key === 'missing.wt-2')!.incident).toMatchObject({ declarationId: 'missing-session', subject: { kind: 'record', id: 'terminal/sess-9' }, resolution: { type: 'human', needs: 'decision', href: '/terminal/sess-9' } })
    const action = gitReleaseWorktreeRepair(ctx({ version: 1, worktrees: [entry('wt-1')] }))
    expect(stampPlanItems(action, await action.plan({ type: 'all_actionable', reportId: 'r' }))[0]!.mode).toBe('self-heal')
  })
  it('row 195: an unreadable registry is an observation', async () => {
    const [row] = await rows('{not-json')
    expect(row!.status).toBe('warning')
    expect(row!.incident).toBeUndefined()
  })
})
