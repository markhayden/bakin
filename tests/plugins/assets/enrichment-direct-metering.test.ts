/**
 * #747 metering rider — the DIRECT enrichment engine writes the same
 * work-class-`enrichment` spend row the runtime engine writes. ONE spend
 * path (meterAgentTurn), never parallel math.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-direct-metering-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

const metered: Array<Record<string, unknown>> = []
mock.module('../../../src/core/agent-cost', () => ({
  meterAgentTurn: async (opts: Record<string, unknown>) => {
    metered.push(opts)
  },
}))

const visionCalls: Array<Record<string, unknown>> = []
let visionResult: Record<string, unknown> = { caption: 'a scanned page' }
mock.module('@bakin/core/media', () => ({
  callDirectVisionProvider: async (request: Record<string, unknown>) => {
    visionCalls.push(request)
    return visionResult
  },
}))

import { createDirectEngine } from '../../../plugins/assets/lib/enrichment/direct'
import type { ResolvedEnrichmentModel } from '../../../plugins/assets/lib/enrichment/providers'

const resolved = {
  descriptor: { id: 'anthropic/claude-haiku-4-5', provider: 'anthropic', apiModel: 'claude-haiku-4-5' },
  apiKey: 'test-key',
} as unknown as ResolvedEnrichmentModel

describe('direct engine metering (#747)', () => {
  it('a successful call writes one enrichment spend row with the provider usage', async () => {
    metered.length = 0
    visionResult = { caption: 'ok', usage: { inputTokens: 1000, outputTokens: 40 } }
    const engine = createDirectEngine(resolved)
    const result = await engine.run({ kind: 'image', mediaPath: '/x.png', mediaMime: 'image/png', jobKey: 'asset1:v1' })
    expect(result.caption).toBe('ok')
    expect(metered).toHaveLength(1)
    const row = metered[0]!
    expect(row.workClass).toBe('enrichment')
    expect(row.agent).toBe('system')
    expect(row.activityClass).toBe('system')
    expect(row.resolvedModel).toBe('anthropic/claude-haiku-4-5')
    expect(row.name).toBe('enrichment')
    expect((row.result as { usage?: { input?: number; output?: number } }).usage).toEqual({ input: 1000, output: 40 })
  })

  it('usage-less responses still record the spend row (null tokens, never fabricated)', async () => {
    metered.length = 0
    visionResult = { caption: 'no usage reported' }
    const engine = createDirectEngine(resolved)
    await engine.run({ kind: 'image', mediaPath: '/x.png', mediaMime: 'image/png' })
    expect(metered).toHaveLength(1)
    expect((metered[0]!.result as { usage?: unknown }).usage).toBeUndefined()
  })

  it('a failed vision call records NOTHING (no spend row for un-billed failures)', async () => {
    metered.length = 0
    mock.module('@bakin/core/media', () => ({
      callDirectVisionProvider: async () => {
        throw new Error('vision 429')
      },
    }))
    const engine = createDirectEngine(resolved)
    await expect(engine.run({ kind: 'image', mediaPath: '/x.png', mediaMime: 'image/png' })).rejects.toThrow('429')
    expect(metered).toHaveLength(0)
  })
})
