/**
 * Tests for attached asset context in dispatch messages.
 * Assets are detected by scanning filesystem directories, not description URLs.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-assets-${Date.now()}`)

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ assets: join(testDir, 'assets') }),
}))

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/settings', () => ({
  getSettings: vi.fn().mockReturnValue({
    dispatch: { intervalMs: 1000, maxRetries: 3, failureCooldownMs: 60000, maxDispatched: 500 },
    agents: ['main', 'pixel'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
  }),
}))

vi.mock('../../src/core/audit', () => ({ appendAudit: vi.fn() }))
vi.mock('../../src/core/openclaw-client', () => ({ sendMessage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../src/lib/taskboard', () => ({
  getTodoTasks: vi.fn().mockReturnValue({ todoTasks: [] }),
  moveTaskToInProgress: vi.fn(),
  addTaskLog: vi.fn(),
}))
vi.mock('../../src/lib/plugin-registry', () => ({
  getHookRegistry: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
  }),
}))
vi.mock('../../src/lib/format', () => ({ isStale: vi.fn().mockReturnValue(true) }))

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
})
