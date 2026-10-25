/**
 * Self-healing PR1 slice 1.3d (git): `git-release-worktree` — a tracked TASK
 * worktree that is gone from disk is released from the registry by the same
 * release verb agents use, forced (re-homing row 194). A terminal-session
 * worktree stays the operator's decision.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-git-actions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import type { PluginContextLite } from '@bakin/core/routing'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { checkWorktrees, gitReleaseWorktreeRepair } from '../../../plugins/git'
import { expectRepairContract, runRepairContract, stampPlanItems } from '../../helpers/repair-contract'

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id, repoPath: '/tmp/repo', worktreePath: `/tmp/definitely-not-a-bakin-worktree-${id}`, branch: `feat/${id}`, baseRef: 'main',
  taskId: `task-${id}`, agent: 'main', state: 'active', createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z', ...over,
})
function gitContext(initial: unknown): { ctx: PluginContextLite; registry: () => { worktrees: Array<Record<string, unknown>> }; activity: string[] } {
  let stored = JSON.stringify(initial)
  const activity: string[] = []
  const ctx = {
    storage: { read: () => stored, write: (_path: string, text: string) => { stored = text } },
    activity: { log: (_agent: string, message: string) => { activity.push(message) } },
  } as unknown as PluginContextLite
  return { ctx, registry: () => JSON.parse(stored) as { worktrees: Array<Record<string, unknown>> }, activity }
}
function observed(result: Awaited<ReturnType<typeof checkWorktrees>>) {
  if (result.outcome !== 'observed') throw new Error(result.outcome)
  return result.observations
}
const all = { type: 'all_actionable' as const, reportId: 'r' }

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }) })

describe('git-release-worktree', () => {
  it('a missing TASK worktree points at the repair; a missing terminal-session worktree is the operator\'s decision in Terminal', async () => {
    const { ctx } = gitContext({ version: 1, worktrees: [entry('wt-1'), entry('wt-2', { taskId: undefined, sessionId: 'sess-9' })] })
    const rows = observed(await checkWorktrees(ctx))
    expect(rows.find((r) => r.key === 'missing.wt-1')?.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'git-release-worktree' })
    expect(rows.find((r) => r.key === 'missing.wt-2')?.incident).toMatchObject({ declarationId: 'missing-session', resolution: { type: 'human', needs: 'decision', href: '/terminal/sess-9' } })
  })
  it('plans one safe item per missing task worktree (never a session one) and releases exactly those, forced', async () => {
    const { ctx, registry, activity } = gitContext({ version: 1, worktrees: [entry('wt-1'), entry('wt-2', { taskId: undefined, sessionId: 'sess-9' }), entry('wt-3')] })
    const action = gitReleaseWorktreeRepair(ctx)
    const plan = stampPlanItems(action, await action.plan(all))
    expect(plan.map((item) => item.localId)).toEqual(['wt-1', 'wt-3'])
    expect(plan[0]).toMatchObject({ actionId: 'git-release-worktree', mode: 'self-heal' })
    expect(plan[0]!.changes[0]).toMatchObject({ kind: 'file', action: 'delete' })
    const one = stampPlanItems(action, await action.plan({ type: 'incidents', reportId: 'r', ids: ['git.worktrees:missing.wt-3'] }))
    expect(one.map((item) => item.localId)).toEqual(['wt-3'])
    const run = await runRepairContract(action, one)
    expectRepairContract(action, run)
    expect(run.results[0]).toMatchObject({ itemId: 'git-release-worktree:wt-3', status: 'applied', affectedCheckIds: ['git.worktrees'] })
    const states = Object.fromEntries(registry().worktrees.map((w) => [w.id, w.state]))
    expect(states).toEqual({ 'wt-1': 'active', 'wt-2': 'active', 'wt-3': 'released' })
    expect(activity.some((m) => m.includes('task-wt-3'))).toBe(true)
  })
  it('plans nothing when every tracked worktree is present or released', async () => {
    const { ctx } = gitContext({ version: 1, worktrees: [entry('wt-1', { state: 'released' })] })
    expect(await gitReleaseWorktreeRepair(ctx).plan(all)).toEqual([])
  })
})
