/**
 * Tests for attached asset context in dispatch messages.
 * Assets are detected by scanning filesystem directories, not description URLs.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-assets-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
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
  getSettings: mock().mockReturnValue({
    dispatch: { intervalMs: 1000, maxRetries: 3, failureCooldownMs: 60000, transientCooldownMs: 5000, maxDispatched: 500 },
    agents: ['main', 'pixel'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
  }),
}))

mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('../../src/lib/format', () => ({ isStale: mock().mockReturnValue(true) }))

import { buildDispatchMessage } from '../../src/core/dispatch'

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })

  // Under filename-as-identity, every asset lives under
  // assets/store/{YYYY-MM}/ and the task link lives only in the sidecar.
  const shardDir = join(testDir, 'assets', 'store', '2026-04')
  mkdirSync(shardDir, { recursive: true })

  const img = '20260404-reference-aaaa1111.png'
  writeFileSync(join(shardDir, img), 'fake-png')
  writeFileSync(join(shardDir, `${img}.meta.json`), JSON.stringify({ taskId: 'task-1', type: 'images' }))

  // Variant — shares the primary's base stem but has its own sidecar.
  // dispatch.ts filters these out explicitly.
  writeFileSync(join(shardDir, '20260404-reference-aaaa1111.thumb.jpg'), 'fake-thumb')
  writeFileSync(join(shardDir, '20260404-reference-aaaa1111.thumb.jpg.meta.json'), JSON.stringify({ taskId: 'task-1', type: 'images' }))

  const brief = '20260404-brief-bbbb2222.md'
  writeFileSync(join(shardDir, brief), '# Brief')
  writeFileSync(join(shardDir, `${brief}.meta.json`), JSON.stringify({ taskId: 'task-1', type: 'text' }))
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('buildDispatchMessage — attached assets', () => {
  it('includes attached assets when task has linked files', () => {
    const task = {
      id: 'task-1',
      title: 'Design banner',
      agent: 'pixel',
      description: 'Create a banner based on the reference images.',
    }
    const msg = buildDispatchMessage(task, 'pixel', testDir, 3737)
    expect(msg).toContain('## Attached Assets')
    expect(msg).toContain('20260404-reference-aaaa1111.png')
    expect(msg).toContain('20260404-brief-bbbb2222.md')
    // Agents open attached assets via bakin_exec_assets_open (filename-as-identity).
    expect(msg).toContain('bakin_exec_assets_open')
    // Should NOT include variants
    expect(msg).not.toContain('.thumb.')
    // Should NOT include .meta.json files
    expect(msg).not.toContain('.meta.json')
  })

  it('shows correct asset count', () => {
    const task = { id: 'task-1', title: 'Test', agent: 'pixel' }
    const msg = buildDispatchMessage(task, 'pixel', testDir, 3737)
    expect(msg).toContain('2 linked asset(s)')
  })

  it('omits attached assets when task has no asset directories', () => {
    const task = {
      id: 'task-no-assets',
      title: 'Simple task',
      agent: 'pixel',
      description: 'No assets here.',
    }
    const msg = buildDispatchMessage(task, 'pixel', testDir, 3737)
    expect(msg).not.toContain('## Attached Assets')
  })

  it('includes attached assets in triage messages (no agent)', () => {
    const task = {
      id: 'task-1',
      title: 'Triage with asset',
      description: 'Look at the attached files.',
    }
    const msg = buildDispatchMessage(task, 'main', testDir, 3737)
    expect(msg).toContain('## Attached Assets')
  })

  it('includes attached assets for main-assigned tasks', () => {
    const task = {
      id: 'task-1',
      title: 'My task',
      agent: 'main',
    }
    const msg = buildDispatchMessage(task, 'main', testDir, 3737)
    expect(msg).toContain('## Attached Assets')
  })

  it('can include retrieved package lessons in dispatch messages', () => {
    const task = {
      id: 'task-lessons',
      title: 'Use package lessons',
      agent: 'pixel',
    }
    const msg = buildDispatchMessage(
      task,
      'pixel',
      testDir,
      3737,
      'main',
      '## Relevant Package Lessons\n\nSelected lesson body.',
    )
    expect(msg).toContain('## Relevant Package Lessons')
    expect(msg).toContain('Selected lesson body.')
    expect(msg).toContain('## PROGRESS LOGGING')
  })
})
