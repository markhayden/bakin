import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = (() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const home = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclaw = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = home
  process.env.OPENCLAW_HOME = openclaw
  return { home, openclaw }
})()

mock.module('@bakin/core/openclaw-home', async () => {
  const { join } = require('path')
  const resolve = () => process.env.OPENCLAW_HOME || testHome.openclaw
  return {
    getOpenClawHome: () => resolve(),
    getOpenClawPath: (...segments: string[]) => join(resolve(), ...segments),
    resetOpenClawHome: () => {},
  }
})

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testHome.home,
  getBakinPaths: () => ({
    home: testHome.home,
    memoryLog: join(testHome.home, 'MEMORY-LOG.md'),
    messaging: join(testHome.home, 'messaging.json'),
    audit: join(testHome.home, 'audit.jsonl'),
    assets: join(testHome.home, 'assets'),
    'assets.store': join(testHome.home, 'assets', 'store'),
    'assets.inbox': join(testHome.home, 'assets', 'inbox'),
    'assets.trash': join(testHome.home, 'assets', '.trash'),
    agents: join(testHome.home, 'agents'),
    personas: join(testHome.home, 'team', 'personas'),
    team: join(testHome.home, 'team'),
    heartbeats: join(testHome.home, 'heartbeats'),
    inbox: join(testHome.home, 'inbox'),
    projects: join(testHome.home, 'projects'),
    workflows: join(testHome.home, 'workflows'),
    settings: join(testHome.home, 'settings.json'),
    logs: join(testHome.home, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

// Mock settings
mock.module('@/core/settings', () => ({
  getSettings: mock(() => ({
    agents: ['main', 'patch', 'pixel'],
    antfly: { enabled: false },
    doctor: { intervalMs: 1800000, autoFixSkill: false },
    openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
    service: { enabled: false },
  })),
}))

// Mock openclaw-client
mock.module('@/core/openclaw-client', () => ({
  ping: mock(async () => false),
  sendMessage: mock(),
}))

// Mock audit
mock.module('@/core/audit', () => ({
  appendAudit: mock(),
}))

// Mock taskboard (flow-store)
mock.module('../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: mock(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], archived: [], blocked: [] },
  })),
  clearDependency: mock(),
}))

// Mock mcporter
mock.module('@/core/mcporter', () => ({
  isMcporterInstalled: mock(() => true),
  installMcporter: mock(() => true),
  verifyConfig: mock(() => ({
    installed: true,
    configExists: true,
    agentEntries: [],
    staleEntries: [],
  })),
  syncConfig: mock(() => []),
}))

