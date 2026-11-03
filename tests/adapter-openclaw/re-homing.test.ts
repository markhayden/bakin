/**
 * Re-homing rows 202–204 (self-healing 1.7): the OpenClaw override-
 * authorization check declares ONE family — the human credential for a
 * connection that lacks `operator.admin` while model routes exist, with the
 * device scope-upgrade handoff (Codex r1 #9) — and its two "cannot see yet"
 * states are plain observations, never cards. The gateway-protocol check
 * (the Updates engine's `gateway` row) declares the below-floor family whose
 * handoff is OpenClaw's own updater.
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

import { OPENCLAW_GATEWAY_PROTOCOL_INCIDENTS, OPENCLAW_OVERRIDE_AUTHORIZATION_INCIDENTS, OPENCLAW_PROVIDER_CONFIGURATION_INCIDENTS, createOpenClawHealthChecks } from '../../packages/adapter-openclaw/src/health-checks'
import type { ProviderCredentialInventory, RuntimeCompatibility } from '../../packages/core/src/adapters/runtime'
import { parseHealthCheckRegistration, parseHealthCheckRunInput } from '../../src/core/health-contract'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const routing = (perTurnModel: boolean) => ({
  defaultModel: true, fallbackModels: true, defaultSubagentModel: true,
  aliases: true, perAgentSubagentModel: true,
  supportedThinkingLevels: ['off'] as Array<'off'>, perTurnModel,
})

async function run(perTurnModel: boolean, scopesVerified = true) {
  const check = createOpenClawHealthChecks({ routingSupport: () => routing(perTurnModel), scopesVerified: () => scopesVerified })
    .find((candidate) => candidate.id === 'override-authorization')
  const parsed = parseHealthCheckRunInput(await check!.run())
  if (parsed.outcome !== 'observed') throw new Error('expected observed')
  return parsed.observations[0]!
}

async function runGateway(verdict: RuntimeCompatibility) {
  const check = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true, compatibility: () => verdict })
    .find((candidate) => candidate.id === 'gateway-protocol')
  const parsed = parseHealthCheckRunInput(await check!.run())
  if (parsed.outcome !== 'observed') throw new Error('expected observed')
  return parsed.observations[0]!
}

describe('OpenClaw catalog matches the re-homing table (rows 202–204)', () => {
  it('declares exactly the row-204 family: human credential, required while overrides are configured', () => {
    const [check] = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true })
    expect(parseHealthCheckRegistration(check!).id).toBe('override-authorization')
    expect(check!.incidents).toEqual(OPENCLAW_OVERRIDE_AUTHORIZATION_INCIDENTS)
    expect(check!.incidents).toEqual([
      { id: 'override-authorization', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
    ])
  })

  it('row 204: routes on an unauthorized connection → the declared human credential, required, with the device scope-upgrade handoff (list → approve by id → bakin restart)', async () => {
    routingConfig = { routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }], tagOverrides: [] }
    const observation = await run(false)
    expect(observation.status).toBe('error')
    expect(observation.incident).toMatchObject({
      declarationId: 'override-authorization',
      subject: { kind: 'runtime', id: 'openclaw' },
      required: true,
      disposition: 'action_required',
      resolution: { type: 'human', needs: 'credential', href: '/runtime?tab=runtimes', handoff: { command: 'openclaw devices list' } },
    })
    // The approve step takes the request id the listing prints; the restart re-dials with the scope requested again.
    expect(observation.incident?.impact).toContain('openclaw devices approve <requestId>')
    expect(observation.incident?.impact).toContain('bakin restart')
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

describe('OpenClaw gateway protocol floor (the Updates `gateway` row, Codex r1 #9)', () => {
  it('declares exactly the below-floor family: human external-install, always required', () => {
    const check = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true }).find((c) => c.id === 'gateway-protocol')
    expect(parseHealthCheckRegistration(check!).id).toBe('gateway-protocol')
    expect(check!.incidents).toEqual(OPENCLAW_GATEWAY_PROTOCOL_INCIDENTS)
    expect(check!.incidents).toEqual([{ id: 'gateway-below-floor', subjectKind: 'runtime', resolution: { type: 'human', needs: 'external-install' }, required: 'always' }])
  })

  it('below the floor → the declared external-install with the `openclaw update` handoff on the runtime page', async () => {
    const observation = await runGateway({ required: '4', observed: '3', observedAt: '2026-10-24T00:00:00.000Z', state: 'below-floor' })
    expect(observation.status).toBe('error')
    expect(observation.incident).toMatchObject({
      declarationId: 'gateway-below-floor',
      subject: { kind: 'runtime', id: 'openclaw' },
      disposition: 'action_required',
      resolution: { type: 'human', needs: 'external-install', href: '/runtime?tab=runtimes', handoff: { command: 'openclaw update' } },
    })
    expect(observation.incident?.impact).toContain('2026.6.11')
    expect(observation.evidence).toMatchObject({ required: '4', observed: '3', state: 'below-floor' })
  })

  it('a gateway that reported no protocol at all is below the floor too', async () => {
    const observation = await runGateway({ required: '4', observed: 'unreported', state: 'below-floor' })
    expect(observation.incident?.resolution).toMatchObject({ handoff: { command: 'openclaw update' } })
  })

  it('at or above the floor → healthy; no handshake yet → an unknown observation, never healthy and never a card', async () => {
    expect((await runGateway({ required: '4', observed: '4', state: 'ok' })).status).toBe('healthy')
    const unknown = await runGateway({ required: '4', state: 'unknown' })
    expect(unknown.status).toBe('unknown')
    expect(unknown.incident).toBeUndefined()
    expect(unknown.detail).toContain('protocol 4')
  })

  it('without an injected verdict the check reads the adapter\'s cached handshake evidence (none in this process → unknown)', async () => {
    const check = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true }).find((c) => c.id === 'gateway-protocol')
    const parsed = parseHealthCheckRunInput(await check!.run())
    if (parsed.outcome !== 'observed') throw new Error('expected observed')
    expect(parsed.observations[0]).toMatchObject({ status: 'unknown', evidence: { state: 'unknown', required: '4', probe: 'cached' } })
  })

  describe('return verification re-probes instead of trusting the handshake from before (Codex r2, r1 #9)', () => {
    const ok: RuntimeCompatibility = { required: '4', observed: '4', observedAt: '2026-10-24T01:00:00.000Z', state: 'ok' }
    const below: RuntimeCompatibility = { required: '4', observed: '3', observedAt: '2026-10-24T00:00:00.000Z', state: 'below-floor' }
    async function runWithProbe(cached: RuntimeCompatibility, probe: () => Promise<RuntimeCompatibility>) {
      const calls = { probes: 0 }
      const check = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true, compatibility: () => cached, probeCompatibility: async () => { calls.probes += 1; return probe() } })
        .find((candidate) => candidate.id === 'gateway-protocol')
      const parsed = parseHealthCheckRunInput(await check!.run())
      if (parsed.outcome !== 'observed') throw new Error('expected observed')
      return { observation: parsed.observations[0]!, calls }
    }
    it('a cached ok from the live connection is current evidence — no probe', async () => {
      const { observation, calls } = await runWithProbe(ok, async () => below)
      expect(calls.probes).toBe(0)
      expect(observation).toMatchObject({ status: 'healthy', evidence: { probe: 'cached', state: 'ok' } })
    })
    it('a cached below-floor verdict is re-probed: the operator who ran `openclaw update` is seen (fresh ok → healthy)', async () => {
      const { observation, calls } = await runWithProbe(below, async () => ok)
      expect(calls.probes).toBe(1)
      expect(observation).toMatchObject({ status: 'healthy', evidence: { probe: 'fresh', state: 'ok', observed: '4' } })
    })
    it('a fresh probe that still finds the old gateway keeps the incident', async () => {
      const { observation } = await runWithProbe(below, async () => below)
      expect(observation).toMatchObject({ status: 'error', incident: { declarationId: 'gateway-below-floor' }, evidence: { probe: 'fresh' } })
    })
    it('a probe that cannot reach the gateway falls back to the cached verdict and says the probe failed (unknown stays unknown, never healthy)', async () => {
      const { observation } = await runWithProbe({ required: '4', state: 'unknown' }, async () => { throw new Error('connect timed out') })
      expect(observation).toMatchObject({ status: 'unknown', evidence: { probe: 'failed', probeError: 'connect timed out', state: 'unknown' } })
      expect(observation.summary).toContain('could not be reached')
      const stillBelow = await runWithProbe(below, async () => { throw new Error('ECONNREFUSED') })
      expect(stillBelow.observation).toMatchObject({ status: 'error', evidence: { probe: 'failed', state: 'below-floor' } })
    })
  })
})

describe('OpenClaw provider configuration (parity with Pi row 198, Codex r2 r1 #9)', () => {
  async function runProviders(credentials?: () => Promise<ProviderCredentialInventory>) {
    const check = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true, ...(credentials ? { credentials } : {}) })
      .find((candidate) => candidate.id === 'provider-configuration')
    const parsed = parseHealthCheckRunInput(await check!.run())
    if (parsed.outcome !== 'observed') throw new Error('expected observed')
    return parsed.observations[0]!
  }
  it('declares exactly the provider-configuration family: human credential, always required', () => {
    const check = createOpenClawHealthChecks({ routingSupport: () => routing(true), scopesVerified: () => true }).find((c) => c.id === 'provider-configuration')
    expect(parseHealthCheckRegistration(check!).id).toBe('provider-configuration')
    expect(check!.incidents).toEqual(OPENCLAW_PROVIDER_CONFIGURATION_INCIDENTS)
    expect(check!.incidents).toEqual([{ id: 'provider-configuration', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'always' }])
  })
  it('no provider in a COMPLETE inventory → the declared credential with the `openclaw models auth login` handoff on the credentials group', async () => {
    const observation = await runProviders(async () => ({ providers: [], evidence: 'complete' }))
    expect(observation.status).toBe('error')
    expect(observation.incident).toMatchObject({
      declarationId: 'provider-configuration',
      subject: { kind: 'runtime', id: 'openclaw' },
      disposition: 'action_required',
      resolution: { type: 'human', needs: 'credential', href: '/runtime?tab=overview&field=credentials', handoff: { command: 'openclaw models auth login' } },
    })
  })
  it('a configured provider → healthy, naming it; a PARTIAL empty inventory → unknown, never credential-less (#615)', async () => {
    const healthy = await runProviders(async () => ({ providers: [{ providerId: 'openai', configured: true, source: 'runtime' }], evidence: 'complete' }))
    expect(healthy).toMatchObject({ status: 'healthy', evidence: { providers: ['openai'] } })
    expect(healthy.summary).toContain('openai')
    const partial = await runProviders(async () => ({ providers: [], evidence: 'partial', detail: 'CLI probe failed' }))
    expect(partial).toMatchObject({ status: 'unknown', evidence: { evidence: 'partial' } })
    expect(partial.incident).toBeUndefined()
  })
  it('no inventory member, or a throwing one → an unknown observation, never a card', async () => {
    expect(await runProviders()).toMatchObject({ status: 'unknown' })
    expect(await runProviders(async () => { throw new Error('cli exploded') })).toMatchObject({ status: 'unknown', detail: 'cli exploded' })
  })
})
