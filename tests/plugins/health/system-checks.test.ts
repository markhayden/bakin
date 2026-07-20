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
import type { SearchHealthSnapshot } from '@makinbakin/sdk/types'

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
let mockTableStatsError: Error | null = null
let mockTableStats: { table: string; documents: number } | null = { table: 't', documents: 1 }
async function readMockTableStats() {
  if (mockTableStatsError) throw mockTableStatsError
  return mockTableStats
}
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
  sweepOrphanEngineTables: async () => ({ dropped: [], pending: 0, unclaimed: [] }),
  ensureTable: async () => 'unchanged',
  rebuildTable: async () => 'migrated',
  resumeMigrations: async () => {},
  resetTablesForTests: () => {},
}))
let mockRebuiltLogicalTables: string[] = []
mock.module('../../../src/core/search-registry', () => ({
  rebuildRegisteredTables: async (logical: string) => {
    mockRebuiltLogicalTables.push(logical)
    return [{ table: logical, result: 'migrated', indexed: 1 }]
  },
}))
let mockOrphanSweepError: Error | null = null
let mockOrphanSweepCalls = 0
mock.module('../../../src/core/search-orphan-sweep', () => ({
  runOrphanSweep: async () => {
    mockOrphanSweepCalls++
    if (mockOrphanSweepError) throw mockOrphanSweepError
    return []
  },
  sweepOrphanRegistryRows: async () => [],
}))
let mockSearchHealthError: Error | null = null
let mockSearchHealth: SearchHealthSnapshot = {
  enabled: true,
  tables: [{
    logical: 'bakin_tasks', physical: 'bakin_tasks_v1', schemaVersion: 1, state: 'active', phase: null,
    pluginId: 'tasks', docCount: 3, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0,
    legs: [], healthy: true,
  }],
}
mock.module('../../../src/core/search-reindex', () => ({
  getSearchHealth: async () => {
    if (mockSearchHealthError) throw mockSearchHealthError
    return mockSearchHealth
  },
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
    dispatch: { paused: false },
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
    search: { available: async () => mockSearchAvailable, tables: { stats: readMockTableStats } },
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
    search: { available: async () => mockSearchAvailable, tables: { stats: readMockTableStats } },
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
    search: { available: async () => mockSearchAvailable, tables: { stats: readMockTableStats } },
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
    search: { available: async () => mockSearchAvailable, tables: { stats: readMockTableStats } },
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
    search: { available: async () => mockSearchAvailable, tables: { stats: readMockTableStats } },
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
mock.module('@bakin/core/app-services', () => ({}))
mock.module('../../../src/core/doctor', () => ({
  getLastReport: () => null,
  runDiagnostics: async () => ({ results: [], summary: { total: 0, errors: 0, warnings: 0 } }),
  runTargetedDiagnostics: async () => ({ observations: [], incidents: [], checks: [] }),
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
import { checkSearchOutboxObservations, searchOutboxRepair } from '../../../plugins/health/lib/system-checks/search-outbox'
import {
  checkSearchConsistency,
  resetSearchConsistencyStateForTests,
  searchConsistencyRepair,
} from '../../../plugins/health/lib/system-checks/search-consistency'
import { checkAndSyncSkill, syncSkillRepair } from '../../../plugins/health/lib/system-checks/sync-skill'
import { checkPluginAssets } from '../../../plugins/health/lib/system-checks/plugin-assets'
import { createMockRuntimeAdapter, mockChannels } from '@bakin/core/adapters/runtime/testing'
import type { AgentRuntimeAdapter, RuntimeSkill } from '@bakin/core/adapters/runtime'
import type { HealthCheckRunInput, HealthRepairTarget } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

let mockRuntime: AgentRuntimeAdapter
let runtimeWorkspaceFiles: Map<string, string>
let runtimeSkill: RuntimeSkill | null

function runtimeFileKey(agentId: string, path: string): string {
  return `${agentId}:${path}`
}

function makeHealthRuntime(): AgentRuntimeAdapter {
  // Channel-check describes mutate runtime.channels — explicit opt-in (R24).
  const runtime = createMockRuntimeAdapter({ channels: mockChannels() })
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

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

const repairTarget: HealthRepairTarget = {
  type: 'observations',
  reportId: 'report-test',
  ids: ['health.search:journal.quarantined'],
}

function searchConsistencyTarget(logical: string): HealthRepairTarget {
  return {
    type: 'observations',
    reportId: 'report-test',
    ids: [`health.search-consistency:indexes.table:${logical}`],
  }
}

function searchConsistencyIncidentTarget(logical: string): HealthRepairTarget {
  return {
    type: 'incidents',
    reportId: 'report-test',
    ids: [`health:search:migration-parked:${logical}`],
  }
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
  mockTableStates = []
  mockRebuiltLogicalTables = []
  mockTableStatsError = null
  mockTableStats = { table: 't', documents: 1 }
  mockOrphanSweepError = null
  mockOrphanSweepCalls = 0
  resetSearchConsistencyStateForTests()
  mockSearchHealthError = null
  mockSearchHealth = {
    enabled: true,
    tables: [{
      logical: 'bakin_tasks', physical: 'bakin_tasks_v1', schemaVersion: 1, state: 'active', phase: null,
      pluginId: 'tasks', docCount: 3, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0,
      legs: [], healthy: true,
    }],
  }
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
  it('reports the resolved Bakin home path', async () => {
    const results = observed(await checkContentDir())
    expect(results).toHaveLength(1)
    expect(results[0].key).toBe('location')
    expect(results[0].status).toBe('healthy')
    expect(results[0].evidence?.path).toBe(testDir)
  })
})

// ─── checkService ─────────────────────────────────────────────────────────

describe('checkService', () => {
  it('returns not-applicable when service.enabled is false', async () => {
    mockServiceEnabled = false
    const result = await checkService('/some/project')
    expect(result).toEqual({ outcome: 'not_applicable', reason: expect.stringContaining('disabled in settings') })
  })

  it('returns not-applicable on non-darwin platforms even when enabled', async () => {
    if (process.platform === 'darwin') return // platform-specific; skip on macOS
    mockServiceEnabled = true
    const result = await checkService('/some/project')
    expect(result).toEqual({ outcome: 'not_applicable', reason: expect.stringContaining('only available on macOS') })
  })

  it('warns when the LaunchAgent plist is missing', async () => {
    if (process.platform !== 'darwin') return
    mockServiceEnabled = true
    // Override HOME so plistPath resolves under the temp dir (with no plist)
    const previousHome = process.env.HOME
    process.env.HOME = testDir
    try {
      const results = observed(await checkService('/some/project'))
      expect(results.some((row) => row.status === 'warning' && row.key === 'plist')).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('flags a stale WorkingDirectory in the plist', async () => {
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
      const results = observed(await checkService('/new/project'))
      expect(results.some((row) => row.status === 'error' && row.detail?.includes('/old/path'))).toBe(true)
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })

  it('accepts binary LaunchAgent plists for the current service label', async () => {
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
      const results = observed(await checkService('/Users/tester/.bakin'))
      expect(results.some((row) => row.key === 'plist')).toBe(false)
      expect(results.some((row) => row.status === 'error')).toBe(false)
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
    const results = observed(await checkRuntime(mockRuntime))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toMatch(/can serve turns/)
  })

  it('reports error when ping returns false', async () => {
    mockRuntime.ping = async () => false
    const results = observed(await checkRuntime(mockRuntime))
    expect(results[0].status).toBe('error')
    expect(results[0].summary).toMatch(/cannot serve turns/)
  })

  it('reports error when ping throws', async () => {
    mockRuntime.ping = async () => {
      throw new Error('connection refused')
    }
    const results = observed(await checkRuntime(mockRuntime))
    expect(results[0].status).toBe('error')
    expect(results[0].detail).toMatch(/connection refused/)
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

    const results = observed(await checkChannelApprovals(mockRuntime))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('healthy')
    expect(results[0].detail).toContain('Discord')
  })

  it('warns when channel approvals are render-only', async () => {
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message', 'rich-content'],
    }]

    const results = observed(await checkChannelApprovals(mockRuntime))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warning')
    expect(results[0].summary).toMatch(/render-only/)
  })

  it('warns when channel capabilities cannot be inspected', async () => {
    mockRuntime.channels!.list = async () => {
      throw new Error('channel registry unavailable')
    }

    const results = observed(await checkChannelApprovals(mockRuntime))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('unknown')
    expect(results[0].detail).toMatch(/channel registry unavailable/)
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

    const results = observed(await checkChannelAliases(mockRuntime))
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toContain('No channel aliases')
  })

  it('reports ok when aliases target available runtime channels', async () => {
    mockChannelAliases = { general: 'discord:channel-123' }
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = observed(await checkChannelAliases(mockRuntime))
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toContain('1 channel alias')
  })

  it('warns when an alias targets an unavailable runtime channel', async () => {
    mockChannelAliases = { general: 'slack:channel-123' }
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = observed(await checkChannelAliases(mockRuntime))
    expect(results[0].status).toBe('warning')
    expect(results[0].detail).toContain('unavailable runtime channel')
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

    const results = observed(await checkChannelAliases(mockRuntime))
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toContain('1 channel alias')
  })

  it('warns when the configured alert channel is a missing alias', async () => {
    mockNotificationChannel = 'general'
    mockRuntime.channels!.list = async () => [{
      id: 'discord',
      platform: 'discord',
      label: 'Discord',
      capabilities: ['message'],
    }]

    const results = observed(await checkChannelAliases(mockRuntime))
    expect(results[0].status).toBe('warning')
    expect(results[0].detail).toContain('notifications.channelAliases.general')
  })
})

// ─── checkSearchAdapter ───────────────────────────────────────────────────

describe('checkSearchAdapter', () => {
  it('errors when Search is disabled, independent of binary state', async () => {
    mockSearchEnabled = false
    mockSearchInstalled = false
    const results = observed(await checkSearchAdapter())
    expect(results[0].status).toBe('error')
    expect(results[0].key).toBe('engine.enabled')
    expect(results[0].incident?.resolution).toMatchObject({ type: 'instructions' })
  })

  it('still reports disabled when the binary is installed', async () => {
    mockSearchEnabled = false
    mockSearchInstalled = true
    const results = observed(await checkSearchAdapter())
    expect(results[0].status).toBe('error')
    expect(results[0].summary).toMatch(/Search is disabled/)
  })

  it('reports error when enabled but the binary is missing', async () => {
    mockSearchEnabled = true
    mockSearchInstalled = false
    const results = observed(await checkSearchAdapter())
    expect(results[0].status).toBe('error')
    expect(results[0].key).toBe('engine.binary')
    expect(results[0].summary).toMatch(/binary is missing/)
  })

  it('reports ok when the live adapter is available', async () => {
    // The check asks the ADAPTER, not a hardcoded HTTP endpoint — the old
    // probe hit the pre-0.2 /api/v1/status path, which a healthy v0.2 zig
    // server does not serve, so doctor reported a false error on every run.
    mockSearchEnabled = true
    mockSearchInstalled = true
    mockSearchAvailable = true
    const results = observed(await checkSearchAdapter())
    expect(results.find((row) => row.key === 'engine.supervision')?.summary).toMatch(/supervised via launchd/)
    expect(results.find((row) => row.key === 'engine.connection')?.status).toBe('healthy')
    expect(results.find((row) => row.key === 'indexes.tables')).toMatchObject({
      status: 'healthy',
      evidence: { tableCount: 1, totalDocuments: 3 },
    })
    expect(results.find((row) => row.key.startsWith('journal.'))?.status).toBe('healthy')
  })

  it('preserves empty and unreadable table-stat signals in the consolidated Indexes source', async () => {
    mockSearchEnabled = true
    mockSearchInstalled = true
    mockSearchAvailable = true
    mockSearchHealth = {
      enabled: true,
      tables: [
        {
          logical: 'bakin_memory', physical: 'bakin_memory_v1', schemaVersion: 1, state: 'active', phase: null,
          pluginId: 'memory', docCount: null, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0,
          legs: [], healthy: true,
        },
        {
          logical: 'bakin_schedule', physical: 'bakin_schedule_v1', schemaVersion: 1, state: 'active', phase: null,
          pluginId: 'schedule', docCount: 0, lastIndexedAt: null, lastRebuildAt: null, journalPending: 0,
          legs: [], healthy: true,
        },
      ],
    }

    const row = observed(await checkSearchAdapter()).find((candidate) => candidate.key === 'indexes.tables')!
    expect(row).toMatchObject({
      status: 'warning',
      evidence: {
        tableCount: 2,
        totalDocuments: 0,
        emptyTables: ['bakin_schedule'],
        unreadableTables: ['bakin_memory'],
      },
    })
  })

  it('reports no registered content types and table-health failures explicitly', async () => {
    mockSearchEnabled = true
    mockSearchInstalled = true
    mockSearchAvailable = true
    mockSearchHealth = { enabled: true, tables: [] }
    let row = observed(await checkSearchAdapter()).find((candidate) => candidate.key === 'indexes.tables')!
    expect(row.status).toBe('warning')
    expect(row.summary).toContain('No Search content types')

    mockSearchHealthError = new Error('table stats timed out')
    row = observed(await checkSearchAdapter()).find((candidate) => candidate.key === 'indexes.availability')!
    expect(row.status).toBe('unknown')
    expect(row.detail).toContain('table stats timed out')
  })

  it('reports error when the adapter is unavailable', async () => {
    mockSearchEnabled = true
    mockSearchInstalled = true
    mockSearchAvailable = false
    const results = observed(await checkSearchAdapter())
    const connection = results.find((row) => row.key === 'engine.connection')!
    expect(connection.status).toBe('error')
    expect(connection.summary).toMatch(/unavailable/)
  })
})

// ─── checkSearchOutbox ────────────────────────────────────────────────────

describe('Search write-journal observations', () => {
  it('reports healthy on an empty journal', async () => {
    mockSearchEnabled = true
    mockOutboxStats = { pending: 0, inflight: 0, quarantined: 0, oldestPendingEnqueuedAt: null }
    const results = await checkSearchOutboxObservations()
    expect(results[0].status).toBe('healthy')
    expect(results[0].key).toBe('journal.status')
  })

  it('warns on stale pending rows (engine likely down)', async () => {
    mockSearchEnabled = true
    mockOutboxStats = { pending: 4, inflight: 0, quarantined: 0, oldestPendingEnqueuedAt: Date.now() - 15 * 60_000 }
    const results = await checkSearchOutboxObservations()
    expect(results[0].status).toBe('warning')
    expect(results[0].summary).toMatch(/queued for/)
  })

  it('errors on quarantined rows and repair revives them', async () => {
    mockSearchEnabled = true
    mockQuarantinedRows = [{ logicalTable: 'bakin_t', key: 'k1', lastError: 'schema mismatch' }]
    mockOutboxStats = { pending: 0, inflight: 0, quarantined: 1, oldestPendingEnqueuedAt: null }
    const results = await checkSearchOutboxObservations()
    expect(results[0].status).toBe('error')
    expect(results[0].incident?.resolution).toMatchObject({ type: 'repair', actionId: 'search-outbox-revive' })
    expect(results[0].evidence).toEqual({ quarantined: 1, sampleTables: ['bakin_t'] })

    const repair = searchOutboxRepair()
    const plan = await repair.plan(repairTarget)
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
    expect(await checkSearchConsistency()).toMatchObject({ outcome: 'not_applicable' })
    mockSearchAvailable = true
  })

  it('errors on a PARKED migration with an explicit repair action', async () => {
    mockSearchEnabled = true
    mockSearchAvailable = true
    mockTableStates = [{ logical: 'bakin_t', physical: 'bakin_t_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_t_v3_aa', phase: 'parked', backfillDone: 10 }]
    const results = observed(await checkSearchConsistency())
    const parked = results.find((row) => row.key === 'indexes.table:bakin_t')!
    expect(parked.status).toBe('error')
    expect(parked.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'search-consistency-rebuild' })
    mockTableStates = []
  })

  it('warns on an in-flight migration without flagging repair', async () => {
    mockSearchEnabled = true
    mockSearchAvailable = true
    mockTableStates = [{ logical: 'bakin_t', physical: 'bakin_t_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_t_v3_aa', phase: 'backfilling', backfillDone: 42 }]
    const results = observed(await checkSearchConsistency())
    const row = results.find((observation) => observation.key === 'indexes.table:bakin_t')!
    expect(row.status).toBe('warning')
    expect(row.incident?.disposition).toBe('watch')
    mockTableStates = []
  })

  it('does not rebuild an index when its engine evidence cannot be read', async () => {
    mockSearchEnabled = true
    mockTableStates = [{ logical: 'bakin_t', physical: 'bakin_t_v2_ff', schemaVersion: 2, state: 'active' }]
    mockTableStatsError = new Error('engine timed out')

    const repair = searchConsistencyRepair()
    const outcomes = await repair.apply(await repair.plan(searchConsistencyTarget('bakin_t')))

    expect(outcomes).toEqual([
      expect.objectContaining({
        status: 'failed',
        message: 'engine timed out',
      }),
    ])
  })

  it('still targets an index when the engine explicitly reports it missing', async () => {
    mockSearchEnabled = true
    mockTableStates = [{ logical: 'bakin_t', physical: 'bakin_t_v2_ff', schemaVersion: 2, state: 'active' }]
    mockTableStats = null

    const repair = searchConsistencyRepair()
    const outcomes = await repair.apply(await repair.plan(searchConsistencyTarget('bakin_t')))

    expect(outcomes[0]?.message).toContain('bakin_t:')
  })

  it('rebuilds only the exact inconsistent index selected in the repair target', async () => {
    mockSearchEnabled = true
    mockTableStates = [
      { logical: 'bakin_selected', physical: 'bakin_selected_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_selected_v3_aa', phase: 'parked' },
      { logical: 'bakin_unrelated', physical: 'bakin_unrelated_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_unrelated_v3_aa', phase: 'parked' },
    ]

    const repair = searchConsistencyRepair()
    const plan = await repair.plan(searchConsistencyIncidentTarget('bakin_selected'))
    const outcomes = await repair.apply(plan)

    expect(plan).toHaveLength(1)
    expect(plan[0]?.observationIds).toEqual(['health.search-consistency:indexes.table:bakin_selected'])
    expect(plan[0]?.changes).toEqual([
      expect.objectContaining({ target: 'bakin_selected' }),
    ])
    expect(mockRebuiltLogicalTables).toEqual(['bakin_selected'])
    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'applied', message: 'bakin_selected: migrated' }),
    ])
  })

  it('skips a selected index that recovered without rebuilding another inconsistent index', async () => {
    mockSearchEnabled = true
    mockTableStates = [
      { logical: 'bakin_selected', physical: 'bakin_selected_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_selected_v3_aa', phase: 'parked' },
      { logical: 'bakin_unrelated', physical: 'bakin_unrelated_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_unrelated_v3_aa', phase: 'parked' },
    ]

    const repair = searchConsistencyRepair()
    const plan = await repair.plan(searchConsistencyTarget('bakin_selected'))
    mockTableStates = [
      { logical: 'bakin_selected', physical: 'bakin_selected_v3_aa', schemaVersion: 3, state: 'active' },
      { logical: 'bakin_unrelated', physical: 'bakin_unrelated_v2_ff', schemaVersion: 2, state: 'migrating', migratingTo: 'bakin_unrelated_v3_aa', phase: 'parked' },
    ]

    const outcomes = await repair.apply(plan)

    expect(mockRebuiltLogicalTables).toEqual([])
    expect(outcomes).toEqual([
      expect.objectContaining({ status: 'skipped', message: 'bakin_selected no longer needs rebuilding.' }),
    ])
  })

  it('retries a failed deep sweep immediately instead of hiding it for an hour', async () => {
    mockSearchEnabled = true
    mockOrphanSweepError = new Error('registry read failed')

    const failed = observed(await checkSearchConsistency())
    expect(failed).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'indexes.sweep', status: 'unknown' }),
    ]))

    mockOrphanSweepError = null
    const retried = observed(await checkSearchConsistency())

    expect(mockOrphanSweepCalls).toBe(2)
    expect(retried.some((row) => row.key === 'indexes.sweep')).toBe(false)
  })
})

