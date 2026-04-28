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
mock.module('@/core/content-dir', () => ({
  getContentDir: () => mockContentDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => mockUsingBakinHome,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => mockContentDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => mockUsingBakinHome,
}))
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
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let mockServiceEnabled = false
let mockAutoFix = false

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
mock.module('../../../src/core/runtime-registry', () => ({
  pingRuntime: async () => {
    if (mockGatewayPingThrows) throw mockGatewayPingThrows
    return mockGatewayPing()
  },
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

// One unified settings mock covering every subtree any system check reads.
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({
    service: { enabled: mockServiceEnabled },
    doctor: { autoFixSkill: mockAutoFix },
    antfly: { enabled: mockAntflyEnabled, url: mockAntflyUrl },
  }),
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

mock.module('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async () => undefined,
    has: () => false,
    register: () => () => {},
  }),
}))

let mockPluginAssetsResult = { name: 'plugin-assets', status: 'ok' as const, message: '0 plugin assets to install' }
mock.module('../../../src/core/onboarding/plugin-assets', () => ({
  pluginAssetsComponent: {
    name: 'plugin-assets',
    check: async () => mockPluginAssetsResult,
    install: async () => ({ status: 'noop' as const, message: 'noop' }),
  },
}))

mock.module('../../../scripts/lib/registry', () => ({
  getAllExecTools: () => [],
}))

import { checkContentDir } from '../../../plugins/health/lib/system-checks/content-dir'
import { checkService } from '../../../plugins/health/lib/system-checks/service'
import { checkMcporter } from '../../../plugins/health/lib/system-checks/mcporter'
import { checkGateway } from '../../../plugins/health/lib/system-checks/gateway'
import { checkAntfly } from '../../../plugins/health/lib/system-checks/antfly'
import { checkOrchestratorRules } from '../../../plugins/health/lib/system-checks/orchestrator-rules'
import { checkAndSyncSkill } from '../../../plugins/health/lib/system-checks/sync-skill'
import { checkPluginAssets } from '../../../plugins/health/lib/system-checks/plugin-assets'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'

let mockRuntime: AgentRuntimeAdapter
let runtimeWorkspaceFiles: Map<string, string>
let runtimeSkill: RuntimeSkill | null

function runtimeFileKey(agentId: string, path: string): string {
  return `${agentId}:${path}`
}

function makeHealthRuntime(): AgentRuntimeAdapter {
  const runtime = createMockRuntimeAdapter()
  runtime.agents.list = async () => [{ id: 'main', name: 'Main', role: 'Orchestrator', status: 'active' }]
  runtime.agents.readWorkspaceFile = async (agentId, path) => {
    const content = runtimeWorkspaceFiles.get(runtimeFileKey(agentId, path))
    return content === undefined ? null : { path, content }
  }
  runtime.agents.writeWorkspaceFile = async (agentId, file) => {
    runtimeWorkspaceFiles.set(runtimeFileKey(agentId, file.path), file.content)
  }
  runtime.skills.get = async (name) => name === 'bakin' ? runtimeSkill : null
  runtime.skills.write = async (skill) => {
    runtimeSkill = skill
  }
  return runtime
}

function seedMainAgentsMd(content: string): void {
  runtimeWorkspaceFiles.set(runtimeFileKey('main', 'AGENTS.md'), content)
}

function readMainAgentsMd(): string {
  return runtimeWorkspaceFiles.get(runtimeFileKey('main', 'AGENTS.md')) ?? ''
}

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
  runtimeWorkspaceFiles = new Map()
  runtimeSkill = null
  mockRuntime = makeHealthRuntime()
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

// ─── checkOrchestratorRules ───────────────────────────────────────────────

