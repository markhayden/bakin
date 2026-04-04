import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock settings
vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    agents: ['main-operator', 'patch', 'pixel'],
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

// Mock mcporter (avoid install/config in tests)
vi.mock('@/core/mcporter', () => ({
  isMcporterInstalled: vi.fn(() => true),
  installMcporter: vi.fn(() => true),
  verifyConfig: vi.fn(() => ({
    installed: true,
    configExists: true,
    agentEntries: [
      { agent: 'main-operator', name: 'bakin-main-operator', url: 'http://localhost:3737/mcp?agent=main-operator', correct: true },
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
    // Only create persona for main-operator, not patch or pixel
    writeFileSync(join(contentDir, 'team', 'personas', 'main-operator.md'), '# Main Operator')

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
        agents: ['main-operator', 'patch', 'pixel'],
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
})
