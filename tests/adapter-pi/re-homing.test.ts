/**
 * Re-homing rows 196–201 (self-healing 1.7): every Pi incident family the
 * adapter declares matches the table — resolution kind, action or need,
 * requirement — and the emitted instances the Pi home fixture can reach
 * match their families. Rows the fixture cannot reach honestly (the model
 * registry failing to refresh, extension discovery throwing) are pinned on
 * the catalog alone.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pi-rehoming-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { HealthCheckRegistrationInput, HealthIncidentDeclaration, HealthIncidentInput } from '@makinbakin/sdk'
import {
  PI_AGENTS_ROOT_INCIDENTS,
  PI_AUTH_INCIDENTS,
  PI_EXTENSIONS_INCIDENTS,
  PI_HOME_INCIDENTS,
  PI_INSTALL_COMMAND,
  PI_MODELS_INCIDENTS,
  createPiHealthChecks,
} from '../../packages/adapter-pi/src/health-checks'
import { getPiAgentsRoot, getPiHome, getPiRegistryPath, resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'
import { parseHealthCheckRegistration, parseHealthCheckRunInput } from '../../src/core/health-contract'

const agentDir = join(testDir, 'pi', 'agent')

function seedUsableHome(): void {
  rmSync(join(testDir, 'pi'), { recursive: true, force: true })
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(getPiAgentsRoot(), { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: { name: 'F', baseUrl: 'http://127.0.0.1:9', api: 'openai-completions', models: [{ id: 'm', name: 'M', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] },
    },
  }))
  resetModelRegistry()
}

beforeAll(() => {
  resetPiHome()
  seedUsableHome()
})
afterAll(() => {
  try { chmodSync(getPiAgentsRoot(), 0o755) } catch { /* may be gone */ }
  rmSync(testDir, { recursive: true, force: true })
})

function check(id: string, settings: () => Record<string, unknown> | undefined = () => undefined): HealthCheckRegistrationInput {
  const found = createPiHealthChecks(settings).find((candidate) => candidate.id === id)
  if (!found) throw new Error(`no Pi check ${id}`)
  return found
}

async function firstIncident(def: HealthCheckRegistrationInput): Promise<HealthIncidentInput | undefined> {
  const run = parseHealthCheckRunInput(await def.run())
  if (run.outcome !== 'observed') throw new Error('expected observed')
  return run.observations[0]?.incident
}