describe('checkOrchestratorRules', () => {
  it('warns when AGENTS.md is missing', async () => {
    const results = await checkOrchestratorRules(mockRuntime)
    expect(results[0].check).toBe('orchestrator-rules')
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/AGENTS.md not found/)
  })

  it('warns when block is missing without autoFix', async () => {
    seedMainAgentsMd('# Main\n\nNo block here.\n')
    const results = await checkOrchestratorRules(mockRuntime)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/missing from AGENTS.md/)
  })

  it('adds the block under autoFix when missing', async () => {
    mockAutoFix = true
    seedMainAgentsMd('# Main\n')
    const results = await checkOrchestratorRules(mockRuntime)
    expect(results[0].status).toBe('fixed')
    const after = readMainAgentsMd()
    expect(after).toContain('<!-- bakin:orchestrator-rules:start -->')
    expect(after).toContain('<!-- bakin:orchestrator-rules:end -->')
  })

  it('reports error when block has start marker but no end marker', async () => {
    seedMainAgentsMd(
      '# Main\n\n<!-- bakin:orchestrator-rules:start -->\n(missing end)\n',
    )
    const results = await checkOrchestratorRules(mockRuntime)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/no end marker/)
  })
})

// ─── checkAndSyncSkill ────────────────────────────────────────────────────

describe('checkAndSyncSkill', () => {
  it('errors when the skill source is missing', async () => {
    const projectRoot = pathJoin(testDir, 'project-no-skill')
    mkdirSync(projectRoot, { recursive: true })
    const results = await checkAndSyncSkill(projectRoot, mockRuntime)
    expect(results[0].check).toBe('skill')
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/source not found/)
  })

  it('errors when the template is missing the exec-tools markers', async () => {
    const projectRoot = pathJoin(testDir, 'project-no-markers')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(join(projectRoot, 'skill', 'SKILL.md'), '# Bakin Skill\n(no markers)\n')
    const results = await checkAndSyncSkill(projectRoot, mockRuntime)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/missing the .*markers/)
  })

  it('warns when the rendered skill is not yet installed (no autoFix)', async () => {
    const projectRoot = pathJoin(testDir, 'project-ok')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(
      join(projectRoot, 'skill', 'SKILL.md'),
      '# Bakin Skill\n<!-- bakin:exec-tools:start -->\n<!-- bakin:exec-tools:end -->\n',
    )
    const results = await checkAndSyncSkill(projectRoot, mockRuntime)
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/not installed in runtime/)
  })

  it('installs the skill under autoFix when missing', async () => {
    mockAutoFix = true
    const projectRoot = pathJoin(testDir, 'project-install')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(
      join(projectRoot, 'skill', 'SKILL.md'),
      '# Bakin Skill\n<!-- bakin:exec-tools:start -->\n<!-- bakin:exec-tools:end -->\n',
    )
    const results = await checkAndSyncSkill(projectRoot, mockRuntime)
    expect(results[0].status).toBe('fixed')
    expect(results[0].message).toMatch(/installed in runtime/)
    expect(runtimeSkill?.instructions).toContain('<!-- bakin:exec-tools:start -->')
  })
})

// ─── checkPluginAssets ────────────────────────────────────────────────────

describe('checkPluginAssets', () => {
  it('reports ok when component check returns ok', async () => {
    mockPluginAssetsResult = { name: 'plugin-assets', status: 'ok', message: '3 plugin assets installed' }
    const results = await checkPluginAssets()
    expect(results[0].check).toBe('plugin-assets')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/3 plugin assets installed/)
  })

  it('warns with reminder when component reports drift', async () => {
    mockPluginAssetsResult = {
      name: 'plugin-assets',
      status: 'warn' as unknown as 'ok',
      message: '1 missing',
      // @ts-expect-error - extra field accepted at runtime
      remediation: 'Run `bakin install plugin-assets` to apply.',
    }
    const results = await checkPluginAssets()
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(false)
    expect(results[0].message).toMatch(/bakin install plugin-assets/)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers all 9 system + managed-blocks health checks on activate', async () => {
    const healthPlugin = (await import('../../../plugins/health')).default
    const registeredIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'health',
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `health.${def.id}` },
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
      runtime: createMockRuntimeAdapter(),
    }
    await healthPlugin.activate(ctx as unknown as Parameters<typeof healthPlugin.activate>[0])

    // 9 system checks (C6: 3, C7: 2, C8: 3, C9: 1)
    expect(registeredIds).toContain('content-dir')
    expect(registeredIds).toContain('service')
    expect(registeredIds).toContain('mcporter')
    expect(registeredIds).toContain('gateway')
    expect(registeredIds).toContain('antfly')
    expect(registeredIds).toContain('orchestrator-rules')
    expect(registeredIds).toContain('skill')
    expect(registeredIds).toContain('plugin-assets')
    expect(registeredIds).toContain('managed-blocks')
  })
})
