/**
 * Health-plugin-owned system doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C6+). This file grows over
 * commits C6-C8 to cover all 9 system-level checks plus the
 * managed-blocks check (C9). For C6 it covers content-dir, service,
 * and mcporter.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-health-system-${Date.now()}-${randomUUID()}`)

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

let mockUsingBakinHome = true
let mockContentDir = testDir
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => mockContentDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => mockUsingBakinHome,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockContentDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => mockUsingBakinHome,
}))

let mockServiceEnabled = false
let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    service: { enabled: mockServiceEnabled },
    doctor: { autoFixSkill: mockAutoFix },
  }),
  resetSettingsCache: () => {},
}))

let mockMcporterInstalled = true
let mockInstallMcporterReturn = true
let mockAgentEntries: Array<{ agent: string; correct: boolean }> = []
let mockStaleEntries: string[] = []
let syncConfigCalls = 0
mock.module('../../../src/core/mcporter', () => ({
  isMcporterInstalled: () => mockMcporterInstalled,
  installMcporter: () => mockInstallMcporterReturn,
  verifyConfig: () => ({
    installed: true,
    configExists: true,
    agentEntries: mockAgentEntries,
    staleEntries: mockStaleEntries,
  }),
  syncConfig: () => { syncConfigCalls++; return ['updated'] },
}))

let mockGatewayPing = async () => true
let mockGatewayPingThrows: Error | null = null
mock.module('../../../src/core/openclaw-client', () => ({
  ping: async () => {
    if (mockGatewayPingThrows) throw mockGatewayPingThrows
    return mockGatewayPing()
  },
  sendMessage: mock(),
}))

let mockAntflyEnabled = false
let mockAntflyUrl = 'http://127.0.0.1:8765/api/v1'
let mockAntflyInstalled = true
mock.module('../../../src/core/antfly-server', () => ({
  installed: () => mockAntflyInstalled,
}))

const realFetch = globalThis.fetch
let mockFetchOk = true
let mockFetchHealth = 'green'
function installMockFetch() {
  ;(globalThis as { fetch: typeof fetch }).fetch = mock(async () => {
    if (mockFetchOk) {
      return new Response(JSON.stringify({ health: mockFetchHealth }), { status: 200 })
    }
    return new Response('{}', { status: 503 })
  }) as unknown as typeof fetch
}
function restoreFetch() {
  ;(globalThis as { fetch: typeof fetch }).fetch = realFetch
}

// Override settings mock to include antfly subtree (consumed by checkAntfly)
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    service: { enabled: mockServiceEnabled },
    doctor: { autoFixSkill: mockAutoFix },
    antfly: { enabled: mockAntflyEnabled, url: mockAntflyUrl },
  }),
  resetSettingsCache: () => {},
}))

import { checkContentDir } from '../../../plugins/health/lib/system-checks/content-dir'
import { checkService } from '../../../plugins/health/lib/system-checks/service'
import { checkMcporter } from '../../../plugins/health/lib/system-checks/mcporter'
import { checkGateway } from '../../../plugins/health/lib/system-checks/gateway'
import { checkAntfly } from '../../../plugins/health/lib/system-checks/antfly'

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockUsingBakinHome = true
  mockContentDir = testDir
  mockServiceEnabled = false
  mockAutoFix = false
  mockMcporterInstalled = true
  mockInstallMcporterReturn = true
  mockAgentEntries = []
  mockStaleEntries = []
  syncConfigCalls = 0
  mockGatewayPing = async () => true
  mockGatewayPingThrows = null
  mockAntflyEnabled = false
  mockAntflyInstalled = true
  mockAntflyUrl = 'http://127.0.0.1:8765/api/v1'
  mockFetchOk = true
  mockFetchHealth = 'green'
  restoreFetch()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  restoreFetch()
})

// ─── checkContentDir ──────────────────────────────────────────────────────

describe('checkContentDir', () => {
  it('reports ok when using ~/.bakin/', () => {
    const results = checkContentDir()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('content-dir')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/Content directory:/)
  })

  it('warns when content lives outside ~/.bakin/', () => {
    mockUsingBakinHome = false
    mockContentDir = '/some/other/path'
    const results = checkContentDir()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/run: bakin init/)
  })
})

// ─── checkService ─────────────────────────────────────────────────────────

describe('checkService', () => {
  it('returns ok-skipped when service.enabled is false', () => {
    mockServiceEnabled = false
    const results = checkService('/some/project')
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/disabled in settings/)
  })

  it('returns ok-skipped on non-darwin platforms even when enabled', () => {
    if (process.platform === 'darwin') return // platform-specific; skip on macOS
    mockServiceEnabled = true
    const results = checkService('/some/project')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/macOS only/)
  })

  it('warns when the LaunchAgent plist is missing', () => {
    if (process.platform !== 'darwin') return
    mockServiceEnabled = true
    // Override HOME so plistPath resolves under the temp dir (with no plist)
    const previousHome = process.env.HOME
    process.env.HOME = testDir
    try {
      const results = checkService('/some/project')
      expect(results.some(r => r.status === 'warn' && r.message.includes('plist not found'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('flags a stale WorkingDirectory in the plist', () => {
    if (process.platform !== 'darwin') return
    mockServiceEnabled = true
    const previousHome = process.env.HOME
    process.env.HOME = testDir
    try {
      const launchDir = join(testDir, 'Library', 'LaunchAgents')
      mkdirSync(launchDir, { recursive: true })
      writeFileSync(
        join(launchDir, 'com.openclaw.mc.plist'),
        `<key>WorkingDirectory</key><string>/old/path</string><string>/old/path/server.ts</string>`,
      )
      const results = checkService('/new/project')
      expect(results.some(r => r.status === 'error' && r.message.includes('/old/path'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })
})

// ─── checkMcporter ────────────────────────────────────────────────────────

describe('checkMcporter', () => {
  it('warns when mcporter is not installed (no autoFix)', () => {
    mockMcporterInstalled = false
    const results = checkMcporter()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/not installed/)
  })

  it('installs mcporter under autoFix when missing', () => {
    mockMcporterInstalled = false
    mockAutoFix = true
    mockAgentEntries = [{ agent: 'main', correct: true }]
    const results = checkMcporter()
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Installed mcporter'))).toBe(true)
  })

  it('returns an error when install fails under autoFix', () => {
    mockMcporterInstalled = false
    mockAutoFix = true
    mockInstallMcporterReturn = false
    const results = checkMcporter()
    expect(results.some(r => r.status === 'error' && r.message.includes('Failed to install mcporter'))).toBe(true)
  })

  it('reports ok when all agent entries are correct', () => {
    mockAgentEntries = [
      { agent: 'main', correct: true },
      { agent: 'patch', correct: true },
    ]
    const results = checkMcporter()
    expect(results.some(r => r.status === 'ok' && r.message.includes('All 2 agent entries'))).toBe(true)
  })

  it('warns when agent entries are missing or outdated (no autoFix)', () => {
    mockAgentEntries = [{ agent: 'main', correct: false }]
    const results = checkMcporter()
    expect(results.some(r => r.status === 'warn' && r.message.includes('1 agent(s) missing or outdated'))).toBe(true)
  })

  it('runs syncConfig under autoFix when entries are wrong', () => {
    mockAutoFix = true
    mockAgentEntries = [{ agent: 'main', correct: false }]
    const results = checkMcporter()
    expect(syncConfigCalls).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Config updated'))).toBe(true)
  })
})

// ─── checkGateway ─────────────────────────────────────────────────────────

describe('checkGateway', () => {
  it('reports ok when ping succeeds', async () => {
    mockGatewayPing = async () => true
    const results = await checkGateway()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/reachable/)
  })

  it('reports error when ping returns false', async () => {
    mockGatewayPing = async () => false
    const results = await checkGateway()
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/not responding/)
  })

  it('reports error when ping throws', async () => {
    mockGatewayPingThrows = new Error('connection refused')
    const results = await checkGateway()
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/connection refused/)
  })
})

// ─── checkAntfly ──────────────────────────────────────────────────────────

describe('checkAntfly', () => {
  it('warns when disabled and binary is not installed', async () => {
    mockAntflyEnabled = false
    mockAntflyInstalled = false
    const results = await checkAntfly()
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/disabled and binary not installed/)
  })

  it('reports ok when disabled but the binary is installed', async () => {
    mockAntflyEnabled = false
    mockAntflyInstalled = true
    const results = await checkAntfly()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/Antfly disabled/)
  })

  it('reports error when enabled but the binary is missing', async () => {
    mockAntflyEnabled = true
    mockAntflyInstalled = false
    const results = await checkAntfly()
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/Antfly enabled but binary not found/)
  })

  it('reports ok when the daemon responds healthy', async () => {
    mockAntflyEnabled = true
    mockAntflyInstalled = true
    mockFetchOk = true
    mockFetchHealth = 'green'
    installMockFetch()
    try {
      const results = await checkAntfly()
      expect(results[0].status).toBe('ok')
      expect(results[0].message).toMatch(/health: green/)
    } finally {
      restoreFetch()
    }
  })

  it('reports error when every URL fails', async () => {
    mockAntflyEnabled = true
    mockAntflyInstalled = true
    mockFetchOk = false
    installMockFetch()
    try {
      const results = await checkAntfly()
      expect(results[0].status).toBe('error')
      expect(results[0].message).toMatch(/connection failed/)
    } finally {
      restoreFetch()
    }
  })
})