// ─── checkAndSyncSkill ────────────────────────────────────────────────────

describe('checkAndSyncSkill', () => {
  it('uses the embedded skill template when the source checkout template is missing', async () => {
    const projectRoot = pathJoin(testDir, 'project-no-skill')
    mkdirSync(projectRoot, { recursive: true })
    const results = observed(await checkAndSyncSkill(projectRoot, mockRuntime))
    expect(results[0].key).toBe('runtime-skill')
    expect(results[0].status).toBe('warning')
    expect(results[0].incident?.resolution).toMatchObject({ type: 'repair', actionId: 'sync-skill' })
    expect(results[0].summary).toMatch(/not installed/)
  })

  it('errors when the template is missing the exec-tools markers', async () => {
    const projectRoot = pathJoin(testDir, 'project-no-markers')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(join(projectRoot, 'skill', 'SKILL.md'), '# Bakin Skill\n(no markers)\n')
    const results = observed(await checkAndSyncSkill(projectRoot, mockRuntime))
    expect(results[0].status).toBe('unknown')
    expect(results[0].detail).toMatch(/missing the .*markers/)
  })

  it('warns when the rendered skill is not yet installed without mutating it', async () => {
    const projectRoot = pathJoin(testDir, 'project-ok')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(
      join(projectRoot, 'skill', 'SKILL.md'),
      '# Bakin Skill\n<!-- bakin:exec-tools:start -->\n<!-- bakin:exec-tools:end -->\n',
    )
    const results = observed(await checkAndSyncSkill(projectRoot, mockRuntime))
    expect(results[0].status).toBe('warning')
    expect(results[0].incident?.resolution).toMatchObject({ type: 'repair', actionId: 'sync-skill' })
    expect(results[0].summary).toMatch(/not installed/)
  })

  it('installs the skill through explicit repair when missing', async () => {
    const projectRoot = pathJoin(testDir, 'project-install')
    mkdirSync(join(projectRoot, 'skill'), { recursive: true })
    writeFileSync(
      join(projectRoot, 'skill', 'SKILL.md'),
      '# Bakin Skill\n<!-- bakin:exec-tools:start -->\n<!-- bakin:exec-tools:end -->\n',
    )
    const results = observed(await checkAndSyncSkill(projectRoot, mockRuntime))
    expect(results[0].status).toBe('warning')
    const applied = await syncSkillRepair(projectRoot, mockRuntime).apply(
      await syncSkillRepair(projectRoot, mockRuntime).plan({
        type: 'observations',
        reportId: 'report-test',
        ids: ['health.skill:runtime-skill'],
      }),
    )
    expect(applied[0].status).toBe('applied')
    expect(applied[0].message).toMatch(/synced/)
    expect(runtimeSkill?.instructions).toContain('<!-- bakin:exec-tools:start -->')
  })
})

