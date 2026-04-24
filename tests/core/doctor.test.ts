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

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

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
    antfly: { enabled: false },
    doctor: { intervalMs: 1800000, autoFixSkill: false },
    openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
    service: { enabled: false },
  })),
}))

// Mock openclaw-config — owns the authoritative agent roster after T2
mock.module('@bakin/core/openclaw-config', () => ({
  getAgentIds: mock(() => ['main', 'patch', 'pixel']),
  findAgentById: mock((id: string) => (['main', 'patch', 'pixel'].includes(id) ? { id } : null)),
  readOpenClawConfig: mock(() => ({ agents: [{ id: 'main' }, { id: 'patch' }, { id: 'pixel' }] })),
  resetOpenClawConfigCache: mock(),
}))

mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => '/tmp/doctor-test-openclaw',
  getOpenClawPath: (...parts: string[]) => ['/tmp/doctor-test-openclaw', ...parts].join('/'),
}))

// Mock openclaw-client
mock.module('@/core/openclaw-client', () => ({
  ping: mock(async () => false),
  sendMessage: mock(),
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
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should export runDiagnostics', async () => {
    const doctor = await import('@/core/doctor')
    expect(typeof doctor.runDiagnostics).toBe('function')
  })

  it('should detect missing persona files', async () => {
    const doctor = await import('@/core/doctor')
    // Only create persona for main, not patch or pixel
    writeFileSync(join(contentDir, 'team', 'personas', 'main.md'), '# Main')

    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const personaResults = results.filter(r => r.check === 'personas')
    const warnings = personaResults.filter(r => r.status === 'warn')
    expect(warnings.length).toBeGreaterThanOrEqual(2) // patch and pixel missing
  })

  it('should check taskboard via SQLite', async () => {
    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const tbResults = results.filter(r => r.check === 'taskboard')
    // With mocked bun:sqlite, should get either ok or warn depending on db existence
    expect(tbResults.length).toBeGreaterThan(0)
  })

  it('should report gateway as unreachable', async () => {
    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const gwResults = results.filter(r => r.check === 'gateway')
    expect(gwResults[0].status).toBe('error')
  })

  describe('plugin-assets section', () => {
    it('reports ok when plugin-assets check returns ok', async () => {
      mockPluginAssetsCheck.mockResolvedValue({
        name: 'plugin-assets',
        status: 'ok',
        message: 'All 3 plugin asset(s) installed',
        details: { totalAvailable: 3 },
      })
      const doctor = await import('@/core/doctor')
      const results = await doctor.runDiagnostics(contentDir, tempDir)
      const section = results.filter(r => r.check === 'plugin-assets')
      expect(section.length).toBe(1)
      expect(section[0].status).toBe('ok')
      expect(section[0].message).toMatch(/3 plugin asset/)
    })

    it('reports warn with remediation reminder when drift exists', async () => {
      mockPluginAssetsCheck.mockResolvedValue({
        name: 'plugin-assets',
        status: 'warn',
        message: '2 plugin asset(s) need install (1 missing, 1 drifted)',
        remediation: 'Run `bakin install plugin-assets` to apply.',
        details: {
          totalAvailable: 3,
          missing: [{ pluginId: 'workflows', name: 'foo' }],
          drifted: [{ pluginId: 'workflows', name: 'bar' }],
        },
      })
      const doctor = await import('@/core/doctor')
      const results = await doctor.runDiagnostics(contentDir, tempDir)
      const section = results.filter(r => r.check === 'plugin-assets')
      expect(section.length).toBe(1)
      expect(section[0].status).toBe('warn')
      expect(section[0].message).toMatch(/bakin install plugin-assets/)
    })

    it('does not auto-install — only surfaces a reminder', async () => {
      mockPluginAssetsCheck.mockResolvedValue({
        name: 'plugin-assets',
        status: 'warn',
        message: '1 plugin asset(s) need install (1 missing, 0 drifted)',
        remediation: 'Run `bakin install plugin-assets` to apply.',
      })
      const doctor = await import('@/core/doctor')
      const results = await doctor.runDiagnostics(contentDir, tempDir)
      const section = results.filter(r => r.check === 'plugin-assets')
      expect(section[0].autoFixable).toBe(false)
    })
  })

  describe('asset sidecar mismatch detection', () => {
    it('should detect mismatched sidecar naming', async () => {
      const doctor = await import('@/core/doctor')

      // Create the assets directory structure
      const taskDir = join(contentDir, 'assets', 'images', 'task-abc')
      mkdirSync(taskDir, { recursive: true })

      // Create asset file
      writeFileSync(join(taskDir, '20250727-pop-tart.png'), 'fake-image')

      // Create misnamed sidecar (wrong name — missing date prefix and extension)
      writeFileSync(join(taskDir, 'pop-tart.meta.json'), JSON.stringify({
        author: 'pixel',
        taskId: 'task-abc',
        createdAt: '2026-03-23T14:00:00Z',
        tool: 'dall-e-3',
        description: 'A pop tart',
      }))

      // Run without autoFix to detect the mismatch
      const results = await doctor.runDiagnostics(contentDir, tempDir)
      const assetResults = results.filter(r => r.check === 'assets')

      // Should report misnamed sidecar and missing sidecar for the asset
      const warnings = assetResults.filter(r => r.status === 'warn')
      expect(warnings.some(r => r.message.includes('misnamed') || r.message.includes('missing'))).toBe(true)
    })

    it('should auto-fix mismatched sidecar by merging into stub', async () => {
      // Override settings to enable autoFix
      const { getSettings } = require('@/core/settings') as typeof import('@/core/settings')
      vi.mocked(getSettings).mockReturnValue({
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: true },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      } as ReturnType<typeof getSettings>)

      const doctor = await import('@/core/doctor')

      const taskDir = join(contentDir, 'assets', 'images', 'task-abc')
      mkdirSync(taskDir, { recursive: true })

      // Create asset file
      writeFileSync(join(taskDir, '20250727-pop-tart.png'), 'fake-image')

      // Create stub sidecar (correct name, agent: "unknown")
      writeFileSync(join(taskDir, '20250727-pop-tart.png.meta.json'), JSON.stringify({
        agent: 'unknown',
        taskId: 'task-abc',
        created: '2026-03-23T00:00:00Z',
        description: 'Auto-generated sidecar for 20250727-pop-tart.png',
        tags: [],
      }, null, 2))

      // Create mismatched sidecar (wrong name, rich content with wrong field names)
      writeFileSync(join(taskDir, 'pop-tart.meta.json'), JSON.stringify({
        author: 'pixel',
        taskId: 'task-abc',
        createdAt: '2026-03-23T14:00:00Z',
        tool: 'dall-e-3',
        description: 'A delicious pop tart image',
      }))

      const results = await doctor.runDiagnostics(contentDir, tempDir)
      const assetResults = results.filter(r => r.check === 'assets')
      const fixes = assetResults.filter(r => r.status === 'fixed')
      expect(fixes.some(r => r.message.includes('misnamed') || r.message.includes('Merged'))).toBe(true)

      // Verify the correctly-named sidecar now has the rich content with normalized fields
      const correctMeta = JSON.parse(readFileSync(join(taskDir, '20250727-pop-tart.png.meta.json'), 'utf-8'))
      expect(correctMeta.agent).toBe('pixel') // normalized from author
      expect(correctMeta.created).toBe('2026-03-23T14:00:00Z') // normalized from createdAt
      expect(correctMeta.tool).toBe('dall-e-3')
      expect(correctMeta.description).toBe('A delicious pop tart image')

      // Verify the mismatched sidecar was removed
      expect(existsSync(join(taskDir, 'pop-tart.meta.json'))).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Onboarding gate: requireOnboard + .onboarded marker
  // ---------------------------------------------------------------------------

  describe('requireOnboard gate', () => {
    it('returns single error when requireOnboard=true and machine is not onboarded', async () => {
      mockIsOnboarded = false
      const { getSettings } = require('@/core/settings') as typeof import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof mock>)
      settings.mockReturnValueOnce({
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: false, requireOnboard: true },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })
      vi.resetModules()
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
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: false, requireOnboard: true },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })
      vi.resetModules()
      const { runDiagnostics } = require('@/core/doctor') as typeof import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      // Should have many results from the normal check suite, not just 1
      expect(results.length).toBeGreaterThan(1)
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    })

    it('runs normal checks when requireOnboard=false and machine is NOT onboarded', async () => {
      mockIsOnboarded = false
      const { getSettings } = require('@/core/settings') as typeof import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof mock>)
      settings.mockReturnValueOnce({
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: false, requireOnboard: false },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })
      vi.resetModules()
      const { runDiagnostics } = require('@/core/doctor') as typeof import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      expect(results.length).toBeGreaterThan(1)
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    })
  })
})
