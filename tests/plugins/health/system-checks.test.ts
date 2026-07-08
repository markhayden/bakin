/**
 * Health-plugin-owned system doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C6+). This file grows over
 * commits C6-C8 to cover all 9 system-level checks plus the
 * system checks. For C6 it covers content-dir and service.
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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => pathJoin(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let mockServiceEnabled = false
let mockNotificationChannel = ''
let mockNotificationTarget = ''
let mockChannelAliases: Record<string, string> = {}

let mockSearchEnabled = false
let mockSearchUrl = 'http://127.0.0.1:8765/api/v1'
let mockSearchInstalled = true
const mockServiceStatus = { mode: 'launchd' as const, provisioned: true }
mock.module('../../../src/core/search-adapter-factory', () => ({
  isSearchAdapterInstalled: () => mockSearchInstalled,
  getSearchAdapterServiceStatus: () => mockServiceStatus,
}))

// New-check seams: outbox facade + blue/green table states. Mutable so the
// search-outbox / search-consistency cases steer them per test.
let mockOutboxStats = { pending: 0, inflight: 0, quarantined: 0, oldestPendingEnqueuedAt: null as number | null }
let mockQuarantinedRows: Array<{ logicalTable: string; key: string; lastError: string | null }> = []
let mockRetried = 0
mock.module('../../../src/core/search-outbox', () => ({
  // Full facade surface — plugin activation pulls the real registry, which
  // imports the write-path members too.
  outboxStats: () => mockOutboxStats,
  listQuarantined: () => mockQuarantinedRows,
  retryQuarantined: () => { mockRetried = mockQuarantinedRows.length; return mockRetried },
  nudgeOutboxPump: async () => null,
  enqueueIndex: () => {},
  enqueueRemove: () => {},
  enqueueTransform: () => {},
  applyTransformOps: (doc: Record<string, unknown>) => doc,
  configureOutboxPump: () => {},
  startOutboxPump: () => {},
  stopOutboxPump: () => {},
}))
let mockTableStates: Array<Record<string, unknown>> = []
mock.module('@bakin/core/search/tables', () => ({
  // Full surface: the plugin-activation test pulls the real registry, which
  // imports more than the checks do.
  listTableStates: () => mockTableStates,
  tableStatus: () => null,
  queryTarget: () => null,
  resolveDrainTargets: (logical: string) => [logical],
  sweepTombstones: async () => 0,
  ensureTable: async () => 'unchanged',
  rebuildTable: async () => 'migrated',
  resumeMigrations: async () => {},
  resetTablesForTests: () => {},
}))
mock.module('../../../src/core/search-orphan-sweep', () => ({
  runOrphanSweep: async () => [],
}))

const realFetch = globalThis.fetch
let mockFetchOk = true
let mockSearchAvailable = true
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
    search: { adapter: 'antfly', settings: { enabled: mockSearchEnabled, url: mockSearchUrl } },
    notifications: {
      channel: mockNotificationChannel,
      target: mockNotificationTarget,
      gateAlerts: true,
      channelAliases: mockChannelAliases,
    },
  }),
  resetSettingsCache: () => {},
}))

mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async () => undefined,
    has: () => false,
    register: () => () => {},
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async () => undefined,
    has: () => false,
    register: () => () => {},
  }),
}))

mock.module('../../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable, tables: { stats: async () => ({ table: 't', documents: 1 }) } },
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
}))
mock.module('../../../src/core/app-services-store', () => ({
  getAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable, tables: { stats: async () => ({ table: 't', documents: 1 }) } },
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
}))
mock.module('../../../src/core/app-services.ts', () => ({
  getAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable, tables: { stats: async () => ({ table: 't', documents: 1 }) } },
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
}))
mock.module('@/core/app-services', () => ({
  getAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
}))
mock.module('@/core/app-services-store', () => ({
  getAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  maybeGetAppServices: () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
  createAppServices: async () => ({
    runtime: mockRuntime,
    search: { available: async () => mockSearchAvailable },
    tasks: {},
    health: {},
  }),
}))
mock.module('@bakin/core/app-services', () => ({
  createHealthService: () => ({}),
}))

let mockPluginAssetsResult = { name: 'plugin-assets', status: 'ok' as const, message: '0 plugin assets to install' }
mock.module('../../../src/core/onboarding/plugin-assets', () => ({
  pluginAssetsComponent: {
    name: 'plugin-assets',
    check: async () => mockPluginAssetsResult,
    install: async () => ({ status: 'noop' as const, message: 'noop' }),
  },
}))

mock.module('@/core/exec-tools/registry', () => ({
  getAllExecTools: () => [],
}))

import { checkContentDir } from '../../../plugins/health/lib/system-checks/content-dir'
import { checkService } from '../../../plugins/health/lib/system-checks/service'
import { checkRuntime } from '../../../plugins/health/lib/system-checks/runtime'
import { checkChannelApprovals } from '../../../plugins/health/lib/system-checks/channel-approvals'
import { checkChannelAliases } from '../../../plugins/health/lib/system-checks/channel-aliases'
import { checkSearchAdapter } from '../../../plugins/health/lib/system-checks/search'
import { checkSearchOutbox, searchOutboxRepair } from '../../../plugins/health/lib/system-checks/search-outbox'
import { checkSearchConsistency } from '../../../plugins/health/lib/system-checks/search-consistency'
import { checkAndSyncSkill, syncSkillRepair } from '../../../plugins/health/lib/system-checks/sync-skill'
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

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  mockUsingBakinHome = true
  mockContentDir = testDir
  mockServiceEnabled = false
  mockNotificationChannel = ''
  mockNotificationTarget = ''
  mockChannelAliases = {}
  mockSearchEnabled = false
  mockSearchInstalled = true
  mockSearchUrl = 'http://127.0.0.1:8765/api/v1'
  mockFetchOk = true
  mockSearchAvailable = true
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
  it('reports the resolved Bakin home path', () => {
    const results = checkContentDir()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('content-dir')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/Bakin home:/)
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
        join(launchDir, 'com.makinbakin.bakin.plist'),
        `<key>WorkingDirectory</key><string>/old/path</string><string>/old/path/server.ts</string>`,
      )
      const results = checkService('/new/project')
      expect(results.some(r => r.status === 'error' && r.message.includes('/old/path'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('accepts binary LaunchAgent plists for the current service label', () => {
    if (process.platform !== 'darwin') return
    mockServiceEnabled = true
    const previousHome = process.env.HOME
    process.env.HOME = testDir
    try {
      const launchDir = join(testDir, 'Library', 'LaunchAgents')
      mkdirSync(launchDir, { recursive: true })
      writeFileSync(
        join(launchDir, 'com.makinbakin.bakin.plist'),
        [
          '<key>ProgramArguments</key>',
          '<array>',
          '<string>/usr/local/bin/bakin</string>',
          '<string>serve</string>',
          '</array>',
          '<key>WorkingDirectory</key><string>/Users/tester/.bakin</string>',
        ].join(''),
      )
      const results = checkService('/Users/tester/.bakin')
      expect(results.some(r => r.message.includes('plist not found'))).toBe(false)
      expect(results.some(r => r.status === 'error')).toBe(false)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })
})

// ─── checkRuntime ─────────────────────────────────────────────────────────

describe('checkRuntime', () => {
  it('reports ok when ping succeeds', async () => {
    mockRuntime.ping = async () => true
    const results = await checkRuntime(mockRuntime)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/reachable/)
  })

  it('reports error when ping returns false', async () => {
    mockRuntime.ping = async () => false
    const results = await checkRuntime(mockRuntime)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/not responding/)
  })

  it('reports error when ping throws', async () => {
    mockRuntime.ping = async () => {
      throw new Error('connection refused')
    }
    const results = await checkRuntime(mockRuntime)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/connection refused/)
  })
})

// ─── checkChannelApprovals ────────────────────────────────────────────────

describe('checkChannelApprovals', () => {
  it('reports ok when a runtime channel supports interactive approvals', async () => {
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message', 'interactive-approval'],
    }]

    const results = await checkChannelApprovals(mockRuntime)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toContain('Discord')
  })

  it('warns when channel approvals are render-only', async () => {
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message', 'rich-content'],
    }]

    const results = await checkChannelApprovals(mockRuntime)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/render-only/)
  })

  it('warns when channel capabilities cannot be inspected', async () => {
    mockRuntime.channels!.list = async () => {
      throw new Error('channel registry unavailable')
    }

    const results = await checkChannelApprovals(mockRuntime)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/channel registry unavailable/)
  })
})

// ─── checkChannelAliases ─────────────────────────────────────────────────

describe('checkChannelAliases', () => {
  it('reports ok when no aliases are configured', async () => {
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = await checkChannelAliases(mockRuntime)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toContain('No channel aliases')
  })

  it('reports ok when aliases target available runtime channels', async () => {
    mockChannelAliases = { general: 'discord:channel-123' }
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = await checkChannelAliases(mockRuntime)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toContain('1 channel alias')
  })

  it('warns when an alias targets an unavailable runtime channel', async () => {
    mockChannelAliases = { general: 'slack:channel-123' }
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = await checkChannelAliases(mockRuntime)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toContain('unavailable runtime channel')
  })

  it('reports ok when a legacy notification target supplies the general alias', async () => {
    mockNotificationChannel = 'discord'
    mockNotificationTarget = 'channel-123'
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = await checkChannelAliases(mockRuntime)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toContain('1 channel alias')
  })

  it('warns when the configured alert channel is a missing alias', async () => {
    mockNotificationChannel = 'general'
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = await checkChannelAliases(mockRuntime)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toContain('notifications.channelAliases.general')
  })
})

// ─── checkSearchAdapter ───────────────────────────────────────────────────

describe('checkSearchAdapter', () => {
  it('warns when disabled and binary is not installed', async () => {
    mockSearchEnabled = false
    mockSearchInstalled = false
    const results = await checkSearchAdapter()
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/Search disabled and active search adapter binary is not installed/)
  })

  it('reports ok when disabled but the binary is installed', async () => {
    mockSearchEnabled = false
    mockSearchInstalled = true
    const results = await checkSearchAdapter()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/Search disabled/)
  })

  it('reports error when enabled but the binary is missing', async () => {
    mockSearchEnabled = true
    mockSearchInstalled = false
    const results = await checkSearchAdapter()
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/Search enabled but active search adapter binary was not found/)
  })

  it('reports ok when the live adapter is available', async () => {
    // The check asks the ADAPTER, not a hardcoded HTTP endpoint — the old
    // probe hit the pre-0.2 /api/v1/status path, which a healthy v0.2 zig
    // server does not serve, so doctor reported a false error on every run.
    mockSearchEnabled = true
    mockSearchInstalled = true
    mockSearchAvailable = true
    const results = await checkSearchAdapter()
    // Row 0 is the supervision status (D3); the connection row follows.
    expect(results[0].message).toMatch(/supervised via launchd/)
    const connection = results.find(r => /connected|unavailable/.test(r.message))!
    expect(connection.status).toBe('ok')
    expect(connection.message).toMatch(/connected/)
  })

  it('reports error when the adapter is unavailable', async () => {
    mockSearchEnabled = true
    mockSearchInstalled = true
    mockSearchAvailable = false
    const results = await checkSearchAdapter()
    const connection = results.find(r => /connected|unavailable/.test(r.message))!
    expect(connection.status).toBe('error')
    expect(connection.message).toMatch(/unavailable/)
  })
})

// ─── checkSearchOutbox ────────────────────────────────────────────────────

describe('checkSearchOutbox', () => {
  it('returns nothing when search is disabled', async () => {
    mockSearchEnabled = false
    expect(await checkSearchOutbox()).toEqual([])
  })

  it('reports ok on an empty journal', async () => {
    mockSearchEnabled = true
    mockOutboxStats = { pending: 0, inflight: 0, quarantined: 0, oldestPendingEnqueuedAt: null }
    const results = await checkSearchOutbox()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/journal empty/i)
  })

  it('warns on stale pending rows (engine likely down)', async () => {
    mockSearchEnabled = true
    mockOutboxStats = { pending: 4, inflight: 0, quarantined: 0, oldestPendingEnqueuedAt: Date.now() - 15 * 60_000 }
    const results = await checkSearchOutbox()
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/queued for/)
  })

  it('errors on quarantined rows and repair revives them', async () => {
    mockSearchEnabled = true
    mockQuarantinedRows = [{ logicalTable: 'bakin_t', key: 'k1', lastError: 'schema mismatch' }]
    mockOutboxStats = { pending: 0, inflight: 0, quarantined: 1, oldestPendingEnqueuedAt: null }
    const results = await checkSearchOutbox()
    expect(results[0].status).toBe('error')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/bakin_t\/k1/)

    const repair = searchOutboxRepair()
    const plan = await repair.plan(results)
    expect(plan[0]?.safety).toBe('manual')
    const applied = await repair.apply(plan)
    expect(applied[0]?.status).toBe('applied')
    expect(applied[0]?.message).toMatch(/Revived 1/)
    mockQuarantinedRows = []
    mockOutboxStats = { pending: 0, inflight: 0, quarantined: 0, oldestPendingEnqueuedAt: null }
  })
})

// ─── checkSearchConsistency ───────────────────────────────────────────────

describe('checkSearchConsistency', () => {
  it('returns nothing when the engine is down (base check owns that)', async () => {
    mockSearchEnabled = true
    mockSearchAvailable = false
    expect(await checkSearchConsistency()).toEqual([])
    mockSearchAvailable = true
  })

  it('errors on a PARKED migration as auto-fixable', async () => {
    mockSearchEnabled = true
    mockSearchAvailable = true
    mockTableStates = [{ logical: 'bakin_t', physical: 'bakin_t_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_t_v3_aa', phase: 'parked', backfillDone: 10 }]
    const results = await checkSearchConsistency()
    const parked = results.find(r => /PARKED/.test(r.message))!
    expect(parked.status).toBe('error')
    expect(parked.autoFixable).toBe(true)
    mockTableStates = []
  })

  it('warns on an in-flight migration without flagging repair', async () => {
    mockSearchEnabled = true
    mockSearchAvailable = true
    mockTableStates = [{ logical: 'bakin_t', physical: 'bakin_t_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_t_v3_aa', phase: 'backfilling', backfillDone: 42 }]
    const results = await checkSearchConsistency()
    const row = results.find(r => /in flight/.test(r.message))!
    expect(row.status).toBe('warn')
    expect(row.autoFixable).toBe(false)
    mockTableStates = []
  })
})

// ─── checkAndSyncSkill ────────────────────────────────────────────────────

describe('checkAndSyncSkill', () => {
  it('uses the embedded skill template when the source checkout template is missing', async () => {
    const projectRoot = pathJoin(testDir, 'project-no-skill')
    mkdirSync(projectRoot, { recursive: true })
    const results = await checkAndSyncSkill(projectRoot, mockRuntime)
    expect(results[0].check).toBe('skill')
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/not installed in runtime/)
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

  it('installs the skill through explicit repair when missing', async () => {
    const projectRoot = pathJoin(testDir, 'project-install')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(
      join(projectRoot, 'skill', 'SKILL.md'),
      '# Bakin Skill\n<!-- bakin:exec-tools:start -->\n<!-- bakin:exec-tools:end -->\n',
    )
    const results = await checkAndSyncSkill(projectRoot, mockRuntime)
    expect(results[0].status).toBe('warn')
    const applied = await syncSkillRepair(projectRoot, mockRuntime).apply(
      await syncSkillRepair(projectRoot, mockRuntime).plan(results),
    )
    expect(applied[0].status).toBe('applied')
    expect(applied[0].message).toMatch(/installed in runtime/)
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
  it('registers all system health checks on activate', async () => {
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
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
      runtime: createMockRuntimeAdapter(),
    }
    await healthPlugin.activate(ctx as unknown as Parameters<typeof healthPlugin.activate>[0])

    // Health-owned checks plus the 2 core managed-block scopes.
    expect(registeredIds).toContain('content-dir')
    expect(registeredIds).toContain('service')
    expect(registeredIds).toContain('runtime')
    expect(registeredIds).toContain('channel-approvals')
    expect(registeredIds).toContain('channel-aliases')
    expect(registeredIds).toContain('restart-recovery')
    expect(registeredIds).toContain('search')
    expect(registeredIds).toContain('skill')
    expect(registeredIds).toContain('plugin-assets')
    expect(registeredIds).toContain('plugin-registry')
  })
})