// ─── checkPluginAssets ────────────────────────────────────────────────────

describe('checkPluginAssets', () => {
  it('reports ok when component check returns ok', async () => {
    mockPluginAssetsResult = { name: 'plugin-assets', status: 'ok', message: '3 plugin assets installed' }
    const results = observed(await checkPluginAssets())
    expect(results[0].key).toBe('runtime-assets')
    expect(results[0].status).toBe('healthy')
    expect(results[0].summary).toMatch(/3 plugin assets installed/)
  })

  it('warns with reminder when component reports drift', async () => {
    mockPluginAssetsResult = {
      name: 'plugin-assets',
      status: 'warn' as unknown as 'ok',
      message: '1 missing',
      // @ts-expect-error - extra field accepted at runtime
      remediation: 'Run `bakin install plugin-assets` to apply.',
    }
    const results = observed(await checkPluginAssets())
    expect(results[0].status).toBe('warning')
    expect(results[0].incident?.resolution).toMatchObject({
      type: 'instructions',
      command: 'bakin install plugin-assets',
    })
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers all system health checks on activate', async () => {
    const healthPlugin = (await import('../../../plugins/health')).default
    const registeredIds: string[] = []
    const actionIds: string[] = []
    const registrations: Array<{ id: string; description: string; group: { key: string; label: string }; maxAgeMs?: number }> = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'health',
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string; description: string; group: { key: string; label: string }; maxAgeMs?: number }) => {
        registeredIds.push(def.id)
        registrations.push(def)
        return `health.${def.id}`
      },
      registerHealthRepairAction: (def: { id: string }) => { actionIds.push(def.id); return `health.${def.id}` },
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

    expect(registeredIds).toHaveLength(23)
    expect(registeredIds).not.toContain('search-outbox')
    expect(registeredIds).toEqual(expect.arrayContaining([
      'content-dir', 'capabilities', 'github-readiness', 'service', 'runtime', 'session-store',
      'channel-approvals', 'channel-aliases', 'restart-recovery', 'execution-safety',
      'context.startup-size', 'budget', 'usage.agent-burn', 'search', 'dispatch.run-dirs',
      'search-consistency', 'search-spin', 'search-canary', 'search-engine-burn',
      'skill', 'plugin-assets', 'plugin-artifacts', 'plugin-registry',
    ]))
    expect(actionIds.sort()).toEqual([
      'search-canary-restart',
      'search-consistency-rebuild',
      'search-engine-burn-restart',
      'search-outbox-revive',
      'search-spin-rebuild',
      'sweep-run-dirs',
      'sync-skill',
    ])
    for (const registration of registrations) {
      expect(registration.description.length).toBeGreaterThan(0)
      expect(registration.group.key.length).toBeGreaterThan(0)
      expect(registration.group.label.length).toBeGreaterThan(0)
      expect(registration.maxAgeMs).toBeGreaterThan(0)
    }
  })
})