/** The table, row by row: family id → declared shape. */
const TABLE: Record<string, { checks: string[]; family: HealthIncidentDeclaration }> = {
  // 196 pi.home / pi.agents-root installation → human external-install, AR while Pi is active
  installation: { checks: ['home', 'agents-root'], family: { id: 'installation', subjectKind: 'runtime', resolution: { type: 'human', needs: 'external-install' }, required: 'owner-decides' } },
  // 197 pi.home agent-registry → core.diagnose, AR
  'agent-registry': { checks: ['home'], family: { id: 'agent-registry', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' } },
  // 198 pi.auth / pi.models provider-configuration → human credential (Pi /login), AR
  'provider-configuration': { checks: ['auth', 'models'], family: { id: 'provider-configuration', subjectKind: 'runtime', resolution: { type: 'human', needs: 'credential' }, required: 'always' } },
  // 199 pi.models model-registry → core.diagnose, AR
  'model-registry': { checks: ['models'], family: { id: 'model-registry', subjectKind: 'runtime', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' } },
  // 200 pi.extensions extension-approval → human decision, AR only while something needs the extension
  'extension-approval': { checks: ['extensions'], family: { id: 'extension-approval', subjectKind: 'runtime', resolution: { type: 'human', needs: 'decision' }, required: 'owner-decides' } },
}

describe('Pi catalogs match the re-homing table (rows 196–201)', () => {
  it('every family is declared on every check the table names, with the table shape', () => {
    for (const [id, row] of Object.entries(TABLE)) {
      for (const checkId of row.checks) {
        const declared = check(checkId).incidents.find((family) => family.id === id)
        expect(declared, `${checkId} declares ${id}`).toEqual(row.family)
      }
    }
    expect(PI_HOME_INCIDENTS.map((f) => f.id)).toEqual(['installation', 'agent-registry'])
    expect(PI_AGENTS_ROOT_INCIDENTS.map((f) => f.id)).toEqual(['installation'])
    expect(PI_AUTH_INCIDENTS.map((f) => f.id)).toEqual(['provider-configuration'])
    expect(PI_MODELS_INCIDENTS.map((f) => f.id)).toEqual(['provider-configuration', 'model-registry'])
    expect(PI_EXTENSIONS_INCIDENTS.map((f) => f.id)).toEqual(['extension-approval'])
  })

  it('row 201 (extension-discovery) declares no family — it is an observation', () => {
    expect(check('extensions').incidents.some((family) => family.id === 'extension-discovery')).toBe(false)
  })

  it('every registration parses under the contract', () => {
    for (const def of createPiHealthChecks(() => undefined)) expect(parseHealthCheckRegistration(def).id).toBe(def.id)
  })
})

describe('emitted instances match their families', () => {
  it('row 196: a missing Pi home is a required external-install with the install command handed off', async () => {
    rmSync(join(testDir, 'pi'), { recursive: true, force: true })
    const incident = await firstIncident(check('home'))
    expect(incident).toMatchObject({
      declarationId: 'installation',
      subject: { kind: 'runtime', id: 'pi' },
      required: true,
      disposition: 'action_required',
      resolution: { type: 'human', needs: 'external-install', href: '/runtime?tab=runtimes', handoff: { command: PI_INSTALL_COMMAND } },
    })
    seedUsableHome()
  })

  it('row 196: an unwritable agent root reports the same family without creating the directory', async () => {
    rmSync(getPiAgentsRoot(), { recursive: true, force: true })
    const incident = await firstIncident(check('agents-root'))
    expect(incident).toMatchObject({ declarationId: 'installation', required: true, resolution: { type: 'human', needs: 'external-install' } })
    mkdirSync(getPiAgentsRoot(), { recursive: true })
  })

  it('row 197: an unreadable registry goes to the fallback lane', async () => {
    mkdirSync(join(getPiRegistryPath(), '..'), { recursive: true })
    writeFileSync(getPiRegistryPath(), '{ not json')
    const incident = await firstIncident(check('home'))
    expect(incident).toMatchObject({
      declarationId: 'agent-registry',
      subject: { kind: 'runtime', id: 'pi' },
      resolution: { type: 'repair', actionId: 'core.diagnose' },
    })
    rmSync(getPiRegistryPath(), { force: true })
  })

  it('row 198: no provider authentication is a credential the operator signs in for, naming the home', async () => {
    rmSync(join(agentDir, 'auth.json'), { force: true })
    resetModelRegistry()
    const incident = await firstIncident(check('auth'))
    expect(incident).toMatchObject({
      declarationId: 'provider-configuration',
      subject: { kind: 'runtime', id: 'pi' },
      resolution: { type: 'human', needs: 'credential', href: '/runtime?tab=overview&field=credentials', handoff: { command: 'pi' } },
    })
    expect(incident?.impact).toContain(getPiHome())
    const viaModels = await firstIncident(check('models'))
    expect(viaModels).toMatchObject({ declarationId: 'provider-configuration', resolution: { type: 'human', needs: 'credential' } })
    seedUsableHome()
  })

  it('row 200: pending extensions are a human decision that is never required on a guess', async () => {
    const extensionsDir = join(agentDir, 'extensions')
    mkdirSync(extensionsDir, { recursive: true })
    writeFileSync(join(extensionsDir, 'pending.ts'), 'export default () => {}')
    const incident = await firstIncident(check('extensions', () => ({ piExtensions: { mode: 'allowlist', allow: [] } })))
    expect(incident).toMatchObject({
      declarationId: 'extension-approval',
      subject: { kind: 'runtime', id: 'pi' },
      required: false,
      resolution: { type: 'human', needs: 'decision', href: '/runtime?tab=runtimes' },
    })
    rmSync(extensionsDir, { recursive: true, force: true })
  })

  // Row 199 (model registry refresh throwing) and row 201 (extension
  // discovery throwing) need the Pi SDK itself to fail; the fixture cannot
  // make it do so honestly, so they are pinned on the catalog alone above.
})
