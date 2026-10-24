/**
 * Re-homing rows 202–204 (self-healing 1.7): the OpenClaw override-
 * authorization check declares ONE family — the human credential for a
 * connection that lacks `operator.admin` while model routes exist — and its
 * two "cannot see yet" states are plain observations, never cards.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-oc-rehoming-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

let routingConfig: unknown = { routes: [], tagOverrides: [] }
let hookThrows = false
mock.module('../../packages/core/src/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async () => {
      if (hookThrows) throw new Error('models plugin reloading')
      return routingConfig
    },
  }),
}))

import { OPENCLAW_OVERRIDE_AUTHORIZATION_INCIDENTS, createOpenClawHealthChecks } from '../../packages/adapter-openclaw/src/health-checks'
import { parseHealthCheckRegistration, parseHealthCheckRunInput } from '../../src/core/health-contract'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

async function run(perTurnModel: boolean, scopesVerified = true) {
  const [check] = createOpenClawHealthChecks({
    routingSupport: () => ({
      defaultModel: true, fallbackModels: true, defaultSubagentModel: true,
      aliases: true, perAgentSubagentModel: true,
      supportedThinkingLevels: ['off'], perTurnModel,
    }),
    scopesVerified: () => scopesVerified,
  })
  const parsed = parseHealthCheckRunInput(await check!.run())
  if (parsed.outcome !== 'observed') throw new Error('expected observed')
  return parsed.observations[0]!
}

describe('OpenClaw catalog matches the re-homing table (rows 202–204)', () => {
  it('declares exactly the row-204 family: human credential, required while overrides are configured', () => {
    const [check] = createOpenClawHealthChecks({ routingSupport: () => ({ defaultModel: true, fallbackModels: true, defaultSubagentModel: true, aliases: true, perAgentSubagentModel: true, supportedThinkingLevels: ['off'], perTurnModel: true }), scopesVerified: () => true })
    expect(parseHealthCheckRegistration(check!).id).toBe('override-authorization')
    expect(check!.incidents).toEqual(OPENCLAW_OVERRIDE_AUTHORIZATION_INCIDENTS)
    expect(check!.incidents).toEqual([
      { id: 'override-authorization', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
    ])
  })

  it('row 204: routes on an unauthorized connection → the declared human credential, required, no shell handoff (no verified grant command)', async () => {
    routingConfig = { routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }], tagOverrides: [] }
    const observation = await run(false)
    expect(observation.status).toBe('error')
    expect(observation.incident).toMatchObject({
      declarationId: 'override-authorization',
      subject: { kind: 'runtime', id: 'openclaw' },
      required: true,
      disposition: 'action_required',
      resolution: { type: 'human', needs: 'credential', href: '/runtime?tab=runtimes' },
    })
    expect(observation.incident?.resolution).not.toHaveProperty('handoff')
    expect(observation.incident?.impact).toContain('operator.admin')
  })

  it('row 202: scopes not yet verified → an observation without an incident', async () => {
    routingConfig = { routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }], tagOverrides: [] }
    const observation = await run(true, false)
    expect(observation.status).toBe('unknown')
    expect(observation.incident).toBeUndefined()
    expect(observation.detail).toContain('granted scopes')
  })

  it('row 203: routing config unreadable on an unauthorized connection → an observation without an incident', async () => {
    hookThrows = true
    const observation = await run(false)
    hookThrows = false
    expect(observation.status).toBe('unknown')
    expect(observation.incident).toBeUndefined()
    expect(observation.evidence).toMatchObject({ routesKnown: false })
  })
})
