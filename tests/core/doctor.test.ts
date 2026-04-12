import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
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

// Mock audit (avoid file writes in tests)
vi.mock('@/core/audit', () => ({
  appendAudit: vi.fn(),
}))

// Mock better-sqlite3 so doctor checks don't touch real SQLite
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn(() => ({
      prepare: vi.fn(() => ({
        get: vi.fn(() => ({ n: 0 })),
      })),
      close: vi.fn(),
    })),
  }
})

// Mock onboarding state — controls the requireOnboard gate
let mockIsOnboarded = true
vi.mock('@/core/onboarding/state', () => ({
  isOnboarded: () => mockIsOnboarded,
}))

// Mock mcporter (avoid install/config in tests)
vi.mock('@/core/mcporter', () => ({
  isMcporterInstalled: vi.fn(() => true),
  installMcporter: vi.fn(() => true),
  verifyConfig: vi.fn(() => ({
    installed: true,
    configExists: true,
    agentEntries: [
      { agent: 'roscoe', name: 'bakin-roscoe', url: 'http://localhost:3737/mcp?agent=roscoe', correct: true },
      { agent: 'patch', name: 'bakin-patch', url: 'http://localhost:3737/mcp?agent=patch', correct: true },
      { agent: 'pixel', name: 'bakin-pixel', url: 'http://localhost:3737/mcp?agent=pixel', correct: true },
    ],
    staleEntries: [],
  })),
  syncConfig: vi.fn(() => []),
}))

describe('doctor', () => {
  let tempDir: string
  let contentDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-test-'))
    contentDir = join(tempDir, 'content')
    mkdirSync(join(contentDir, 'team', 'personas'), { recursive: true })
    mockIsOnboarded = true // default: gate passes
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
    // Only create persona for roscoe, not patch or pixel
    writeFileSync(join(contentDir, 'team', 'personas', 'roscoe.md'), '# Roscoe')

    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const personaResults = results.filter(r => r.check === 'personas')
    const warnings = personaResults.filter(r => r.status === 'warn')
    expect(warnings.length).toBeGreaterThanOrEqual(2) // patch and pixel missing
  })

  it('should check taskboard via SQLite', async () => {
    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const tbResults = results.filter(r => r.check === 'taskboard')
    // With mocked better-sqlite3, should get either ok or warn depending on db existence
    expect(tbResults.length).toBeGreaterThan(0)
  })

  it('should report gateway as unreachable', async () => {
    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const gwResults = results.filter(r => r.check === 'gateway')
    expect(gwResults[0].status).toBe('error')
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
      const { getSettings } = await import('@/core/settings')
      vi.mocked(getSettings).mockReturnValue({
        agents: ['roscoe', 'patch', 'pixel'],
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
      const { getSettings } = await import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof vi.fn>)
      settings.mockReturnValueOnce({
        agents: [],
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: false, requireOnboard: true },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })
      vi.resetModules()
      const { runDiagnostics } = await import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      expect(results).toHaveLength(1)
      expect(results[0].check).toBe('onboarded')
      expect(results[0].status).toBe('error')
      expect(results[0].message).toContain('bakin onboard')
    })

    it('runs normal checks when requireOnboard=true and machine IS onboarded', async () => {
      mockIsOnboarded = true
      const { getSettings } = await import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof vi.fn>)
      settings.mockReturnValueOnce({
        agents: ['roscoe'],
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: false, requireOnboard: true },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })
      vi.resetModules()
      const { runDiagnostics } = await import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      // Should have many results from the normal check suite, not just 1
      expect(results.length).toBeGreaterThan(1)
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    })

    it('runs normal checks when requireOnboard=false and machine is NOT onboarded', async () => {
      mockIsOnboarded = false
      const { getSettings } = await import('@/core/settings')
      const settings = (getSettings as unknown as ReturnType<typeof vi.fn>)
      settings.mockReturnValueOnce({
        agents: ['roscoe'],
        antfly: { enabled: false },
        doctor: { intervalMs: 1800000, autoFixSkill: false, requireOnboard: false },
        openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
        service: { enabled: false },
      })
      vi.resetModules()
      const { runDiagnostics } = await import('@/core/doctor')
      const results = await runDiagnostics(contentDir, tempDir)
      expect(results.length).toBeGreaterThan(1)
      expect(results.find(r => r.check === 'onboarded')).toBeUndefined()
    })
  })
})
