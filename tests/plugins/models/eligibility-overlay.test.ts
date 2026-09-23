/**
 * #907 — every /available read carries per-model ELIGIBILITY (catalog ×
 * runtime availability × credentials × rejections) and keeps unavailable
 * rows LISTED so pickers can show them disabled with the true reason
 * instead of silently dropping them. The cache stays a raw runtime
 * snapshot; eligibility is overlaid on every read like the #852 overlay.
 */
import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-elig-overlay-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { PluginContext } from '@bakin/core/plugin-types'
import { closeDb } from '../../../packages/core/src/storage/db'
import { recordModelRejection, resolveModelRejection } from '../../../src/core/execution-ledger'
import { fetchAvailableModels, getModelsCache, resetModelsCache, setModelsCache } from '../../../plugins/models/lib/available-models'
import { clearPersistedCache } from '../../../plugins/models/lib/models-cache'
import { resetEligibilityMemo } from '../../../src/core/model-eligibility'
import { toModelSelectOptions } from '../../../src/hooks/use-available-models'
import type { AvailableModel } from '../../../plugins/models/types'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const LIVE = 'openai-codex/gpt-5.5'
const NO_AUTH = 'openai/gpt-5.6-luna'

const UNREFERENCED = 'anthropic/claude-opus-4-6'
/** Runtime-available; whether it is CREDENTIALED depends on the agent asking (per-agent keys). */
const AGENT_KEYED = 'google/gemini-3-pro'
const runtimeRows = [
  { id: LIVE, name: 'GPT-5.5', available: true },
  { id: NO_AUTH, name: 'GPT-5.6 Luna', available: false, unavailableReason: 'no_credentials' as const },
  { id: UNREFERENCED, name: 'Opus', available: false, unavailableReason: 'no_credentials' as const },
  { id: AGENT_KEYED, name: 'Gemini 3 Pro', available: true },
]

function ctxWith(credentials?: { providers: () => Promise<unknown> }): PluginContext {
  return {
    runtime: {
      models: {
        listAvailable: async () => runtimeRows,
        routingPolicy: async () => ({ defaultModel: LIVE, fallbackModels: [], defaultSubagentModel: null, aliases: {} }),
      },
      // A persisted pin references the auth-less model — that row must stay listed.
      agents: { list: async () => [{ id: 'enrich', name: 'enrich', model: NO_AUTH }] },
      ...(credentials ? { credentials } : {}),
    },
    getSettings: () => ({}),
  } as unknown as PluginContext
}

const completeInventory = {
  providers: async () => ({
    providers: [{ providerId: 'openai-codex', configured: true }, { providerId: 'openai', configured: false }],
    evidence: 'complete' as const,
  }),
}

/** Only `enrich` holds a google key (OpenClaw keys auth per agent). */
const agentKeyedInventory = {
  providers: async (opts?: { agentId?: string }) => ({
    providers: [
      { providerId: 'openai-codex', configured: true },
      { providerId: 'openai', configured: false },
      { providerId: 'google', configured: opts?.agentId === 'enrich' },
    ],
    evidence: 'complete' as const,
  }),
}

beforeEach(() => {
  setModelsCache(null)
  clearPersistedCache()
  resetEligibilityMemo()
  resolveModelRejection({ model: LIVE, resolution: 'manual' })
})

