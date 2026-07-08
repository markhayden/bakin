import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
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
  resetSettingsCache: () => {},
  getSettings: mock(() => ({
    runtime: {
      adapter: 'openclaw',
      settings: {},
    },
    search: { adapter: 'antfly', settings: { enabled: false } },
    doctor: { intervalMs: 1800000 },
    service: { enabled: false },
  })),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testHome.openclaw,
  getOpenClawPath: (...parts: string[]) => [testHome.openclaw, ...parts].join('/'),
  resetOpenClawHome: () => {},
}))

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg' })
})
const mockRuntimeAgentsList = mock((...args: unknown[]) => {
  void args
  return Promise.resolve([
    { id: 'main', name: 'Main', status: 'active' },
  ])
})

const mockAppServices = {
  runtime: {
    agents: {
      list: (...args: unknown[]) => mockRuntimeAgentsList(...args),
    },
    messaging: {
      send: (...args: unknown[]) => mockRuntimeSend(...args),
    },
  },
}

mock.module('@/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services-store', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('../../src/core/app-services-store', () => ({
  getAppServices: () => mockAppServices,
}))

// Mock audit (avoid file writes in tests)
mock.module('@/core/audit', () => ({
  appendAudit: mock(),
}))

// Mock bun:sqlite so doctor checks don't touch real SQLite
mock.module('bun:sqlite', () => ({
  Database: mock(() => ({
    exec: mock(),
    prepare: mock(() => ({
      get: mock(() => ({ n: 0 })),
    })),
    close: mock(),
  })),
}))

// Mock onboarding state — controls the requireOnboard gate
let mockIsOnboarded = true
mock.module('@/core/onboarding/state', () => ({
  isOnboarded: () => mockIsOnboarded,
}))

// Mock plugin-assets onboarding component — controls drift status surfaced by doctor
const mockPluginAssetsCheck = mock()
mock.module('@/core/onboarding/plugin-assets', () => ({
  pluginAssetsComponent: {
    name: 'plugin-assets',
    check: mockPluginAssetsCheck,
    install: mock(),
  },
}))

// Mock mcporter (avoid install/config in tests)
mock.module('@/core/mcporter', () => ({
  isMcporterInstalled: mock(() => true),
  installMcporter: mock(() => true),
  verifyConfig: mock(() => ({
    installed: true,
    configExists: true,
    agentEntries: [
      { agent: 'main', name: 'bakin-main', url: 'http://localhost:3737/mcp?agent=main', correct: true },
      { agent: 'patch', name: 'bakin-patch', url: 'http://localhost:3737/mcp?agent=patch', correct: true },
      { agent: 'pixel', name: 'bakin-pixel', url: 'http://localhost:3737/mcp?agent=pixel', correct: true },
    ],
    staleEntries: [],
  })),
  syncConfig: mock(() => []),
}))

describe('doctor', () => {
  let tempDir: string
  let contentDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-test-'))
    contentDir = join(tempDir, 'content')
    mkdirSync(join(contentDir, 'team', 'personas'), { recursive: true })
    mockIsOnboarded = true // default: gate passes
    mockPluginAssetsCheck.mockReset()
    mockPluginAssetsCheck.mockResolvedValue({
      name: 'plugin-assets',
      status: 'ok',
      message: '0 plugin assets to install',
      details: { totalAvailable: 0 },
    })
    mockRuntimeSend.mockClear()
    mockRuntimeAgentsList.mockClear()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should export runDiagnostics', async () => {
    const doctor = await import('@/core/doctor')
    expect(typeof doctor.runDiagnostics).toBe('function')
  })

  it('aggregates registered plugin checks via runPluginHealthChecks', async () => {
    // Sanity check: when plugins ARE registered, runDiagnostics surfaces
    // their rows. Catches the regression "runPluginHealthChecks isn't being
    // awaited" — a class of bug invisible to the gate-only assertions below.
    const registry = await import('../../src/core/health-check-registry')
    registry.registerHealthCheck({
      runtime: 'plugin',
      pluginId: 'doctor-test',
      id: 'doctor-test.synthetic',
      name: 'Synthetic',
      run: async () => [{
        check: 'synthetic-row',
        status: 'ok',
        message: 'Synthetic row from registered test plugin',
        autoFixable: false,
      }],
    })
    try {
      const doctor = await import('@/core/doctor')
      const results = await doctor.runDiagnostics(contentDir, tempDir)
      expect(results.find(r => r.check === 'synthetic-row')).toBeDefined()
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    } finally {
      registry.unregisterHealthCheck('doctor-test.synthetic')
    }
  })

  it('does not notify the runtime main agent unless explicitly requested', async () => {
    const registry = await import('../../src/core/health-check-registry')
    registry.registerHealthCheck({
      runtime: 'plugin',
      pluginId: 'doctor-test',
      id: 'doctor-test.report-only',
      name: 'Report only',
      run: async () => [{
        check: 'report-only-row',
        status: 'error',
        message: 'Needs operator attention',
        autoFixable: false,
      }],
    })
    try {
      const doctor = await import('@/core/doctor')
      await doctor.runDiagnostics(contentDir, tempDir)
      expect(mockRuntimeSend).not.toHaveBeenCalled()
    } finally {
      registry.unregisterHealthCheck('doctor-test.report-only')
    }
  })

  it('notifies the runtime main agent about unfixable plugin issues when requested', async () => {
    const registry = await import('../../src/core/health-check-registry')
    registry.registerHealthCheck({
      runtime: 'plugin',
      pluginId: 'doctor-test',
      id: 'doctor-test.unfixable',
      name: 'Unfixable',
      run: async () => [{
        check: 'unfixable-row',
        status: 'error',
        message: 'Needs operator attention',
        autoFixable: false,
      }],
    })
    try {
      const doctor = await import('@/core/doctor')
      await doctor.runDiagnostics(contentDir, tempDir, { notifyAgent: true })
      expect(mockRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'main',
        content: expect.stringContaining('Needs operator attention'),
      }))
    } finally {
      registry.unregisterHealthCheck('doctor-test.unfixable')
    }
  })

  // plugin-assets coverage moved to tests/plugins/health/system-checks.test.ts
  // when checkPluginAssets migrated to plugins/health/lib/system-checks/ in #139 C8.

  // ---------------------------------------------------------------------------
  // Onboarding gate: requireOnboard + .onboarded marker
  // ---------------------------------------------------------------------------

  describe('requireOnboard gate', () => {
    it('returns single error when requireOnboard=true and machine is not onboarded', async () => {
      mockIsOnboarded = false
      const { getSettings } = require('@/core/settings') as typeof import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof mock>)
      settings.mockReturnValueOnce({
        runtime: {
          adapter: 'openclaw',
          settings: {},
        },
        search: { adapter: 'antfly', settings: { enabled: false } },
        doctor: { intervalMs: 1800000, requireOnboard: true },
        service: { enabled: false },
      })
      // (vi.resetModules is a no-op in the bun:test shim — getSettings reads
      // lazily inside runDiagnostics so the mockReturnValueOnce above takes
      // effect on the next call without a forced module re-evaluation.)
      const { runDiagnostics } = require('@/core/doctor') as typeof import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      expect(results).toHaveLength(1)
      expect(results[0].check).toBe('onboarded')
      expect(results[0].status).toBe('error')
      expect(results[0].message).toContain('bakin onboard')
    })

    it('runs normal checks when requireOnboard=true and machine IS onboarded', async () => {
      mockIsOnboarded = true
      const { getSettings } = require('@/core/settings') as typeof import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof mock>)
      settings.mockReturnValueOnce({
        runtime: {
          adapter: 'openclaw',
          settings: {},
        },
        search: { adapter: 'antfly', settings: { enabled: false } },
        doctor: { intervalMs: 1800000, requireOnboard: true },
        service: { enabled: false },
      })
      // (vi.resetModules is a no-op in the bun:test shim — getSettings reads
      // lazily inside runDiagnostics so the mockReturnValueOnce above takes
      // effect on the next call without a forced module re-evaluation.)
      const { runDiagnostics } = require('@/core/doctor') as typeof import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      // Post-migration (#139): runDiagnostics no longer runs builtin checks
      // directly — every check is plugin-registered via runPluginHealthChecks.
      // With no plugins activated in this test, the result set is empty
      // when the gate doesn't fire. The non-presence of 'onboarded' is
      // what proves the gate didn't trip.
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    })

    it('runs normal checks when requireOnboard=false and machine is NOT onboarded', async () => {
      mockIsOnboarded = false
      const { getSettings } = require('@/core/settings') as typeof import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof mock>)
      settings.mockReturnValueOnce({
        runtime: {
          adapter: 'openclaw',
          settings: {},
        },
        search: { adapter: 'antfly', settings: { enabled: false } },
        doctor: { intervalMs: 1800000, requireOnboard: false },
        service: { enabled: false },
      })
      // (vi.resetModules is a no-op in the bun:test shim — getSettings reads
      // lazily inside runDiagnostics so the mockReturnValueOnce above takes
      // effect on the next call without a forced module re-evaluation.)
      const { runDiagnostics } = require('@/core/doctor') as typeof import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      // See note above: the gate not firing = no 'onboarded' row.
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    })
  })
})
