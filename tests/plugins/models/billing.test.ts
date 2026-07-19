/**
 * Billing-lane detection + provider resolution (cost-control v2 T3).
 *
 * Lane semantics: apiKey/api_key on a provider's auth-profile entry →
 * 'metered' (pay-per-token dollars); only OAuth fields (token/access/refresh)
 * → 'subscription' (plan quota, tokens are the unit). Unknown → 'metered'
 * (conservative: unknown auth reads as real money). Manual overrides in
 * models settings win over detection; most-specific override first.
 */
import { describe, it, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-models-billing-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import {
  detectLanesFromCredentials,
  resolveProviderForModel,
  resolveLaneFor,
  resolveBilling,
  _resetBillingCache,
  type BillingOverride,
} from '../../../plugins/models/lib/billing'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('detectLanesFromCredentials', () => {
  // Credential SHAPE parsing (apiKey vs OAuth fields, the three profile
  // layouts) is adapter territory now — pinned in the adapter credential
  // tests. Here: the kind → lane mapping over the neutral report.
  it("maps 'api-key' to metered and 'oauth' to subscription", () => {
    const lanes = detectLanesFromCredentials([
      { provider: 'google', kind: 'api-key' },
      { provider: 'openai-codex', kind: 'oauth' },
      { provider: 'anthropic', kind: 'oauth' },
    ])
    expect(lanes).toEqual({ google: 'metered', 'openai-codex': 'subscription', anthropic: 'subscription' })
  })

  it('first entry per provider wins; absent report yields no lanes', () => {
    expect(detectLanesFromCredentials([
      { provider: 'openai', kind: 'api-key' },
      { provider: 'openai', kind: 'oauth' },
    ])).toEqual({ openai: 'metered' })
    expect(detectLanesFromCredentials(undefined)).toEqual({})
  })
})

describe('resolveProviderForModel', () => {
  it('takes the provider segment of provider/model ids', () => {
    expect(resolveProviderForModel('google/gemini-3-flash')).toBe('google')
    expect(resolveProviderForModel('openai-codex/gpt-5.5-codex')).toBe('openai-codex')
  })
  it('normalizes bare claude ids to anthropic', () => {
    expect(resolveProviderForModel('claude-sonnet-4-6')).toBe('anthropic')
  })
  it('buckets bare unknown ids and missing models as other', () => {
    expect(resolveProviderForModel('mystery-model')).toBe('other')
    expect(resolveProviderForModel(null)).toBe('other')
    expect(resolveProviderForModel(undefined)).toBe('other')
  })
})

describe('resolveLaneFor (override precedence)', () => {
  const detected = { google: 'metered', 'openai-codex': 'subscription' } as const

  it('defaults to metered when nothing matches', () => {
    expect(resolveLaneFor({ provider: 'unknown', agentId: 'a', overrides: [], detected: {} })).toEqual({ lane: 'metered', laneSource: 'default' })
  })
  it('uses detection when no override matches', () => {
    expect(resolveLaneFor({ provider: 'openai-codex', agentId: 'a', overrides: [], detected })).toEqual({ lane: 'subscription', laneSource: 'detected' })
  })
  it('provider override beats detection; agent override beats provider; agent+provider beats all', () => {
    const overrides: BillingOverride[] = [
      { provider: 'openai-codex', lane: 'metered' },
      { agentId: 'a', lane: 'subscription' },
      { agentId: 'a', provider: 'openai-codex', lane: 'metered' },
    ]
    // agent+provider (metered) beats agent (subscription) beats provider (metered) beats detected (subscription)
    expect(resolveLaneFor({ provider: 'openai-codex', agentId: 'a', overrides, detected })).toEqual({ lane: 'metered', laneSource: 'override' })
    expect(resolveLaneFor({ provider: 'google', agentId: 'a', overrides, detected })).toEqual({ lane: 'subscription', laneSource: 'override' }) // agent-wide override
    expect(resolveLaneFor({ provider: 'openai-codex', agentId: 'b', overrides, detected })).toEqual({ lane: 'metered', laneSource: 'override' }) // provider override
  })
})

describe('resolveBilling (ctx-bound)', () => {
  function makeCtx(credentials: Array<{ provider: string; kind: 'api-key' | 'oauth' }> | undefined, overrides: BillingOverride[] = []) {
    return {
      getSettings: () => ({ billing: { overrides } }),
      runtime: {
        credentialStatus: async (_opts?: { agentId?: string }) => ({
          llmProviders: (credentials ?? []).map((c) => c.provider),
          llmCredentials: credentials,
          channels: [],
        }),
      },
    } as never
  }

  it('resolves provider + lane from the runtime credential report', async () => {
    _resetBillingCache()
    const ctx = makeCtx([{ provider: 'openai-codex', kind: 'oauth' }])
    const billing = await resolveBilling(ctx, { agentId: 'main', model: 'openai-codex/gpt-5.5-codex' })
    expect(billing).toEqual({ provider: 'openai-codex', lane: 'subscription', laneSource: 'detected' })
  })

  it('defaults to metered when the credential report is unreadable', async () => {
    _resetBillingCache()
    const ctx = {
      getSettings: () => ({}),
      runtime: { credentialStatus: async () => { throw new Error('runtime down') } },
    } as never
    const billing = await resolveBilling(ctx, { agentId: 'main', model: 'google/gemini-3-flash' })
    expect(billing).toEqual({ provider: 'google', lane: 'metered', laneSource: 'default' })
  })

  it('applies overrides without an agentId (provider-wide)', async () => {
    _resetBillingCache()
    const ctx = makeCtx(undefined, [{ provider: 'google', lane: 'subscription' }])
    const billing = await resolveBilling(ctx, { model: 'google/gemini-3-flash' })
    expect(billing).toEqual({ provider: 'google', lane: 'subscription', laneSource: 'override' })
  })
})