describe('/available agent scope (#907 review) — a picker for ONE agent is judged under THAT agent\'s credentials', () => {
  test('unscoped: the agent-keyed provider is credential-less; scoped to the keyed agent: eligible', async () => {
    const unscoped = await fetchAvailableModels(ctxWith(agentKeyedInventory))
    expect(unscoped.models.find((m) => m.id === AGENT_KEYED)!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
    const scoped = await fetchAvailableModels(ctxWith(agentKeyedInventory), { agentId: 'enrich' })
    expect(scoped.models.find((m) => m.id === AGENT_KEYED)!.eligibility).toEqual({ status: 'eligible' })
    expect(scoped.models.find((m) => m.id === AGENT_KEYED)!.available).toBe(true)
    // A different agent without the key still sees it dead.
    const other = await fetchAvailableModels(ctxWith(agentKeyedInventory), { agentId: 'main' })
    expect(other.models.find((m) => m.id === AGENT_KEYED)!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
  })

  test('two cold reads in flight for different scopes share ONE runtime fetch but each get their own overlay', async () => {
    let listCalls = 0
    const ctx = ctxWith(agentKeyedInventory)
    const original = ctx.runtime.models.listAvailable
    ctx.runtime.models.listAvailable = async (opts) => { listCalls += 1; return original(opts) }
    const [scoped, unscoped] = await Promise.all([
      fetchAvailableModels(ctx, { agentId: 'enrich' }),
      fetchAvailableModels(ctx),
    ])
    expect(listCalls).toBe(1)
    expect(scoped.models.find((m) => m.id === AGENT_KEYED)!.eligibility).toEqual({ status: 'eligible' })
    expect(unscoped.models.find((m) => m.id === AGENT_KEYED)!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
  })
})

describe('/available eligibility overlay (#907)', () => {
  test('a REFERENCED unavailable row stays listed with the runtime\'s reason; an unreferenced one is pruned; live rows are eligible', async () => {
    const { models } = await fetchAvailableModels(ctxWith(completeInventory))
    expect(models.find((m) => m.id === UNREFERENCED)).toBeUndefined()
    const dead = models.find((m) => m.id === NO_AUTH)!
    expect(dead).toBeDefined()
    expect(dead.available).toBe(false)
    expect(dead.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
    expect(dead.eligibility!.status === 'ineligible' && dead.eligibility!.detail).toMatch(/no credentials for openai/)
    expect(models.find((m) => m.id === LIVE)!.eligibility).toEqual({ status: 'eligible' })
  })

  test('a runtime without credentials.providers() leaves live rows unknown (never ineligible)', async () => {
    const { models } = await fetchAvailableModels(ctxWith())
    expect(models.find((m) => m.id === LIVE)!.eligibility!.status).toBe('unknown')
    expect(models.find((m) => m.id === LIVE)!.available).toBe(true)
    // The runtime's own verdict still stands.
    expect(models.find((m) => m.id === NO_AUTH)!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
  })

  test('an open rejection is overlaid on a cache-served read as account_rejected with rejection facts', async () => {
    await fetchAvailableModels(ctxWith(completeInventory)) // warms the cache
    recordModelRejection({ model: LIVE, provider: 'openai-codex', detail: 'model_not_supported' })
    const { models, cached } = await fetchAvailableModels(ctxWith(completeInventory))
    expect(cached).toBe(true)
    const rejected = models.find((m) => m.id === LIVE)!
    expect(rejected.available).toBe(false)
    expect(rejected.rejection?.occurrences).toBe(1)
    expect(rejected.eligibility).toMatchObject({ status: 'ineligible', reason: 'account_rejected' })
  })
})

describe('toModelSelectOptions — pickers cannot select a dead model', () => {
  const rows: AvailableModel[] = [
    { id: LIVE, name: 'GPT-5.5', tier: 'premium', provider: 'openai-codex', eligibility: { status: 'eligible' } },
    { id: NO_AUTH, name: 'GPT-5.6 Luna', tier: 'premium', provider: 'openai', available: false, eligibility: { status: 'ineligible', reason: 'no_credentials', detail: 'no credentials for openai' } },
    { id: 'x/unverified', name: 'Unverified', tier: 'standard', provider: 'x', eligibility: { status: 'unknown', detail: "couldn't verify credentialed" } },
  ]

  test('ineligible ⇒ disabled with the reason in the label; eligible and unknown stay selectable', () => {
    const options = toModelSelectOptions(rows)
    expect(options.find((o) => o.id === LIVE)).toEqual({ id: LIVE, name: 'GPT-5.5', provider: 'openai-codex', disabled: false })
    expect(options.find((o) => o.id === NO_AUTH)).toEqual({ id: NO_AUTH, name: 'GPT-5.6 Luna — no credentials for openai', provider: 'openai', disabled: true })
    expect(options.find((o) => o.id === 'x/unverified')!.disabled).toBe(false)
  })
})

describe('resetModelsCache — epoch-guarded (D29)', () => {
  test('a fetch that started BEFORE the reset completes afterwards and publishes nothing', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const slowCtx = {
      runtime: {
        models: {
          listAvailable: async () => { await gate; return runtimeRows },
          routingPolicy: async () => ({ defaultModel: LIVE, fallbackModels: [], defaultSubagentModel: null, aliases: {} }),
        },
        agents: { list: async () => [{ id: 'enrich', name: 'enrich', model: NO_AUTH }] },
        credentials: completeInventory,
      },
      getSettings: () => ({}),
    } as unknown as PluginContext

    const inflight = fetchAvailableModels(slowCtx) // old runtime's catalog, still loading
    resetModelsCache() // the runtime switched underneath it
    release()
    const stale = await inflight
    expect(stale.models).toEqual([])
    expect(stale.error).toMatch(/runtime changed/)
    // Nothing from the old runtime reached the caches.
    expect(getModelsCache()).toBeNull()
    // The next caller fetches fresh.
    const fresh = await fetchAvailableModels(ctxWith(completeInventory))
    expect(fresh.models.map((m) => m.id).sort()).toEqual([NO_AUTH, LIVE, AGENT_KEYED].sort())
    expect(getModelsCache()).not.toBeNull()
  })
})
