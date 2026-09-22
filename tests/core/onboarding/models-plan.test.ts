/**
 * Onboarding `models` component (spec S7): check() is ok when a persisted
 * plan exists and both lanes are eligible + suitable (or the install is
 * already on the recommendation); missing when no plan is persisted yet;
 * warn — never auto-repaired — when a persisted plan has a dead lane.
 * install() applies the recommendation ONLY on --yes / explicit approval /
 * an interactive yes (the one permitted auto-apply: fresh install, no
 * plan); none eligible ⇒ skipped. Writes ride the core selections mutator.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-onboard-models-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), pluginSettings: join(testDir, 'plugin-settings') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) }))

let yesNoAnswers: boolean[] = []
mock.module('../../../src/core/onboarding/prompts', () => ({
  readLine: async () => '',
  askYesNo: async (_q: string, dflt: boolean) => (yesNoAnswers.length ? yesNoAnswers.shift()! : dflt),
  formatPrompt: (p: string) => p,
}))

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'
const TERRA = 'openai-codex/gpt-5.6-terra'
let defaultModel: string | null = LUNA
let catalog: Array<{ id: string; available: boolean; input?: string; unavailableReason?: 'no_credentials' }> = []
const policyWrites: Array<Record<string, unknown>> = []
const fakeRuntime = {
  models: {
    listAvailable: async () => catalog,
    routingPolicy: async () => ({ defaultModel, defaultSubagentModel: null, fallbackModels: [], aliases: {} }),
    setRoutingPolicy: async (patch: Record<string, unknown>) => { policyWrites.push(patch); if (typeof patch.defaultModel === 'string') defaultModel = patch.defaultModel },
    routingSupport: () => ({ defaultModel: true, perTurnModel: true, supportedThinkingLevels: ['off', 'low'], defaultSubagentModel: false, fallbackModels: false, aliases: false, subagentModel: false }),
  },
  agents: { list: async () => [] },
  credentials: { providers: async () => ({ evidence: 'complete', providers: [{ providerId: 'openai-codex', configured: true }, { providerId: 'openai', configured: false }] }) },
  credentialStatus: async () => ({ llmProviders: ['openai-codex'], channels: [], llmCredentials: [{ provider: 'openai-codex', kind: 'oauth' }] }),
}
mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => ({ runtime: fakeRuntime }),
  createAppServices: async () => ({ runtime: fakeRuntime }),
}))

import { modelsComponent } from '../../../src/core/onboarding/models'
import { readPluginSettings, writePluginSettings } from '../../../packages/core/src/plugins/settings-store'
import { closeDb } from '../../../packages/core/src/storage/db'

const YES = { interactive: false, autoApprove: true, json: false, checkOnly: false, force: false } as never
const APPROVED = { interactive: false, autoApprove: false, json: false, checkOnly: false, force: false, approvedComponents: ['models'] } as never
const INTERACTIVE = { interactive: true, autoApprove: false, json: false, checkOnly: false, force: false } as never
const SILENT = { interactive: false, autoApprove: false, json: false, checkOnly: false, force: false } as never

function routes(): Array<{ workClass: string; model?: string }> {
  return readPluginSettings<{ routing?: { routes: Array<{ workClass: string; model?: string }> } }>('models').routing?.routes ?? []
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
  yesNoAnswers = []
  policyWrites.length = 0
  defaultModel = LUNA
  catalog = [
    { id: LUNA, available: true, input: 'text,image' },
    { id: TERRA, available: true, input: 'text,image' },
    { id: MINI, available: true, input: 'text' },
    { id: 'openai/gpt-6-astra', available: false, unavailableReason: 'no_credentials' },
  ]
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('models onboarding component (S7)', () => {
  it('fresh install: no persisted plan ⇒ missing, with the recommendation in the message', async () => {
    const r = await modelsComponent.check()
    expect(r.status).toBe('missing')
    expect(r.message).toContain(LUNA)
    expect(r.message).toContain(TERRA)
    expect(r.details).toMatchObject({ agent: LUNA, chores: TERRA, ops: 5 })
  })

  it('--yes on a fresh install applies the recommendation through the mutator; check() is then ok', async () => {
    const r = await modelsComponent.install(YES)
    expect(r.status).toBe('installed')
    expect(routes().map((x) => `${x.workClass}=${x.model}`).sort()).toEqual(['auto-title', 'enrichment', 'relay', 'skill-mapping', 'team-routing'].map((c) => `${c}=${TERRA}`))
    expect(policyWrites).toEqual([])
    expect((await modelsComponent.check()).status).toBe('ok')
  })

  it('explicit TUI approval applies; a non-interactive run without approval skips and writes nothing', async () => {
    expect((await modelsComponent.install(SILENT)).status).toBe('skipped')
    expect(routes()).toEqual([])
    expect((await modelsComponent.install(APPROVED)).status).toBe('installed')
    expect(routes()).toHaveLength(5)
  })

  it('interactive: asks, applies on yes, skips on no', async () => {
    yesNoAnswers = [false]
    expect((await modelsComponent.install(INTERACTIVE)).status).toBe('skipped')
    expect(routes()).toEqual([])
    yesNoAnswers = [true]
    expect((await modelsComponent.install(INTERACTIVE)).status).toBe('installed')
    expect(routes()).toHaveLength(5)
  })

  it('a dead default with NO persisted plan is repaired by --yes (the permitted carve-out): the policy op lands', async () => {
    defaultModel = 'openai/gpt-6-astra'
    expect((await modelsComponent.check()).status).toBe('missing')
    const r = await modelsComponent.install(YES)
    expect(r.status).toBe('installed')
    expect(policyWrites).toEqual([{ defaultModel: LUNA }])
  })

  it('a persisted plan with a dead lane is a WARN with remediation — never auto-applied, even with --yes', async () => {
    writePluginSettings('models', { routing: { routes: ['auto-title', 'enrichment', 'relay', 'skill-mapping', 'team-routing'].map((workClass) => ({ workClass, model: TERRA })), tagOverrides: [] } })
    defaultModel = 'openai/gpt-6-astra'
    const r = await modelsComponent.check()
    expect(r.status).toBe('warn')
    expect(r.remediation).toContain('bakin models plan')
    expect(policyWrites).toEqual([])
  })

  it('a persisted plan whose lanes are eligible + suitable is ok, whatever the recommendation would prefer', async () => {
    writePluginSettings('models', { routing: { routes: ['auto-title', 'enrichment', 'relay', 'skill-mapping', 'team-routing'].map((workClass) => ({ workClass, model: LUNA })), tagOverrides: [] } })
    expect((await modelsComponent.check()).status).toBe('ok')
  })

  it('a persisted plan whose enrichment route cannot see images is a warn', async () => {
    writePluginSettings('models', { routing: { routes: ['auto-title', 'enrichment', 'relay', 'skill-mapping', 'team-routing'].map((workClass) => ({ workClass, model: MINI })), tagOverrides: [] } })
    const r = await modelsComponent.check()
    expect(r.status).toBe('warn')
    expect(r.message).toContain('enrichment')
  })

  it('nothing eligible ⇒ missing; install skips with the credentials hint', async () => {
    catalog = [{ id: 'openai/gpt-6-astra', available: false, unavailableReason: 'no_credentials' }]
    defaultModel = 'openai/gpt-6-astra'
    expect((await modelsComponent.check()).status).toBe('missing')
    const r = await modelsComponent.install(YES)
    expect(r.status).toBe('skipped')
    expect(r.message).toContain('credentials')
  })
})
