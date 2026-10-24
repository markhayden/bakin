/**
 * Re-homing table rows 102–116 (team): every declared family matches the
 * table's resolution and requirement, and the rows the pure checks can reach
 * emit matching instances. agent-sync rows 111–116 are catalog-only here —
 * their emission rides the full scanner in health-checks.test.ts.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-team-rehoming-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }), isUsingBakinHome: () => true })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

import type { RuntimeAgent } from '@bakin/core/adapters/runtime'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'
import {
  TEAM_AGENT_ROSTER_INCIDENTS,
  TEAM_AGENT_SYNC_INCIDENTS,
  TEAM_PERSONAS_INCIDENTS,
  TEAM_ROUTING_INCIDENTS,
  agentSyncMigrationRepair,
  agentSyncRepair,
  checkAgentRoster,
  checkPersonas,
  checkTeamRouting,
  personaRepair,
} from '../../../plugins/team/lib/health-checks'
import { stampPlanItems } from '../../helpers/repair-contract'

const family = (catalog: ReadonlyArray<{ id: string }>, id: string) => catalog.find((d) => d.id === id)
function observed(run: Awaited<ReturnType<typeof checkTeamRouting>>) {
  const parsed = parseHealthCheckRunInput(run)
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}
let agents: RuntimeAgent[] = []
const reader = { list: async () => agents }

beforeEach(() => { rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true }); agents = [{ id: 'main', name: 'Main', status: 'active' }] })
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('team re-homing — catalogs', () => {
  it('team.routing: only the credential row is an incident (104); 102/103 are observations', () => {
    expect(TEAM_ROUTING_INCIDENTS).toEqual([{ id: 'runtime-credentials', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'always' }])
  })
  it('team.agent-roster: 106/107 are human decisions on the roster editor; 105 is an observation', () => {
    expect(family(TEAM_AGENT_ROSTER_INCIDENTS, 'missing-id')).toMatchObject({ subjectKind: 'agent', resolution: { type: 'human', needs: 'decision' }, required: 'always' })
    expect(family(TEAM_AGENT_ROSTER_INCIDENTS, 'duplicate')).toMatchObject({ subjectKind: 'agent', resolution: { type: 'human', needs: 'decision' }, required: 'always' })
    expect(TEAM_AGENT_ROSTER_INCIDENTS).toHaveLength(2)
  })
  it('team.personas: 109/110 self-heal through create-personas; 108 is an observation', () => {
    expect(family(TEAM_PERSONAS_INCIDENTS, 'directory-missing')).toMatchObject({ subjectKind: 'system', resolution: { type: 'repair', actionId: 'create-personas' }, required: 'always' })
    expect(family(TEAM_PERSONAS_INCIDENTS, 'missing')).toMatchObject({ subjectKind: 'agent', resolution: { type: 'repair', actionId: 'create-personas' }, required: 'always' })
    expect(stampPlanItems(personaRepair(testDir, reader), [{ id: 'x', actionId: 'create-personas', title: 't', reason: 'r', incidentIds: [], observationIds: [], preconditions: [], changes: [] }])[0]!.mode).toBe('self-heal')
  })
  it('team.agent-sync: 112 split into three families, 113 sync-agents (self-heal), 114 migrate (one-click, deletes); 111/115/116 are observations', () => {
    expect(family(TEAM_AGENT_SYNC_INCIDENTS, 'structural')).toMatchObject({ subjectKind: 'agent', resolution: { type: 'repair', actionId: 'sync-agents' } })
    expect(family(TEAM_AGENT_SYNC_INCIDENTS, 'structural-package')).toMatchObject({ subjectKind: 'package', resolution: { type: 'repair', actionId: 'core.diagnose' } })
    expect(family(TEAM_AGENT_SYNC_INCIDENTS, 'structural-opaque')).toMatchObject({ subjectKind: 'agent', resolution: { type: 'repair', actionId: 'core.diagnose' } })
    expect(family(TEAM_AGENT_SYNC_INCIDENTS, 'local-drift')).toMatchObject({ resolution: { type: 'repair', actionId: 'sync-agents' }, required: 'always' })
    expect(family(TEAM_AGENT_SYNC_INCIDENTS, 'migration')).toMatchObject({ resolution: { type: 'repair', actionId: 'migrate-agent-blocks' }, required: 'always' })
    expect(TEAM_AGENT_SYNC_INCIDENTS.map((d) => d.id)).not.toContain('user-edited')
    expect(agentSyncRepair().effects).toEqual({ deletesUserContent: false, spendsMoney: false, widensAuthorization: false })
    expect(agentSyncRepair().mutation).toBe('sync')
    expect(agentSyncMigrationRepair().effects.deletesUserContent).toBe(true)
  })
})

describe('team re-homing — emitted instances', () => {
  it('row 102/103: inspection failures are plain observations', async () => {
    const board = observed(await checkTeamRouting({ readBoard: () => { throw new Error('board gone') }, credentialStatus: async () => ({ llmProviders: [] }) }))
    expect(board[0]).toMatchObject({ key: 'task-board', status: 'unknown' })
    expect(board[0]!.incident).toBeUndefined()
    const creds = observed(await checkTeamRouting({ readBoard: () => ({ columns: { todo: [{ team: 'dev' }] } }), credentialStatus: async () => { throw new Error('offline') } }))
    expect(creds[0]).toMatchObject({ key: 'runtime-credentials', status: 'unknown' })
    expect(creds[0]!.incident).toBeUndefined()
  })
  it('row 104: no credentials → human credential on the runtime credential tiles, required', async () => {
    const [row] = observed(await checkTeamRouting({ readBoard: () => ({ columns: { todo: [{ team: 'dev' }] } }), credentialStatus: async () => ({ llmProviders: [] }) }))
    expect(row!.incident).toMatchObject({
      declarationId: 'runtime-credentials',
      subject: { kind: 'runtime', id: 'active' },
      resolution: { type: 'human', needs: 'credential', href: '/runtime?tab=overview&field=credentials', field: 'runtime-field-credentials' },
    })
  })
  it('rows 105–107: unreadable roster is an observation; a missing id and a duplicate are decisions on /team?recover=1', async () => {
    const unreadable = observed(await checkAgentRoster({ list: async () => { throw new Error('adapter unavailable') } }))
    expect(unreadable[0]!.incident).toBeUndefined()
    agents = [{ id: '', name: 'Broken', status: 'active' }, { id: 'main', name: 'Main', status: 'active' }, { id: 'main', name: 'Main', status: 'active' }]
    const rows = observed(await checkAgentRoster(reader))
    expect(rows.find((r) => r.key === 'missing-id-0')!.incident).toMatchObject({ declarationId: 'missing-id', subject: { kind: 'agent', id: 'roster-0' }, resolution: { type: 'human', needs: 'decision', href: '/team?recover=1' } })
    expect(rows.find((r) => r.key === 'duplicate-main')!.incident).toMatchObject({ declarationId: 'duplicate', subject: { kind: 'agent', id: 'main' }, resolution: { type: 'human', needs: 'decision', href: '/team?recover=1' } })
  })
  it('rows 108–110: unreadable roster is an observation; a missing directory and a missing persona repair through create-personas', async () => {
    const unreadable = observed(await checkPersonas(testDir, { list: async () => { throw new Error('nope') } }))
    expect(unreadable[0]!.incident).toBeUndefined()
    const missingDir = observed(await checkPersonas(testDir, reader))
    expect(missingDir[0]!.incident).toMatchObject({ declarationId: 'directory-missing', subject: { kind: 'system', id: 'personas' }, resolution: { type: 'repair', actionId: 'create-personas' } })
    mkdirSync(join(testDir, 'team', 'personas'), { recursive: true })
    const missingOne = observed(await checkPersonas(testDir, reader))
    expect(missingOne[0]!.incident).toMatchObject({ key: 'missing-main', declarationId: 'missing', subject: { kind: 'agent', id: 'main' }, resolution: { type: 'repair', actionId: 'create-personas' } })
  })
})
