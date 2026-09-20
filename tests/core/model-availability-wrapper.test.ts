/**
 * #852 — the ONE recording chokepoint: withModelAvailabilityObservation
 * wraps the adapter at the factory so every consumer (dispatch, chat,
 * system sends, images) inherits rejection recording + success resolve
 * without per-call-site sprawl. Errors pass through byte-identical;
 * recording failures never mask the original failure.
 */
import { describe, test, expect, mock, afterAll, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-model-avail-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []
let auditThrows = false
mock.module('../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, _agent: string, data: Record<string, unknown> = {}) => {
    if (auditThrows) throw new Error('audit disk full')
    auditEvents.push({ event, data })
  },
}))

import { RuntimeError } from '../../packages/core/src/adapters/runtime'
import type { AgentRuntimeAdapter, ChatChunk } from '../../packages/core/src/adapters/runtime'
import { closeDb } from '../../packages/core/src/storage/db'
import { listModelRejections, recordModelRejection } from '../../src/core/execution-ledger'
import { withModelAvailabilityObservation } from '../../src/core/model-availability'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const DEAD = 'openai-codex/gpt-5.4-mini'

const rejection = () => new RuntimeError('Pi model rejected by account: nope', {
  kind: 'model_not_supported',
  providerInfo: { provider: 'openai-codex', model: DEAD },
})

function openRow(model: string) {
  return listModelRejections({ openOnly: true }).find((r) => r.model === model)
}

/** Minimal fake adapter — only the surfaces the wrapper touches. */
function fakeAdapter(overrides: {
  send?: AgentRuntimeAdapter['messaging']['send']
  streamChunks?: ChatChunk[]
  imagesGetter?: () => { generate: () => Promise<unknown>; edit: () => Promise<unknown> }
}): AgentRuntimeAdapter {
  const base = {
    messaging: {
      send: overrides.send ?? (async () => ({ id: '1', content: 'ok' })),
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          for (const chunk of overrides.streamChunks ?? [{ type: 'done' } as ChatChunk]) yield chunk
        },
      }),
    },
  } as unknown as AgentRuntimeAdapter
  if (overrides.imagesGetter) {
    Object.defineProperty(base, 'images', { get: overrides.imagesGetter, configurable: true })
  }
  return base
}

beforeEach(() => {
  auditEvents.length = 0
  auditThrows = false
})

describe('rejection edge (#852)', () => {
  test('send failure with model_not_supported records the rejection, audits once, and rethrows the SAME error instance', async () => {
    const err = rejection()
    const wrapped = withModelAvailabilityObservation(fakeAdapter({ send: async () => { throw err } }))
    let caught: unknown
    try {
      await wrapped.messaging.send({ agentId: 'a', content: 'hi', model: DEAD })
    } catch (e) { caught = e }
    expect(caught).toBe(err)
    expect(openRow(DEAD)).toBeDefined()
    expect(openRow(DEAD)!.provider).toBe('openai-codex')
    expect(auditEvents.filter((e) => e.event === 'model.rejected')).toHaveLength(1)

    // Repeat failure: debounced — recorded on the same row, no second audit.
    try { await wrapped.messaging.send({ agentId: 'a', content: 'hi', model: DEAD }) } catch { /* expected */ }
    expect(openRow(DEAD)!.occurrences).toBe(2)
    expect(auditEvents.filter((e) => e.event === 'model.rejected')).toHaveLength(1)
  })

  test('other error kinds record nothing and pass through', async () => {
    const err = new RuntimeError('cooldown', { kind: 'provider_cooldown', providerInfo: { model: 'p/live' } })
    const wrapped = withModelAvailabilityObservation(fakeAdapter({ send: async () => { throw err } }))
    await expect(wrapped.messaging.send({ agentId: 'a', content: 'x' })).rejects.toBe(err)
    expect(openRow('p/live')).toBeUndefined()
  })

  test('stream terminal error chunk with kind+model records the rejection; chunks pass through unchanged', async () => {
    const chunks: ChatChunk[] = [
      { type: 'text', content: 'partial' },
      { type: 'error', content: 'rejected', data: { kind: 'model_not_supported', model: 'p/stream-dead' } },
    ]
    const wrapped = withModelAvailabilityObservation(fakeAdapter({ streamChunks: chunks }))
    const seen: ChatChunk[] = []
    for await (const chunk of wrapped.messaging.stream({ agentId: 'a', content: 'x', model: 'p/stream-dead' })) seen.push(chunk)
    expect(seen).toEqual(chunks)
    expect(openRow('p/stream-dead')).toBeDefined()
  })

  test('a recording failure (audit throws) never masks the turn error', async () => {
    auditThrows = true
    const err = rejection()
    const wrapped = withModelAvailabilityObservation(fakeAdapter({ send: async () => { throw err } }))
    await expect(wrapped.messaging.send({ agentId: 'a', content: 'x' })).rejects.toBe(err)
  })
})

