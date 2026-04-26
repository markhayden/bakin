/**
 * Schedule-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C4). Absorbs the prior
 * tests/core/doctor-schedule.test.ts content. Exercises checkScheduleSync
 * directly against fixture jobs.json + sidecar.json files in a temp
 * dir, rather than going through runDiagnostics — the orchestration
 * path is exercised separately by tests/core/doctor.test.ts.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-schedule-health-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = openClawDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

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
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
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

const cronJobsPath = join(openClawDir, 'cron', 'jobs.json')
const sidecarPath = join(testDir, 'schedule', 'sidecar.json')

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mkdirSync(openClawDir, { recursive: true })
  mkdirSync(join(openClawDir, 'cron'), { recursive: true })
  mkdirSync(join(testDir, 'schedule'), { recursive: true })
  mockAutoFix = false
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ─── Fresh-install / no jobs ───────────────────────────────────────────────

describe('checkScheduleSync — no jobs', () => {
  it('reports ok when no OpenClaw cron jobs file exists (fresh install)', () => {
    const results = checkScheduleSync(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('schedule-sync')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/fresh install/)
  })

  it('reports ok when the jobs file exists but is empty', () => {
    writeFileSync(cronJobsPath, JSON.stringify({ version: 1, jobs: [] }))
    const results = checkScheduleSync(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No OpenClaw cron jobs to sync/)
  })
})

// ─── Tracked / orphan detection ───────────────────────────────────────────

describe('checkScheduleSync — orphan detection', () => {
  it('reports ok when all OpenClaw jobs are tracked in the sidecar', () => {
    writeFileSync(cronJobsPath, JSON.stringify({
      version: 1,
      jobs: [{ id: 'job-1', name: 'daily-recipe' }],
    }))
    writeFileSync(sidecarPath, JSON.stringify({
      version: 1,
      jobs: {
        'job-1': {
          jobId: 'job-1',
          isBakinJob: true,
          displayName: 'Daily Recipe',
          agentId: 'basil',
          createdAt: '2026-03-28T00:00:00Z',
          updatedAt: '2026-03-28T00:00:00Z',
        },
      },
    }))

    const results = checkScheduleSync(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/1 cron job\(s\), all tracked/)
  })

  it('warns about orphaned cron jobs (no autoFix)', () => {
    writeFileSync(cronJobsPath, JSON.stringify({
      version: 1,
      jobs: [{ id: 'orphan-1', name: 'rogue-cron' }],
    }))
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = checkScheduleSync(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/Orphan cron job "rogue-cron"/)
  })
})

// ─── Auto-adopt under autoFix ─────────────────────────────────────────────

describe('checkScheduleSync — auto-adopt', () => {
  it('auto-adopts orphaned cron jobs into the sidecar without guessing the agent', () => {
    mockAutoFix = true
    writeFileSync(cronJobsPath, JSON.stringify({
      version: 1,
      jobs: [{ id: 'orphan-1', name: 'rogue-cron' }],
    }))
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = checkScheduleSync(testDir)
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

  it('creates schedule/ directory when sidecar parent is missing', () => {
    mockAutoFix = true
    rmSync(join(testDir, 'schedule'), { recursive: true, force: true })
    expect(existsSync(join(testDir, 'schedule'))).toBe(false)

    writeFileSync(cronJobsPath, JSON.stringify({
      version: 1,
      jobs: [{ id: 'orphan-1', name: 'rogue-cron' }],
    }))

    checkScheduleSync(testDir)
    expect(existsSync(sidecarPath)).toBe(true)
  })
})

// ─── Custom jobs.json path via OpenClaw config.json ───────────────────────

describe('checkScheduleSync — config-overridden jobs path', () => {
  it('honors `cron.store` override from openclaw.config.json', () => {
    const customJobsPath = join(openClawDir, 'custom', 'jobs.json')
    mkdirSync(join(openClawDir, 'custom'), { recursive: true })
    writeFileSync(customJobsPath, JSON.stringify({
      version: 1,
      jobs: [{ id: 'cust-1', name: 'custom-cron' }],
    }))
    writeFileSync(
      join(openClawDir, 'config.json'),
      JSON.stringify({ cron: { store: customJobsPath } }),
    )
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const results = checkScheduleSync(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/custom-cron/)
  })
})

// ─── Malformed jobs file ──────────────────────────────────────────────────

describe('checkScheduleSync — malformed input', () => {
  it('warns when the jobs file cannot be parsed', () => {
    writeFileSync(cronJobsPath, '{not json')
    const results = checkScheduleSync(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/Failed to read OpenClaw jobs/)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers the schedule-sync health check on activate', async () => {
    const schedulePlugin = (await import('../../../plugins/schedule')).default
    const registeredIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'schedule',
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
