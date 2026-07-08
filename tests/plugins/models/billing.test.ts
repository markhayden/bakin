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
  detectLanesFromProfiles,
  resolveProviderForModel,
  resolveLaneFor,
  resolveBilling,
  _resetBillingCache,
  type BillingOverride,
} from '../../../plugins/models/lib/billing'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('detectLanesFromProfiles', () => {
  it('classifies apiKey entries as metered and OAuth-only entries as subscription', () => {
    const lanes = detectLanesFromProfiles([
      { provider: 'google', apiKey: 'k1' },
      { provider: 'openai-codex', access: 'oauth-access', refresh: 'oauth-refresh' },
      { provider: 'anthropic', token: 'oauth-token' },
    ])
    expect(lanes).toEqual({ google: 'metered', 'openai-codex': 'subscription', anthropic: 'subscription' })
  })

  it('a key wins when an entry carries both key and OAuth fields', () => {
    expect(detectLanesFromProfiles([{ provider: 'openai', api_key: 'k', token: 't' }])).toEqual({ openai: 'metered' })
  })

  it('handles all three profile shapes and skips credential-less entries', () => {
    const entry = { provider: 'google', apiKey: 'k' }
    expect(detectLanesFromProfiles([entry, { provider: 'empty' }])).toEqual({ google: 'metered' })
    expect(detectLanesFromProfiles({ profiles: [entry] })).toEqual({ google: 'metered' })
    expect(detectLanesFromProfiles({ profiles: { g: entry } })).toEqual({ google: 'metered' })
    expect(detectLanesFromProfiles(null)).toEqual({})
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
    expect(resolveLaneFor({ provider: 'unknown', agentId: 'a', overrides: [], detected: {} })).toBe('metered')
  })
  it('uses detection when no override matches', () => {
    expect(resolveLaneFor({ provider: 'openai-codex', agentId: 'a', overrides: [], detected })).toBe('subscription')
  })
  it('provider override beats detection; agent override beats provider; agent+provider beats all', () => {
    const overrides: BillingOverride[] = [
      { provider: 'openai-codex', lane: 'metered' },
      { agentId: 'a', lane: 'subscription' },
      { agentId: 'a', provider: 'openai-codex', lane: 'metered' },
    ]
    // agent+provider (metered) beats agent (subscription) beats provider (metered) beats detected (subscription)
    expect(resolveLaneFor({ provider: 'openai-codex', agentId: 'a', overrides, detected })).toBe('metered')
    expect(resolveLaneFor({ provider: 'google', agentId: 'a', overrides, detected })).toBe('subscription') // agent-wide override
    expect(resolveLaneFor({ provider: 'openai-codex', agentId: 'b', overrides, detected })).toBe('metered') // provider override
  })
})

describe('resolveBilling (ctx-bound)', () => {
  function makeCtx(profiles: unknown, overrides: BillingOverride[] = []) {
    return {
      getSettings: () => ({ billing: { overrides } }),
      runtime: {
        config: {
          raw: async (key: string) => {
            if (!/^agents\.[^.]+\.authProfiles$/.test(key)) throw new Error(`unexpected key ${key}`)
            return profiles
          },
        },
      },
    } as never
  }

  it('resolves provider + lane from the agent profiles', async () => {
    _resetBillingCache()
    const ctx = makeCtx([{ provider: 'openai-codex', access: 'a', refresh: 'r' }])
    const billing = await resolveBilling(ctx, { agentId: 'main', model: 'openai-codex/gpt-5.5-codex' })
    expect(billing).toEqual({ provider: 'openai-codex', lane: 'subscription' })
  })

  it('defaults to metered when profiles are unreadable', async () => {
    _resetBillingCache()
    const ctx = {
      getSettings: () => ({}),
      runtime: { config: { raw: async () => { throw new Error('runtime down') } } },
    } as never
    const billing = await resolveBilling(ctx, { agentId: 'main', model: 'google/gemini-3-flash' })
    expect(billing).toEqual({ provider: 'google', lane: 'metered' })
  })

  it('applies overrides without an agentId (provider-wide)', async () => {
    _resetBillingCache()
    const ctx = makeCtx(null, [{ provider: 'google', lane: 'subscription' }])
    const billing = await resolveBilling(ctx, { model: 'google/gemini-3-flash' })
    expect(billing).toEqual({ provider: 'google', lane: 'subscription' })
  })
})
