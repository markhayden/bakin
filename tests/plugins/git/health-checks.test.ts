import { describe, expect, it } from 'bun:test'
import type { PluginContextLite } from '@bakin/core/routing'
import { checkWorktrees } from '../../../plugins/git'

function gitContext(registry: string | null): PluginContextLite {
  return {
    storage: { read: () => registry },
  } as unknown as PluginContextLite
}

function observations(result: Awaited<ReturnType<typeof checkWorktrees>>) {
  if (result.outcome !== 'observed') throw new Error(`Expected observed Git health, got ${result.outcome}`)
  return result.observations
}

describe('Git worktree health check', () => {
  it('reports a healthy empty registry', async () => {
    const result = observations(await checkWorktrees(gitContext(null)))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ key: 'registry', status: 'healthy' })
  })

  it('reports unreadable registry state as a watch incident', async () => {
    const result = observations(await checkWorktrees(gitContext('{not-json')))

    expect(result[0]).toMatchObject({
      key: 'registry-read',
      status: 'warning',
      incident: { disposition: 'watch', resolution: { type: 'rerun' } },
    })
  })

  it('makes a missing active worktree actionable', async () => {
    const registry = JSON.stringify({
      version: 1,
      worktrees: [{
        id: 'wt-1',
        repoPath: '/tmp/repo',
        worktreePath: '/tmp/definitely-not-a-bakin-worktree',
        branch: 'feat/health',
        baseRef: 'main',
        taskId: 'task-1',
        agent: 'main',
        state: 'active',
        createdAt: '2026-07-12T00:00:00.000Z',
        updatedAt: '2026-07-12T00:00:00.000Z',
      }],
    })
    const result = observations(await checkWorktrees(gitContext(registry)))

    expect(result[0]).toMatchObject({
      key: 'missing.wt-1',
      status: 'warning',
      incident: {
        disposition: 'action_required',
        resources: expect.arrayContaining([{ kind: 'task', id: 'task-1', label: 'task-1' }]),
        resolution: { type: 'instructions' },
      },
    })
  })
})
