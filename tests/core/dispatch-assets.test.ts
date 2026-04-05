/**
 * Tests for attached asset context in dispatch messages.
 * Assets are detected by scanning filesystem directories, not description URLs.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-dispatch-assets-${Date.now()}`)

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
    agents: ['roscoe', 'pixel'],
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

  // Create asset fixtures for task-1
  const imgDir = join(testDir, 'assets', 'images', 'task-1')
  mkdirSync(imgDir, { recursive: true })
  writeFileSync(join(imgDir, '20260404-reference.png'), 'fake-png')
  writeFileSync(join(imgDir, '20260404-reference.png.meta.json'), '{}')
  writeFileSync(join(imgDir, '20260404-reference.thumb.jpg'), 'fake-thumb') // variant, should be excluded

  const txtDir = join(testDir, 'assets', 'text', 'task-1')
  mkdirSync(txtDir, { recursive: true })
  writeFileSync(join(txtDir, '20260404-brief.md'), '# Brief')
  writeFileSync(join(txtDir, '20260404-brief.md.meta.json'), '{}')
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
    expect(msg).toContain('20260404-reference.png')
    expect(msg).toContain('20260404-brief.md')
    expect(msg).toContain('bakin_exec_assets_get')
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

  it('includes attached assets for roscoe-assigned tasks', () => {
    const task = {
      id: 'task-1',
      title: 'My task',
      agent: 'roscoe',
    }
    const msg = buildDispatchMessage(task, 'roscoe', testDir, 3737)
    expect(msg).toContain('## Attached Assets')
  })
})
