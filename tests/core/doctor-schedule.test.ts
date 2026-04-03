import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock settings
vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    agents: ['roscoe', 'patch', 'pixel'],
    antfly: { enabled: false },
    doctor: { intervalMs: 1800000, autoFixSkill: false },
    openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
    service: { enabled: false },
  })),
}))

// Mock openclaw-client
vi.mock('@/core/openclaw-client', () => ({
  ping: vi.fn(async () => false),
  sendMessage: vi.fn(),
}))

// Mock audit
vi.mock('@/core/audit', () => ({
  appendAudit: vi.fn(),
}))

// Mock taskboard
vi.mock('../../plugins/tasks/taskboard', () => ({
  readTaskboard: vi.fn(() => ({
    columns: { backlog: [], inProgress: [], todo: [], review: [], done: [], confirmed: [], blocked: [] },
  })),
  clearDependency: vi.fn(),
}))

// Mock mcporter
vi.mock('@/core/mcporter', () => ({
  isMcporterInstalled: vi.fn(() => true),
  installMcporter: vi.fn(() => true),
  verifyConfig: vi.fn(() => ({
    installed: true,
    configExists: true,
    agentEntries: [],
    staleEntries: [],
  })),
  syncConfig: vi.fn(() => []),
}))

describe('doctor: schedule sync', () => {
  let tempDir: string
  let contentDir: string
  let openclawDir: string
  let cronJobsPath: string
  let sidecarPath: string
  let originalHome: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-sched-'))
    contentDir = join(tempDir, 'content')
    openclawDir = join(tempDir, 'openclaw')

    // Set up content dir structure
    mkdirSync(join(contentDir, 'team', 'personas'), { recursive: true })
    mkdirSync(join(contentDir, 'schedule'), { recursive: true })

    // Set up OpenClaw cron dir
    mkdirSync(join(openclawDir, 'cron'), { recursive: true })
    cronJobsPath = join(openclawDir, 'cron', 'jobs.json')
    sidecarPath = join(contentDir, 'schedule', 'sidecar.json')

    // Override HOME so checkScheduleSync reads from our temp dir
    originalHome = process.env.HOME
    process.env.HOME = tempDir

    // Create .openclaw dir structure at the fake HOME
    mkdirSync(join(tempDir, '.openclaw', 'cron'), { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = originalHome
    rmSync(tempDir, { recursive: true, force: true })
    vi.resetModules()
  })

  it('should report ok when no OpenClaw cron jobs file exists', async () => {
    // Mock content-dir to our temp
    vi.doMock('@/core/content-dir', () => ({
      isUsingBakinHome: vi.fn(() => true),
      getContentDir: vi.fn(() => contentDir),
    }))

    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const schedResults = results.filter(r => r.check === 'schedule-sync')

    expect(schedResults.length).toBe(1)
    expect(schedResults[0]!.status).toBe('ok')
    expect(schedResults[0]!.message).toContain('fresh install')
  })

  it('should report ok when all jobs are tracked in sidecar', async () => {
    vi.doMock('@/core/content-dir', () => ({
      isUsingBakinHome: vi.fn(() => true),
      getContentDir: vi.fn(() => contentDir),
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
          agentId: 'basil',
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
    vi.doMock('@/core/content-dir', () => ({
      isUsingBakinHome: vi.fn(() => true),
      getContentDir: vi.fn(() => contentDir),
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
    vi.doMock('@/core/content-dir', () => ({
      isUsingBakinHome: vi.fn(() => true),
      getContentDir: vi.fn(() => contentDir),
    }))

    vi.doMock('@/core/settings', () => ({
      getSettings: vi.fn(() => ({
        agents: ['roscoe', 'patch', 'pixel'],
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
