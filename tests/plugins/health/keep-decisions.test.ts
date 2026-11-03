/**
 * Decision choices owned by the health plugin (Codex r1 #10/#11): row 76
 * "Keep" records unclaimed Search tables (the check skips them and raises
 * a new table), row 94 "Keep my edit" records the shipped sha the operator
 * accepted, and row 6 derives `required` from a lockfile FACT — an agent
 * package that declares the capability — never from "it is installed".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-health-keep-decisions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p = '') => `${testDir}/.openclaw/${p}`,
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

// Row 6 fixtures: the readiness engine's rows are the input; the lockfile is the usage fact.
import type { CapabilityReadiness } from '../../../src/core/agent-packages/capability-readiness'
let capabilities: CapabilityReadiness[] = []
mock.module('../../../src/core/agent-packages/capability-readiness', () => ({
  listCapabilities: async () => capabilities,
}))

import healthPlugin from '../../../plugins/health/index'
import { forgetKeptSearchTables, keepSearchTables, keptSearchTablesPath, partitionUnclaimedTables, readKeptSearchTables } from '../../../plugins/health/lib/system-checks/kept-search-tables'
import { unclaimedTablesObservation } from '../../../plugins/health/lib/system-checks/search-consistency'
import { capabilityDeclaredBy, checkCapabilities } from '../../../plugins/health/lib/system-checks/capabilities'
import { acceptedEditsPath } from '../../../src/core/onboarding/plugin-assets'
import type { Lockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import type { ActivatedPlugin } from '../test-helpers'

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  plugin = await activatePlugin(healthPlugin, testDir)
})
afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  rmSync(`${testDir}-openclaw`, { force: true, recursive: true })
})
beforeEach(() => {
  rmSync(keptSearchTablesPath(), { force: true })
  rmSync(acceptedEditsPath(), { force: true })
})

describe('row 76 — kept Search tables', () => {
  it('keep / read / forget round-trip; an unreadable record throws instead of answering "nothing kept"', () => {
    expect(readKeptSearchTables()).toEqual([])
    expect(keepSearchTables(['bakin_tasks_v1_abc', 'bakin_assets_v1_def'], () => '2026-10-24T00:00:00.000Z')).toEqual(['bakin_assets_v1_def', 'bakin_tasks_v1_abc'])
    expect(JSON.parse(readFileSync(keptSearchTablesPath(), 'utf-8'))).toEqual({ version: 1, tables: { bakin_tasks_v1_abc: { keptAt: '2026-10-24T00:00:00.000Z' }, bakin_assets_v1_def: { keptAt: '2026-10-24T00:00:00.000Z' } } })
    expect(forgetKeptSearchTables(['bakin_tasks_v1_abc'])).toEqual(['bakin_assets_v1_def'])
    expect(forgetKeptSearchTables()).toEqual([])
    writeFileSync(keptSearchTablesPath(), '{"version":1,"tables":"nope"}')
    expect(() => readKeptSearchTables()).toThrow(/not a kept-tables record/)
  })

  it('the observation raises only the tables still to decide, carries Keep as a request choice for exactly those, and reports the kept ones', () => {
    expect(partitionUnclaimedTables(['a', 'b', 'c'], ['b'])).toEqual({ pending: ['a', 'c'], kept: ['b'] })
    const row = unclaimedTablesObservation(['bakin_tasks_v1_old', 'bakin_memory_v2_x'], ['bakin_memory_v2_x'])
    expect(row).toMatchObject({ status: 'warning', evidence: { unclaimed: ['bakin_tasks_v1_old'], kept: ['bakin_memory_v2_x'] } })
    expect(row.detail).toContain('Kept by your decision: bakin_memory_v2_x')
    expect(row.incident).toMatchObject({
      declarationId: 'unclaimed-tables',
      disposition: 'advisory',
      resources: [{ kind: 'search_table', label: 'bakin_tasks_v1_old' }],
      resolution: {
        type: 'repair', actionId: 'search-drop-unclaimed-tables',
        choices: [{ key: 'keep', kind: 'request', label: 'Keep', method: 'POST', url: '/api/plugins/health/search/unclaimed-tables/keep', body: { tables: ['bakin_tasks_v1_old'] }, confirm: { title: 'Keep this table?' } }],
      },
    })
    // Every unclaimed table kept: a healthy observation naming them — no card, and the Drop planner (which reads `evidence.unclaimed`) sees nothing.
    const quiet = unclaimedTablesObservation(['bakin_memory_v2_x'], ['bakin_memory_v2_x'])
    expect(quiet).toMatchObject({ status: 'healthy', evidence: { unclaimed: [], kept: ['bakin_memory_v2_x'] } })
    expect(quiet.incident).toBeUndefined()
  })

  it('POST /search/unclaimed-tables/keep records the decision; /kept lists it; /forget reverses it', async () => {
    const keep = findRoute(plugin.routes, 'POST', '/search/unclaimed-tables/keep')!
    const kept = await callRoute(keep, plugin.ctx, { body: { tables: ['bakin_tasks_v1_old'] } })
    expect(kept.status).toBe(200)
    expect(kept.body).toEqual({ kept: ['bakin_tasks_v1_old'] })
    expect(readKeptSearchTables()).toEqual(['bakin_tasks_v1_old'])
    const listed = await callRoute(findRoute(plugin.routes, 'GET', '/search/unclaimed-tables/kept')!, plugin.ctx, {})
    expect(listed.body).toEqual({ kept: ['bakin_tasks_v1_old'] })
    const forgotten = await callRoute(findRoute(plugin.routes, 'POST', '/search/unclaimed-tables/forget')!, plugin.ctx, { body: {} })
    expect(forgotten.body).toEqual({ kept: [] })
    expect((await callRoute(keep, plugin.ctx, { body: { tables: [] } })).status).toBe(400)
  })
})

describe('row 94 — kept user edits', () => {
  it('POST /plugin-assets/keep-edit records the accepted shipped sha per skill and refuses a malformed sha', async () => {
    const route = findRoute(plugin.routes, 'POST', '/plugin-assets/keep-edit')!
    const sha = 'b'.repeat(64)
    const res = await callRoute(route, plugin.ctx, { body: { skills: [{ name: 'cold-email', pluginId: 'sdr', shippedSha: sha }] } })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ accepted: [{ name: 'cold-email', pluginId: 'sdr', shippedSha: sha, acceptedAt: expect.any(String) }] })
    expect(JSON.parse(readFileSync(acceptedEditsPath(), 'utf-8')).skills['cold-email']).toMatchObject({ shippedSha: sha })
    expect((await callRoute(route, plugin.ctx, { body: { skills: [{ name: 'cold-email', pluginId: 'sdr', shippedSha: 'nope' }] } })).status).toBe(400)
  })
})

describe('row 6 — a capability is required only while an agent declares it', () => {
  const cap = (over: Partial<CapabilityReadiness> = {}): CapabilityReadiness => ({
    capability: 'web-search', packageId: 'acme.web-search', version: '1.0.0', name: 'Web search', description: 'Search the web.',
    skills: [{ name: 'web-search', status: 'missing' }], bins: [], npm: [], models: [], prereqs: [], secrets: [],
    platformSupported: true, manifestValid: true, ready: false, missing: ['skill "web-search" is not projected'],
    ...over,
  })
  const lock = (packages: Lockfile['packages']): Lockfile => ({ version: 1, packages })
  const packEntry = { kind: 'skill-pack' as const, version: '1.0.0', source: 'github:acme/bits#packs/web-search', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', refCount: 0, dependents: [] as string[] }
  const agentEntry = (dependencies: string[]) => ({ kind: 'agent' as const, version: '0.2.0', source: 'github:acme/bits#agents/sdr', ref: 'main', commitSha: 'c'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', state: 'managed' as const, agentId: 'sdr', dependencies })

  it('capabilityDeclaredBy reads the lockfile facts: dependents on the pack entry, or an agent entry whose dependencies name it', () => {
    expect(capabilityDeclaredBy(lock({ 'acme.web-search@1.0.0': packEntry }), cap())).toEqual([])
    expect(capabilityDeclaredBy(lock({ 'acme.web-search@1.0.0': { ...packEntry, refCount: 1, dependents: ['acme.sdr@0.2.0'] } }), cap())).toEqual(['acme.sdr@0.2.0'])
    expect(capabilityDeclaredBy(lock({ 'acme.web-search@1.0.0': packEntry, 'acme.sdr@0.2.0': agentEntry(['acme.web-search@1.0.0']) }), cap())).toEqual(['acme.sdr@0.2.0'])
  })

  it('paired fixtures: a declared pack is required + action_required; an undeclared one is advisory + not required (same family, same repair)', async () => {
    capabilities = [cap()]
    const observed = (input: unknown) => (input as { observations: Array<Record<string, unknown> & { incident?: Record<string, unknown> }> }).observations
    const [declared] = observed(await checkCapabilities({ lockfile: () => lock({ 'acme.web-search@1.0.0': packEntry, 'acme.sdr@0.2.0': agentEntry(['acme.web-search@1.0.0']) }) }))
    expect(declared!.incident).toMatchObject({ declarationId: 'not-ready-sync', required: true, disposition: 'action_required', resolution: { type: 'repair', actionId: 'package-sync' } })
    expect(declared!.incident!.impact).toContain('acme.sdr@0.2.0')
    expect(declared!.evidence).toMatchObject({ declaredBy: ['acme.sdr@0.2.0'] })
    const [undeclared] = observed(await checkCapabilities({ lockfile: () => lock({ 'acme.web-search@1.0.0': packEntry }) }))
    expect(undeclared!.incident).toMatchObject({ declarationId: 'not-ready-sync', required: false, disposition: 'advisory', resolution: { type: 'repair', actionId: 'package-sync' } })
    expect(undeclared!.evidence).toMatchObject({ declaredBy: [] })
  })
})