describe('doctor: schedule sync', () => {
  let tempDir: string
  let contentDir: string
  let openclawDir: string
  let cronJobsPath: string
  let sidecarPath: string
  let originalOpenClawHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-sched-'))
    contentDir = join(tempDir, 'content')
    openclawDir = join(tempDir, '.openclaw')

    // Set up content dir structure
    mkdirSync(join(contentDir, 'team', 'personas'), { recursive: true })
    mkdirSync(join(contentDir, 'schedule'), { recursive: true })

    // Set up OpenClaw cron dir inside our temp home
    mkdirSync(join(openclawDir, 'cron'), { recursive: true })
    cronJobsPath = join(openclawDir, 'cron', 'jobs.json')
    sidecarPath = join(contentDir, 'schedule', 'sidecar.json')

    // Point OPENCLAW_HOME at our temp dir so getOpenClawHome() reads from here.
    // getOpenClawHome() is uncached — each call reads process.env, so this
    // override takes effect for the imports in each `it()` block.
    originalOpenClawHome = process.env.OPENCLAW_HOME
    process.env.OPENCLAW_HOME = openclawDir
  })

  afterEach(() => {
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('should report ok when no OpenClaw cron jobs file exists', async () => {
    // Mock content-dir to our temp
    mock.module('@/core/content-dir', () => ({
      isUsingBakinHome: mock(() => true),
      getContentDir: mock(() => contentDir),
    }))

    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const schedResults = results.filter(r => r.check === 'schedule-sync')

    expect(schedResults.length).toBe(1)
    expect(schedResults[0]!.status).toBe('ok')
    expect(schedResults[0]!.message).toContain('fresh install')
  })

  it('should report ok when all jobs are tracked in sidecar', async () => {
    mock.module('@/core/content-dir', () => ({
      isUsingBakinHome: mock(() => true),
      getContentDir: mock(() => contentDir),
    }))

    // Create OpenClaw jobs file
    const ocJobsPath = join(tempDir, '.openclaw', 'cron', 'jobs.json')
    writeFileSync(ocJobsPath, JSON.stringify({
      version: 1,
      jobs: [
        { id: 'job-1', name: 'daily-recipe', schedule: { kind: 'cron', expr: '0 9 * * *' }, enabled: true },
      ],
    }))

    // Create matching sidecar entry
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

    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const schedResults = results.filter(r => r.check === 'schedule-sync')

    expect(schedResults.length).toBe(1)
    expect(schedResults[0]!.status).toBe('ok')
    expect(schedResults[0]!.message).toContain('1 cron job(s), all tracked')
  })

  it('should detect orphaned cron jobs (no autoFix)', async () => {
    mock.module('@/core/content-dir', () => ({
      isUsingBakinHome: mock(() => true),
      getContentDir: mock(() => contentDir),
    }))

    // Create OpenClaw jobs file with an orphan
    const ocJobsPath = join(tempDir, '.openclaw', 'cron', 'jobs.json')
    writeFileSync(ocJobsPath, JSON.stringify({
      version: 1,
      jobs: [
        { id: 'orphan-1', name: 'rogue-cron', schedule: { kind: 'cron', expr: '0 10 * * *' }, enabled: true },
      ],
    }))

    // Empty sidecar
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const schedResults = results.filter(r => r.check === 'schedule-sync')

    expect(schedResults.length).toBe(1)
    expect(schedResults[0]!.status).toBe('warn')
    expect(schedResults[0]!.message).toContain('Orphan cron job')
    expect(schedResults[0]!.message).toContain('rogue-cron')
  })

  it('should auto-adopt orphaned cron jobs when autoFix is enabled', async () => {
    mock.module('@/core/content-dir', () => ({
      isUsingBakinHome: mock(() => true),
      getContentDir: mock(() => contentDir),
    }))

    mock.module('@/core/settings', () => ({
      getSettings: mock(() => ({
        agents: ['main', 'patch', 'pixel'],
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: true }, // autoFix enabled
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })),
    }))

    // Create OpenClaw jobs file with an orphan
    const ocJobsPath = join(tempDir, '.openclaw', 'cron', 'jobs.json')
    writeFileSync(ocJobsPath, JSON.stringify({
      version: 1,
      jobs: [
        { id: 'orphan-1', name: 'rogue-cron', schedule: { kind: 'cron', expr: '0 10 * * *' }, enabled: true },
      ],
    }))

    // Empty sidecar
    writeFileSync(sidecarPath, JSON.stringify({ version: 1, jobs: {} }))

    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const schedResults = results.filter(r => r.check === 'schedule-sync')

    expect(schedResults.length).toBe(1)
    expect(schedResults[0]!.status).toBe('fixed')
    expect(schedResults[0]!.message).toContain('Auto-adopted')

    // Verify sidecar was updated
    const updatedSidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
    expect(updatedSidecar.jobs['orphan-1']).toBeDefined()
    expect(updatedSidecar.jobs['orphan-1'].isBakinJob).toBe(false)
    expect(updatedSidecar.jobs['orphan-1'].requireTriage).toBe(true)
    expect(updatedSidecar.jobs['orphan-1'].displayName).toBe('rogue-cron')
    // Agent should NOT be guessed
    expect(updatedSidecar.jobs['orphan-1'].agentId).toBeUndefined()
  })
})
