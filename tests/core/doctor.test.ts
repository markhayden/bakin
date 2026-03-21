import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock settings
vi.mock('@/core/settings', () => ({
  getSettings: vi.fn(() => ({
    agents: ['main-operator', 'patch', 'pixel'],
    antfly: { enabled: false },
    doctor: { intervalMs: 1800000, autoFixSkill: false },
    openclaw: { binaryPath: 'openclaw', gatewayUrl: 'http://127.0.0.1', gatewayPort: 18789 },
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

describe('doctor', () => {
  let tempDir: string
  let contentDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'beacon-doctor-test-'))
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

  it('should detect missing taskboard', async () => {
    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const tbResults = results.filter(r => r.check === 'taskboard')
    expect(tbResults[0].status).toBe('warn')
    expect(tbResults[0].message).toContain('not found')
  })

  it('should pass taskboard check when valid', async () => {
    const doctor = await import('@/core/doctor')
    writeFileSync(join(contentDir, 'TASKBOARD.md'), `# Taskboard

## 📋 Todo
- [ ] Something

## 🔵 In Progress

## ✅ Done
`)
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const tbResults = results.filter(r => r.check === 'taskboard')
    expect(tbResults[0].status).toBe('ok')
  })

  it('should report gateway as unreachable', async () => {
    const doctor = await import('@/core/doctor')
    const results = await doctor.runDiagnostics(contentDir, tempDir)
    const gwResults = results.filter(r => r.check === 'gateway')
    expect(gwResults[0].status).toBe('error')
  })
})
