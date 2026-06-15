/**
 * Tests for attached asset context in dispatch messages.
 *
 * Dispatch resolves a task's assets through the assets.listByTask hook
 * (versioned-asset layout; assets are opened by assetId). The block is
 * computed async at the call sites and passed into the synchronous
 * buildDispatchMessage as a precomputed string.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-assets-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))

mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock().mockReturnValue({
    dispatch: { intervalMs: 1000, maxRetries: 3, failureCooldownMs: 60000, transientCooldownMs: 5000, maxDispatched: 500 },
    agents: ['main', 'pixel'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
  }),
}))

mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))

const hookInvoke = mock(async (..._args: unknown[]): Promise<unknown> => undefined)
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: hookInvoke,
    has: mock().mockReturnValue(true),
    register: mock(),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: hookInvoke,
    has: mock().mockReturnValue(true),
    register: mock(),
  }),
}))
mock.module('../../src/lib/format', () => ({ isStale: mock().mockReturnValue(true) }))

import { buildDispatchMessage, buildDispatchAssetBlock } from '../../src/core/dispatch'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('buildDispatchAssetBlock', () => {
  it('builds an assetId-based block from the assets.listByTask hook', async () => {
    hookInvoke.mockResolvedValueOnce([
      { assetId: '2026-04-reference-aaaa1111', description: 'Reference image', type: 'images' },
      { assetId: '2026-04-brief-bbbb2222', description: 'Creative brief', type: 'text' },
    ])

    const block = await buildDispatchAssetBlock('task-1')
    expect(hookInvoke).toHaveBeenCalledWith('assets.listByTask', { taskId: 'task-1' })
    expect(block).toContain('## Attached Assets')
    expect(block).toContain('2 linked asset(s)')
    expect(block).toContain('2026-04-reference-aaaa1111')
    expect(block).toContain('Reference image')
    expect(block).toContain('2026-04-brief-bbbb2222')
    // Versioned layout: assets are opened by assetId.
    expect(block).toContain('bakin_exec_assets_open')
    expect(block).toContain('assetId')
  })

  it('returns an empty string when the task has no assets', async () => {
    hookInvoke.mockResolvedValueOnce([])
    expect(await buildDispatchAssetBlock('task-none')).toBe('')
  })

  it('returns an empty string when the hook is unavailable/throws', async () => {
    hookInvoke.mockRejectedValueOnce(new Error('assets plugin not activated'))
    expect(await buildDispatchAssetBlock('task-err')).toBe('')
  })
})

describe('buildDispatchMessage — precomputed assets block', () => {
  const assetsBlock = '\n\n## Attached Assets\nThis task has 1 linked asset(s):\n- 2026-04-reference-aaaa1111 — Reference image\nOpen with bakin_exec_assets_open assetId=...'

  it('includes the block for agent-assigned tasks', () => {
    const task = { id: 'task-1', title: 'Design banner', agent: 'pixel' }
    const msg = buildDispatchMessage(task, 'pixel', testDir, 'main', '', {}, undefined, [], assetsBlock)
    expect(msg).toContain('## Attached Assets')
    expect(msg).toContain('2026-04-reference-aaaa1111')
  })

  it('includes the block in triage messages (no agent)', () => {
    const task = { id: 'task-1', title: 'Triage with asset' }
    const msg = buildDispatchMessage(task, 'main', testDir, 'main', '', {}, undefined, [], assetsBlock)
    expect(msg).toContain('## Attached Assets')
  })

  it('includes the block for main-assigned tasks', () => {
    const task = { id: 'task-1', title: 'My task', agent: 'main' }
    const msg = buildDispatchMessage(task, 'main', testDir, 'main', '', {}, undefined, [], assetsBlock)
    expect(msg).toContain('## Attached Assets')
  })

  it('omits the block when none is provided', () => {
    const task = { id: 'task-no-assets', title: 'Simple task', agent: 'pixel' }
    const msg = buildDispatchMessage(task, 'pixel', testDir)
    expect(msg).not.toContain('## Attached Assets')
  })

  it('can include retrieved package lessons in dispatch messages', () => {
    const task = { id: 'task-lessons', title: 'Use package lessons', agent: 'pixel' }
    const msg = buildDispatchMessage(
      task,
      'pixel',
      testDir,
      'main',
      '## Relevant Package Lessons\n\nSelected lesson body.',
    )
    expect(msg).toContain('## Relevant Package Lessons')
    expect(msg).toContain('Selected lesson body.')
    expect(msg).toContain('## PROGRESS LOGGING')
  })
})
