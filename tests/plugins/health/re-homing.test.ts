/**
 * Re-homing table (spec §3.9, `.claude/specs/self-healing-health-and-updates-2026-10-inventories/re-homing.md`)
 * for the health plugin's NON-search system checks — rows 1–51 and 90–101.
 * For every row the declared family is asserted against the check's catalog
 * (id, subject kind, resolution, requirement); where a fake dependency can
 * reach the state, an emitted instance is asserted too (subject,
 * declarationId, resolution shape, effects → mode, required). Rows the
 * fakes cannot reach are catalog-only and say so. The search family
 * (rows 52–89) lives in re-homing-search.test.ts.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-health-re-homing-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, audit: join(testDir, 'audit.jsonl'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import type { HealthIncidentDeclaration, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { repairMode } from '../../../packages/core/src/health/repair-mode'
import { AGENT_BURN_INCIDENTS } from '../../../plugins/health/lib/system-checks/agent-burn'
import { CAPABILITIES_INCIDENTS } from '../../../plugins/health/lib/system-checks/capabilities'
import { CHANNEL_ALIASES_INCIDENTS } from '../../../plugins/health/lib/system-checks/channel-aliases'
import { CHANNEL_APPROVALS_INCIDENTS } from '../../../plugins/health/lib/system-checks/channel-approvals'
import { CONTENT_DIR_INCIDENTS } from '../../../plugins/health/lib/system-checks/content-dir'
import { CONTEXT_REPORT_INCIDENTS } from '../../../plugins/health/lib/system-checks/context-report'
import { DELIVERY_DISCORD_INCIDENTS, discordBridgeReconnectRepair } from '../../../plugins/health/lib/system-checks/delivery-discord'
import { EXECUTION_SAFETY_INCIDENTS } from '../../../plugins/health/lib/system-checks/execution-safety'
import { GITHUB_READINESS_INCIDENTS, checkGithubReadiness } from '../../../plugins/health/lib/system-checks/github-readiness'
import { HEALTH_ACKS_INCIDENTS, healthAcksPruneRepair, healthAcksResetRepair } from '../../../plugins/health/lib/system-checks/health-acks'
import { MEDIA_INCIDENTS, checkMediaSharp, mediaStoreRepair } from '../../../plugins/health/lib/system-checks/media'
import { packageReinstallRepair, packageSyncRepair } from '../../../plugins/health/lib/system-checks/package-repairs'
import { PLUGIN_ARTIFACTS_INCIDENTS, pluginReinstallRepair, pluginUpgradeRepair } from '../../../plugins/health/lib/system-checks/plugin-artifacts'
import { PLUGIN_ASSETS_INCIDENTS, installPluginAssetsRepair } from '../../../plugins/health/lib/system-checks/plugin-assets'
import { PLUGIN_REGISTRY_INCIDENTS } from '../../../plugins/health/lib/system-checks/plugin-registry'
import { RESTART_RECOVERY_INCIDENTS, requeueStrandedTasksRepair } from '../../../plugins/health/lib/system-checks/restart-recovery'
import { RUN_DIRS_INCIDENTS, runDirsSweepRepair } from '../../../plugins/health/lib/system-checks/run-dirs'
import { RUNTIME_INCIDENTS, checkRuntime, runtimeRestartRepair } from '../../../plugins/health/lib/system-checks/runtime'
import { SERVICE_INCIDENTS, serviceSetupRepair } from '../../../plugins/health/lib/system-checks/service'
import { SESSION_STORE_ERROR_BYTES, SESSION_STORE_INCIDENTS, SESSION_STORE_WARN_BYTES, checkSessionStore, sessionStorePruneRepair } from '../../../plugins/health/lib/system-checks/session-store'
import { SPEND_POLICY_INCIDENTS } from '../../../plugins/health/lib/system-checks/spend-policy'
import { SKILL_INCIDENTS, syncSkillRepair } from '../../../plugins/health/lib/system-checks/sync-skill'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

type Row = {
  row: number
  catalog: HealthIncidentDeclaration[]
  id: string
  subjectKind: HealthIncidentDeclaration['subjectKind']
  resolution: HealthIncidentDeclaration['resolution']
  required: HealthIncidentDeclaration['required']
}

/** Every declared family of the owner's rows, as the table reads. */
const ROWS: Row[] = [
  { row: 1, catalog: HEALTH_ACKS_INCIDENTS, id: 'store-unreadable', subjectKind: 'record', resolution: { type: 'repair', actionId: 'health-acks-reset' }, required: 'never' },
  { row: 2, catalog: HEALTH_ACKS_INCIDENTS, id: 'invalid-records', subjectKind: 'record', resolution: { type: 'repair', actionId: 'health-acks-prune' }, required: 'never' },
  { row: 3, catalog: MEDIA_INCIDENTS, id: 'media-store-broken', subjectKind: 'system', resolution: { type: 'repair', actionId: 'media-install-store' }, required: 'always' },
  { row: 4, catalog: MEDIA_INCIDENTS, id: 'media-store-missing', subjectKind: 'system', resolution: { type: 'repair', actionId: 'media-install-store' }, required: 'always' },
  { row: 6, catalog: CAPABILITIES_INCIDENTS, id: 'not-ready-sync', subjectKind: 'package', resolution: { type: 'repair', actionId: 'package-sync' }, required: 'owner-decides' },
  { row: 6, catalog: CAPABILITIES_INCIDENTS, id: 'not-ready-reinstall', subjectKind: 'package', resolution: { type: 'repair', actionId: 'package-reinstall' }, required: 'owner-decides' },
  { row: 6, catalog: CAPABILITIES_INCIDENTS, id: 'not-ready-credential', subjectKind: 'package', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
  { row: 6, catalog: CAPABILITIES_INCIDENTS, id: 'not-ready-install', subjectKind: 'package', resolution: { type: 'human', needs: 'external-install' }, required: 'owner-decides' },
  { row: 7, catalog: GITHUB_READINESS_INCIDENTS, id: 'authentication-required', subjectKind: 'system', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
  { row: 8, catalog: SERVICE_INCIDENTS, id: 'plist-missing', subjectKind: 'service', resolution: { type: 'repair', actionId: 'service-setup' }, required: 'always' },
  { row: 9, catalog: SERVICE_INCIDENTS, id: 'plist-stale', subjectKind: 'service', resolution: { type: 'repair', actionId: 'service-setup' }, required: 'always' },
  { row: 11, catalog: SERVICE_INCIDENTS, id: 'service-unloaded', subjectKind: 'service', resolution: { type: 'repair', actionId: 'service-setup' }, required: 'always' },
  { row: 12, catalog: RUNTIME_INCIDENTS, id: 'unreachable', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'runtime-restart' }, required: 'always' },
  { row: 14, catalog: SESSION_STORE_INCIDENTS, id: 'oversized', subjectKind: 'agent', resolution: { type: 'repair', actionId: 'session-store-prune' }, required: 'always' },
  { row: 20, catalog: CHANNEL_ALIASES_INCIDENTS, id: 'invalid-aliases', subjectKind: 'setting', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { row: 21, catalog: DELIVERY_DISCORD_INCIDENTS, id: 'missing-token', subjectKind: 'channel', resolution: { type: 'human', needs: 'credential' }, required: 'always' },
  { row: 22, catalog: DELIVERY_DISCORD_INCIDENTS, id: 'missing-guild', subjectKind: 'channel', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
  { row: 24, catalog: DELIVERY_DISCORD_INCIDENTS, id: 'bridge-failed', subjectKind: 'channel', resolution: { type: 'repair', actionId: 'discord-bridge-reconnect' }, required: 'always' },
  { row: 24, catalog: DELIVERY_DISCORD_INCIDENTS, id: 'bridge-failed-credential', subjectKind: 'channel', resolution: { type: 'human', needs: 'credential' }, required: 'always' },
  { row: 25, catalog: DELIVERY_DISCORD_INCIDENTS, id: 'bridge-disconnected', subjectKind: 'channel', resolution: { type: 'repair', actionId: 'discord-bridge-reconnect' }, required: 'always' },
  { row: 26, catalog: DELIVERY_DISCORD_INCIDENTS, id: 'guild-unjoined', subjectKind: 'channel', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { row: 29, catalog: RESTART_RECOVERY_INCIDENTS, id: 'stale-tasks', subjectKind: 'system', resolution: { type: 'repair', actionId: 'requeue-stranded-tasks' }, required: 'always' },
  { row: 31, catalog: EXECUTION_SAFETY_INCIDENTS, id: 'ledger-unavailable', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  { row: 34, catalog: RUN_DIRS_INCIDENTS, id: 'no-sweep-yet', subjectKind: 'system', resolution: { type: 'repair', actionId: 'sweep-run-dirs' }, required: 'never' },
  { row: 35, catalog: RUN_DIRS_INCIDENTS, id: 'over-budget', subjectKind: 'system', resolution: { type: 'repair', actionId: 'sweep-run-dirs' }, required: 'always' },
  { row: 39, catalog: SPEND_POLICY_INCIDENTS, id: 'policy-unavailable', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  { row: 40, catalog: SPEND_POLICY_INCIDENTS, id: 'policy-invalid', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
  { row: 44, catalog: AGENT_BURN_INCIDENTS, id: 'ledger-unavailable', subjectKind: 'system', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  { row: 50, catalog: AGENT_BURN_INCIDENTS, id: 'runaway-usage', subjectKind: 'agent', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { row: 91, catalog: SKILL_INCIDENTS, id: 'outdated', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'sync-skill' }, required: 'always' },
  { row: 91, catalog: SKILL_INCIDENTS, id: 'missing', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'sync-skill' }, required: 'always' },
  { row: 93, catalog: PLUGIN_ASSETS_INCIDENTS, id: 'plugin-bins-invalid-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-upgrade' }, required: 'always' },
  { row: 93, catalog: PLUGIN_ASSETS_INCIDENTS, id: 'plugin-bins-invalid', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-reinstall' }, required: 'always' },
  { row: 94, catalog: PLUGIN_ASSETS_INCIDENTS, id: 'user-edited-drifted', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'install-plugin-assets' }, required: 'never' },
  { row: 94, catalog: PLUGIN_ASSETS_INCIDENTS, id: 'skill-source-invalid', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-reinstall' }, required: 'never' },
  { row: 94, catalog: PLUGIN_ASSETS_INCIDENTS, id: 'skill-source-invalid-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-upgrade' }, required: 'never' },
  { row: 95, catalog: PLUGIN_ASSETS_INCIDENTS, id: 'assets-out-of-sync', subjectKind: 'system', resolution: { type: 'repair', actionId: 'install-plugin-assets' }, required: 'always' },
  { row: 97, catalog: PLUGIN_ARTIFACTS_INCIDENTS, id: 'needs-update', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-upgrade' }, required: 'always' },
  { row: 98, catalog: PLUGIN_ARTIFACTS_INCIDENTS, id: 'needs-update-blocked', subjectKind: 'plugin', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' },
  { row: 99, catalog: PLUGIN_ARTIFACTS_INCIDENTS, id: 'needs-update-reinstall', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-reinstall' }, required: 'always' },
  { row: 99, catalog: PLUGIN_ARTIFACTS_INCIDENTS, id: 'invalid', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-reinstall' }, required: 'always' },
  { row: 99, catalog: PLUGIN_ARTIFACTS_INCIDENTS, id: 'invalid-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-upgrade' }, required: 'always' },
  { row: 101, catalog: PLUGIN_REGISTRY_INCIDENTS, id: 'activation-failed-upgrade', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'plugin-upgrade' }, required: 'always' },
  { row: 101, catalog: PLUGIN_REGISTRY_INCIDENTS, id: 'activation-failed', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
]

/** Observation-only rows: their check declares NO family for them. */
const OBSERVATION_ROWS: Array<{ rows: string; catalog: HealthIncidentDeclaration[]; absent: string[] }> = [
  { rows: '5', catalog: MEDIA_INCIDENTS, absent: ['unsupported-platform'] },
  { rows: '10', catalog: SERVICE_INCIDENTS, absent: ['plist-unreadable'] },
  { rows: '13, 15, 16', catalog: SESSION_STORE_INCIDENTS, absent: ['inspection-failed', 'growing', 'orphaned'] },
  { rows: '17–18', catalog: CHANNEL_APPROVALS_INCIDENTS, absent: ['inspection-failed', 'render-only'] },
  { rows: '19', catalog: CHANNEL_ALIASES_INCIDENTS, absent: ['inspection-failed'] },
  { rows: '23, 27, 28', catalog: DELIVERY_DISCORD_INCIDENTS, absent: ['connecting', 'empty-approvers', 'empty-inbound-allowlist'] },
  { rows: '30', catalog: RESTART_RECOVERY_INCIDENTS, absent: ['inspection-failed'] },
  { rows: '32–33', catalog: EXECUTION_SAFETY_INCIDENTS, absent: ['audit-unreadable', 'duplicates-suppressed'] },
  { rows: '36–38', catalog: CONTEXT_REPORT_INCIDENTS, absent: ['runtime-unavailable', 'main-agent-unavailable', 'over-budget'] },
  { rows: '41', catalog: SPEND_POLICY_INCIDENTS, absent: ['policy-unanswered'] },
  { rows: '42–43, 45–49, 51', catalog: AGENT_BURN_INCIDENTS, absent: ['token-metering-incomplete', 'cost-aggregate-unrepresentable', 'evaluation-failed', 'transcript-coverage-incomplete', 'interactive-usage', 'unexplained-usage', 'unusual-burn'] },
  { rows: '90', catalog: SKILL_INCIDENTS, absent: ['inspection-failed'] },
  { rows: '92', catalog: PLUGIN_ASSETS_INCIDENTS, absent: ['inspection-failed'] },
  { rows: '96', catalog: PLUGIN_ARTIFACTS_INCIDENTS, absent: ['directory-unreadable'] },
  { rows: '100', catalog: PLUGIN_REGISTRY_INCIDENTS, absent: ['registry-unavailable'] },
  { rows: '(content-dir)', catalog: CONTENT_DIR_INCIDENTS, absent: ['location'] },
]

/** The table's effects per action → the ONE mode policy's verdict. */
const ACTIONS: Array<{ action: HealthRepairActionDefinition; mode: 'self-heal' | 'one-click'; restarts?: 'bakin' | 'runtime' | 'search-engine'; mutation?: string }> = [
  { action: healthAcksResetRepair(), mode: 'self-heal' },
  { action: healthAcksPruneRepair(), mode: 'self-heal' },
  { action: mediaStoreRepair(), mode: 'self-heal' },
  { action: packageSyncRepair(), mode: 'self-heal', mutation: 'sync' },
  { action: packageReinstallRepair(), mode: 'self-heal', mutation: 'reinstall' },
  { action: serviceSetupRepair(), mode: 'self-heal', restarts: 'bakin', mutation: 'restart' },
  { action: runtimeRestartRepair({ restart: async () => {}, ping: async () => true }), mode: 'self-heal', restarts: 'runtime', mutation: 'restart' },
  { action: sessionStorePruneRepair({ sessions: {} as never }), mode: 'one-click', mutation: 'delete' },
  { action: discordBridgeReconnectRepair(), mode: 'self-heal', mutation: 'restart' },
  { action: requeueStrandedTasksRepair(), mode: 'one-click' },
  { action: runDirsSweepRepair(), mode: 'self-heal' },
  { action: syncSkillRepair('/repo', {} as never), mode: 'self-heal' },
  { action: installPluginAssetsRepair(), mode: 'self-heal' },
  { action: pluginUpgradeRepair({ record: async () => undefined }), mode: 'self-heal', mutation: 'upgrade' },
  { action: pluginReinstallRepair(), mode: 'self-heal', mutation: 'reinstall' },
]

describe('re-homing — declared families (rows 1–51, 90–101)', () => {
  for (const row of ROWS) {
    it(`row ${row.row}: ${row.id} is declared as the table reads`, () => {
      const declaration = row.catalog.find((entry) => entry.id === row.id)
      expect(declaration).toEqual({ id: row.id, subjectKind: row.subjectKind, resolution: row.resolution, required: row.required })
    })
  }
  for (const group of OBSERVATION_ROWS) {
    it(`rows ${group.rows}: ${group.absent.join(', ')} are observations — no family declared`, () => {
      for (const id of group.absent) expect(group.catalog.some((entry) => entry.id === id)).toBe(false)
    })
  }
  it('every catalog id is unique within its check', () => {
    for (const catalog of new Set(ROWS.map((row) => row.catalog))) {
      expect(new Set(catalog.map((entry) => entry.id)).size).toBe(catalog.length)
    }
  })
})

describe('re-homing — effects → mode per action', () => {
  for (const { action, mode, restarts, mutation } of ACTIONS) {
    it(`${action.id}: ${mode}${restarts ? ` (restarts ${restarts})` : ''}${mutation ? `, mutation ${mutation}` : ''}`, () => {
      expect(repairMode(action.effects)).toBe(mode)
      expect((action.effects.restartsService ?? null) as string | null).toBe(restarts ?? null)
      expect((action.mutation ?? null) as string | null).toBe(mutation ?? null)
    })
  }
})

describe('re-homing — emitted instances the fakes can reach', () => {
  const observed = (input: unknown) => (input as { observations: Array<Record<string, unknown> & { incident?: Record<string, unknown> }> }).observations

  it('row 7: an unauthenticated gh is a credential handoff of `gh auth login`, required', async () => {
    const [row] = observed(await checkGithubReadiness({ which: async () => '/usr/local/bin/gh', authOk: async () => false }))
    expect(row!.incident).toMatchObject({
      declarationId: 'authentication-required',
      subject: { kind: 'system', id: 'github-cli' },
      required: true,
      resolution: { type: 'human', needs: 'credential', handoff: { command: 'gh auth login' } },
    })
  })

  it('row 12: an unreachable runtime is the restart repair on the active runtime', async () => {
    const [row] = observed(await checkRuntime({ ping: async () => false }))
    expect(row!.incident).toMatchObject({ declarationId: 'unreachable', subject: { kind: 'runtime', id: 'active' }, resolution: { type: 'repair', actionId: 'runtime-restart' } })
  })

  it('rows 13–16: only the oversized store is an incident (one-click prune); inspection failures, growth and orphans are observations', async () => {
    const stats = (agentId: string, diskBytes: number, fileCount = 10) => ({ agentId, storeEntries: 5, fileCount, diskBytes })
    const runtime = (rows: ReturnType<typeof stats>[]) => ({ sessions: { storeStats: async () => rows, pruneStore: async () => ({ agentId: 'x', removedFiles: 0, freedBytes: 0, skippedInFlight: 0, remainingFiles: 0 }) } }) as never
    const rows = observed(await checkSessionStore(runtime([stats('big', SESSION_STORE_ERROR_BYTES + 1), stats('growing', SESSION_STORE_WARN_BYTES + 1), stats('orphans', 1, 5_000)])))
    expect(rows.map((row) => [row.key, row.incident?.declarationId])).toEqual([['agent:big', 'oversized'], ['agent:growing', undefined], ['agent:orphans', undefined]])
    expect(rows[0]!.incident).toMatchObject({ subject: { kind: 'agent', id: 'big' }, resolution: { type: 'repair', actionId: 'session-store-prune' } })
    const [failed] = observed(await checkSessionStore({ sessions: { storeStats: async () => { throw new Error('nope') } } } as never))
    expect(failed).toMatchObject({ status: 'unknown', key: 'usage' })
    expect(failed!.incident).toBeUndefined()
  })

  it('rows 3–5: broken and missing stores are the install repair; an unsupported platform is an observation', async () => {
    const deps = (store: unknown, loads = true) => ({
      bundledSharpAvailable: async () => false,
      checkStore: () => store as never,
      sharpLoads: async () => loads,
      sharpVersion: () => '0.34.0',
    })
    const receipt = { status: 'ok', receipt: { sharpVersion: '0.34.0', platform: 'darwin-arm64', installedAt: 'x' } }
    expect(observed(await checkMediaSharp(deps(receipt, false)))[0]!.incident).toMatchObject({ declarationId: 'media-store-broken', subject: { kind: 'system', id: 'media-store' } })
    expect(observed(await checkMediaSharp(deps({ status: 'missing' })))[0]!.incident).toMatchObject({ declarationId: 'media-store-missing', resolution: { type: 'repair', actionId: 'media-install-store' } })
    const [unsupported] = observed(await checkMediaSharp(deps({ status: 'unsupported', platform: 'linux-riscv64' })))
    expect(unsupported!.status).toBe('warning')
    expect(unsupported!.incident).toBeUndefined()
  })

  // Rows 1–2, 6, 8–11, 20–35, 39–51, 90–101 emit through dependencies the
  // per-check test files already fake (ack store files, the readiness
  // snapshot, the hook registry, the plugin lockfile, the registry
  // snapshot, the usage scanners); their instances are asserted there, with
  // the catalog assertions above as the table's pin.
})
