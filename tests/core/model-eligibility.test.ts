/**
 * Model eligibility engine (#907 / #852 / #378 slice) — the ONE place that
 * turns four independent facts (in catalog, runtime-available, credentialed,
 * not rejected) into eligible / ineligible-with-reason / unknown. Pure fold
 * over injected sources; the runtime is an explicit argument.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-eligibility-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createMockRuntimeAdapter, mockCredentials } from '../../packages/core/src/adapters/runtime/testing'
import type { RuntimeAvailableModel } from '../../packages/core/src/adapters/runtime'
import { getModelEligibility, type EligibilityDeps } from '../../src/core/model-eligibility'

const CATALOG: RuntimeAvailableModel[] = [
  { id: 'openai-codex/gpt-5.5', available: true },
  { id: 'openai/gpt-5.6-luna', available: false, unavailableReason: 'no_credentials' },
  { id: 'anthropic/claude-opus-4-6', available: false },
  { id: 'ollama/llama', available: true, local: true },
]

function runtimeWith(opts: {
  catalog?: RuntimeAvailableModel[] | Error
  credentials?: ReturnType<typeof mockCredentials> | 'absent'
}) {
  const base = createMockRuntimeAdapter(opts.credentials && opts.credentials !== 'absent' ? { credentials: opts.credentials } : {})
  return {
    ...base,
    models: {
      ...base.models,
      listAvailable: async () => {
        if (opts.catalog instanceof Error) throw opts.catalog
        return opts.catalog ?? CATALOG
      },
    },
  }
}

const noRejections: EligibilityDeps = { listOpenRejections: () => [] }
const rejectedCodex: EligibilityDeps = {
  listOpenRejections: () => [{ model: 'openai-codex/gpt-5.5', occurrences: 3, lastSeenAt: 1_700_000_000_000 }],
}
const ledgerDown: EligibilityDeps = { listOpenRejections: () => { throw new Error('ledger op failed') } }

const complete = () => mockCredentials([
  { providerId: 'openai-codex', configured: true },
  { providerId: 'openai', configured: false },
  { providerId: 'anthropic', configured: false },
])

describe('getModelEligibility — facts → verdict', () => {
  it('a configured provider with a catalog-available model is eligible', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: complete() }), {}, noRejections)
    expect(report.byModel.get('openai-codex/gpt-5.5')!.eligibility).toEqual({ status: 'eligible' })
    expect(report.evidence).toEqual({ catalog: 'ok', runtimeAvailability: 'ok', credentials: 'ok', rejections: 'ok' })
  })

  it("Pi's available:false with reason no_credentials reads as no_credentials — never as retired (S1)", async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: complete() }), {}, noRejections)
    const e = report.byModel.get('openai/gpt-5.6-luna')!.eligibility
    expect(e.status).toBe('ineligible')
    expect(e.status === 'ineligible' && e.reason).toBe('no_credentials')
    expect(e.status === 'ineligible' && e.detail).toMatch(/no credentials for openai/)
  })

  it('runtime available:false WITHOUT a reason reads as runtime_unavailable (no invented story)', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: mockCredentials([{ providerId: 'anthropic', configured: true }]) }), {}, noRejections)
    const e = report.byModel.get('anthropic/claude-opus-4-6')!.eligibility
    expect(e.status === 'ineligible' && e.reason).toBe('runtime_unavailable')
  })

  it('a provider absent from a COMPLETE inventory is credential-less', async () => {
    const catalog: RuntimeAvailableModel[] = [{ id: 'google/gemini', available: true }]
    const report = await getModelEligibility(runtimeWith({ catalog, credentials: complete() }), {}, noRejections)
    expect(report.byModel.get('google/gemini')!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
  })

  it('a provider absent from a PARTIAL inventory is unknown, not credential-less', async () => {
    const catalog: RuntimeAvailableModel[] = [{ id: 'google/gemini', available: true }]
    const partial = mockCredentials([{ providerId: 'anthropic', configured: true }], 'partial')
    const report = await getModelEligibility(runtimeWith({ catalog, credentials: partial }), {}, noRejections)
    expect(report.byModel.get('google/gemini')!.eligibility.status).toBe('unknown')
    expect(report.evidence.credentials).toBe('partial')
  })

  it('an open account rejection is ineligible even when the credential read failed (independent facts)', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: 'absent' }), {}, rejectedCodex)
    const e = report.byModel.get('openai-codex/gpt-5.5')!.eligibility
    expect(e.status === 'ineligible' && e.reason).toBe('account_rejected')
    expect(e.status === 'ineligible' && e.detail).toMatch(/3 failures/)
    expect(report.evidence.credentials).toBe('failed')
  })

  it('local / auth-free models need no credentials', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: complete() }), {}, noRejections)
    expect(report.byModel.get('ollama/llama')!.eligibility).toEqual({ status: 'eligible' })
    const authFree = mockCredentials([{ providerId: 'ollama', configured: false, authFree: true }])
    const report2 = await getModelEligibility(runtimeWith({ catalog: [{ id: 'ollama/other', available: true }], credentials: authFree }), {}, noRejections)
    expect(report2.byModel.get('ollama/other')!.eligibility).toEqual({ status: 'eligible' })
  })

  it('a missing credentials member is failed evidence: models read unknown, never ineligible', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: 'absent' }), {}, noRejections)
    expect(report.evidence.credentials).toBe('failed')
    expect(report.byModel.get('openai-codex/gpt-5.5')!.eligibility.status).toBe('unknown')
    // The runtime's OWN verdict still stands where it gave one.
    expect(report.byModel.get('openai/gpt-5.6-luna')!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
  })

  it('a failed catalog read makes every model unknown (and never offers a reason)', async () => {
    const report = await getModelEligibility(runtimeWith({ catalog: new Error('gateway down'), credentials: complete() }), { extraIds: ['openai-codex/gpt-5.5'] }, noRejections)
    expect(report.evidence.catalog).toBe('failed')
    expect(report.byModel.get('openai-codex/gpt-5.5')!.eligibility.status).toBe('unknown')
  })

  it('a persisted selection the catalog lacks is not_in_catalog', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: complete() }), { extraIds: ['openai-codex/gpt-4.9-retired'] }, noRejections)
    expect(report.byModel.get('openai-codex/gpt-4.9-retired')!.eligibility).toMatchObject({ status: 'ineligible', reason: 'not_in_catalog' })
  })

  it('ledger down ⇒ rejection evidence failed, everything else still decided', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: complete() }), {}, ledgerDown)
    expect(report.evidence.rejections).toBe('failed')
    expect(report.byModel.get('openai-codex/gpt-5.5')!.eligibility.status).toBe('unknown')
    expect(report.byModel.get('openai/gpt-5.6-luna')!.eligibility).toMatchObject({ status: 'ineligible', reason: 'no_credentials' })
  })

  it('carries the epoch it was computed under', async () => {
    const report = await getModelEligibility(runtimeWith({ credentials: complete() }), { epoch: 7 }, noRejections)
    expect(report.epoch).toBe(7)
  })
})