describe('success edge', () => {
  test('explicit-model send success resolves the open rejection and audits the flip once', async () => {
    recordModelRejection({ model: 'p/back-alive', at: 1 })
    const wrapped = withModelAvailabilityObservation(fakeAdapter({}))
    await wrapped.messaging.send({ agentId: 'a', content: 'x', model: 'p/back-alive' })
    expect(openRow('p/back-alive')).toBeUndefined()
    expect(auditEvents.filter((e) => e.event === 'model.rejection_resolved')).toHaveLength(1)

    // Second success: nothing open — no write, no audit spam.
    await wrapped.messaging.send({ agentId: 'a', content: 'x', model: 'p/back-alive' })
    expect(auditEvents.filter((e) => e.event === 'model.rejection_resolved')).toHaveLength(1)
  })

  test('inherit-model success (no args.model) resolves nothing — the actual model is adapter-private', async () => {
    recordModelRejection({ model: 'p/unknown-actual', at: 1 })
    const wrapped = withModelAvailabilityObservation(fakeAdapter({}))
    await wrapped.messaging.send({ agentId: 'a', content: 'x' })
    expect(openRow('p/unknown-actual')).toBeDefined()
  })

  test('stream reaching done with an explicit model resolves the open rejection', async () => {
    recordModelRejection({ model: 'p/stream-alive', at: 1 })
    const wrapped = withModelAvailabilityObservation(fakeAdapter({}))
    for await (const _ of wrapped.messaging.stream({ agentId: 'a', content: 'x', model: 'p/stream-alive' })) { /* drain */ }
    expect(openRow('p/stream-alive')).toBeUndefined()
  })
})

describe('images + adapter shape', () => {
  test('images.generate rejection records the carrier; success resolves via provider + metadata.carrierModel', async () => {
    const carrierErr = new RuntimeError('backend 400', {
      kind: 'model_not_supported',
      providerInfo: { provider: 'openai-codex', model: 'openai-codex/gpt-dead-carrier' },
    })
    let fail = true
    const adapter = fakeAdapter({
      imagesGetter: () => ({
        generate: async () => {
          if (fail) throw carrierErr
          return { images: [], provider: 'openai-codex', model: 'gpt-image-2', metadata: { carrierModel: 'gpt-dead-carrier' } }
        },
        edit: async () => ({ images: [] }),
      }),
    })
    const wrapped = withModelAvailabilityObservation(adapter)
    await expect(wrapped.images!.generate({ prompt: 'x' } as never)).rejects.toBe(carrierErr)
    expect(openRow('openai-codex/gpt-dead-carrier')).toBeDefined()

    fail = false
    await wrapped.images!.generate({ prompt: 'x' } as never)
    expect(openRow('openai-codex/gpt-dead-carrier')).toBeUndefined()
  })

  test('the wrapper never forces lazy surface getters at wrap time', () => {
    let accesses = 0
    const adapter = fakeAdapter({
      imagesGetter: () => {
        accesses += 1
        return { generate: async () => ({}), edit: async () => ({}) }
      },
    })
    const wrapped = withModelAvailabilityObservation(adapter)
    expect(accesses).toBe(0)
    void wrapped.images
    expect(accesses).toBe(1)
  })

  test('an adapter without images exposes undefined through the wrapper', () => {
    const wrapped = withModelAvailabilityObservation(fakeAdapter({}))
    expect(wrapped.images).toBeUndefined()
  })
})
