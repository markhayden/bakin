/**
 * Schedule-plugin-owned doctor check.
 *
 * Exercises checkScheduleSync directly against runtime cron fixtures plus
 * sidecar.json files in a temp dir, rather than going through runDiagnostics.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-schedule-health-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CronJob } from '@bakin/core/adapters/runtime'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))

let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { autoFixSkill: mockAutoFix } }),
  resetSettingsCache: () => {},
}))

mock.module('../../../src/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { checkScheduleSync } from '../../../plugins/schedule/lib/health-checks'

const sidecarPath = join(testDir, 'schedule', 'sidecar.json')
let runtimeJobs: CronJob[] = []
let runtimeError: Error | null = null

const cronReader = {
  list: async () => {
    if (runtimeError) throw runtimeError
    return runtimeJobs
  },
}

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'job-1',
    name: 'daily-recipe',
    schedule: '0 9 * * *',
    command: 'bakin:schedule:daily-recipe',
    enabled: true,
    ...overrides,
  }
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'schedule'), { recursive: true })
  mockAutoFix = false
  runtimeJobs = []
  runtimeError = null
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('checkScheduleSync - no jobs', () => {
  it('reports ok when the runtime has no cron jobs', async () => {
    const results = await checkScheduleSync(testDir, cronReader)
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('schedule-sync')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No runtime cron jobs/)
  })
})

describe('checkScheduleSync - orphan detection', () => {
  it('reports ok when all runtime jobs are tracked in the sidecar', async () => {
    runtimeJobs = [makeCronJob({ id: 'job-1', name: 'daily-recipe' })]
    writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      jobs: {
        'job-1': {
          jobId: 'job-1',
          isBakinJob: true,
          displayName: 'Daily Recipe',
          agentId: 'chef',
          createdAt: '2026-03-28T00:00:00Z',
          updatedAt: '2026-03-28T00:00:00Z',
        },
      },
    }))

    const results = await checkScheduleSync(testDir, cronReader)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/1 cron job\(s\), all tracked/)
  })

  it('warns about orphaned runtime cron jobs without autoFix', async () => {
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = await checkScheduleSync(testDir, cronReader)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/Orphan runtime cron job "rogue-cron"/)
  })
})

describe('checkScheduleSync - auto-adopt', () => {
  it('auto-adopts orphaned runtime cron jobs into the sidecar without guessing the agent', async () => {
    mockAutoFix = true
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = await checkScheduleSync(testDir, cronReader)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('fixed')
    expect(results[0].message).toMatch(/Auto-adopted/)

    const updated = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updated.jobs['orphan-1']).toBeDefined()
    expect(updated.jobs['orphan-1'].isBakinJob).toBe(false)
    expect(updated.jobs['orphan-1'].requireTriage).toBe(true)
    expect(updated.jobs['orphan-1'].displayName).toBe('rogue-cron')
    expect(updated.jobs['orphan-1'].agentId).toBeUndefined()
  })

  it('creates schedule/ directory when sidecar parent is missing', async () => {
    mockAutoFix = true
    runtimeJobs = [makeCronJob({ id: 'orphan-1', name: 'rogue-cron' })]
    rmSync(join(testDir, 'schedule'), { recursive: true, force: true })
    expect(existsSync(join(testDir, 'schedule'))).toBe(false)

    await checkScheduleSync(testDir, cronReader)
    expect(existsSync(sidecarPath)).toBe(true)
  })
})

describe('checkScheduleSync - runtime failures', () => {
  it('warns when the runtime cron adapter cannot list jobs', async () => {
    runtimeError = new Error('adapter unavailable')
    const results = await checkScheduleSync(testDir, cronReader)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/Failed to read runtime cron jobs/)
  })
})

describe('plugin registration', () => {
  it('registers the schedule-sync health check on activate', async () => {
    const schedulePlugin = (await import('../../../plugins/schedule')).default
    const registeredIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'schedule',
      runtime: { cron: { list: mock(async () => []) } },
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `schedule.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await schedulePlugin.activate(ctx as unknown as Parameters<typeof schedulePlugin.activate>[0])

    expect(registeredIds).toContain('schedule-sync')
  })
})
