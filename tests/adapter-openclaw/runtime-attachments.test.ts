/**
 * Turn attachments + ephemeral controls → OpenClaw gateway `agent` params
 * (spec: enrichment-runtime-fallback P1; wire facts in
 * tasks/evidence-enrichment-runtime.md §2/§5).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-att-'))

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }),
}))
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { createOpenClawRuntimeAdapter } from '@bakin/adapter-openclaw'
import {
  buildOpenClawAttachments,
  OPENCLAW_INLINE_IMAGE_MAX_BYTES,
} from '../../packages/adapter-openclaw/src/attachments'

// 1x1 red PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const mediaDir = join(testHome, 'media')
const pngPath = join(mediaDir, 'red.png')

beforeEach(() => {
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(pngPath, PNG)
})
afterAll(() => rmSync(testHome, { recursive: true, force: true }))

describe('buildOpenClawAttachments', () => {
  it('base64-inlines an image with mime + basename', () => {
    const [att] = buildOpenClawAttachments([{ path: pngPath, mimeType: 'image/png' }])
    expect(att.mimeType).toBe('image/png')
    expect(att.fileName).toBe('red.png')
    expect(Buffer.from(att.content, 'base64').equals(PNG)).toBe(true)
  })

  it('rejects non-image mimes loudly (gateway agent entrypoint is image-only)', () => {
    expect(() => buildOpenClawAttachments([{ path: pngPath, mimeType: 'application/pdf' }]))
      .toThrow(/only image\/\* attachments/)
  })

  it('rejects images over the 2MB inline ceiling — never silent pixel loss', () => {
    const bigPath = join(mediaDir, 'big.png')
    writeFileSync(bigPath, Buffer.alloc(OPENCLAW_INLINE_IMAGE_MAX_BYTES + 1))
    expect(() => buildOpenClawAttachments([{ path: bigPath, mimeType: 'image/png' }]))
      .toThrow(/exceeds the 2000000-byte inline limit/)
  })

  it('rejects missing files with a clear error', () => {
    expect(() => buildOpenClawAttachments([{ path: join(mediaDir, 'nope.png'), mimeType: 'image/png' }]))
      .toThrow(/not found or unreadable/)
  })
})

describe('messaging.send → gateway agent params', () => {
  function adapterWithCapturedGateway() {
    const adapter = createOpenClawRuntimeAdapter({ settings: { binaryPath: join(testHome, 'bin', 'openclaw') } })
    const captured: Array<{ method: string; params: Record<string, unknown> }> = []
    const fakeClient = {
      request: async (method: string, params: Record<string, unknown>) => {
        captured.push({ method, params })
        return { result: { meta: { finalAssistantVisibleText: '{"caption":"a red square"}' } } }
      },
    }
    // Private seam: the gateway client factory. The turn machinery around it
    // (params, trajectory watch, usage) is what this test exercises.
    ;(adapter as unknown as { openClawChatGateway: () => unknown }).openClawChatGateway = () => fakeClient
    return { adapter, captured }
  }

  it('maps attachments + ephemeral to the gateway payload', async () => {
    const { adapter, captured } = adapterWithCapturedGateway()
    const result = await adapter.messaging.send({
      agentId: 'main',
      content: 'Describe this image as JSON.',
      threadId: 'enrich:20260703-x:v1',
      attachments: [{ path: pngPath, mimeType: 'image/png' }],
      ephemeral: true,
    })
    expect(result.content).toContain('a red square')
    expect(captured).toHaveLength(1)
    const { method, params } = captured[0]
    expect(method).toBe('agent')
    expect(params.sessionEffects).toBe('internal')
    expect(params.suppressPromptPersistence).toBe(true)
    const attachments = params.attachments as Array<Record<string, unknown>>
    expect(attachments).toHaveLength(1)
    expect(attachments[0].mimeType).toBe('image/png')
    expect(attachments[0].fileName).toBe('red.png')
    expect(typeof attachments[0].content).toBe('string')
    // thread-scoped key with a per-turn content discriminator
    expect(String(params.idempotencyKey)).toStartWith('bakin:enrich:20260703-x:v1:')
  })

  it('distinct messages on ONE thread carry distinct idempotency keys (gateway dedupe must not swallow the corrective re-ask)', async () => {
    const { adapter, captured } = adapterWithCapturedGateway()
    const base = { agentId: 'main', threadId: 'enrich:as-1:v1', ephemeral: true as const }
    await adapter.messaging.send({ ...base, content: 'Describe this image as JSON.' })
    await adapter.messaging.send({ ...base, content: 'Reply with only the JSON object, nothing else.' })
    await adapter.messaging.send({ ...base, content: 'Describe this image as JSON.' })
    const keys = captured.map((c) => String(c.params.idempotencyKey))
    expect(keys[0]).not.toBe(keys[1]) // different turn → different key → a real second turn
    expect(keys[0]).toBe(keys[2])     // same turn re-sent → same key → transport retry stays idempotent
  })

  it('omits attachment/ephemeral params entirely on plain sends', async () => {
    const { adapter, captured } = adapterWithCapturedGateway()
    await adapter.messaging.send({ agentId: 'main', content: 'hi', threadId: 't1' })
    const { params } = captured[0]
    expect('attachments' in params).toBe(false)
    expect('sessionEffects' in params).toBe(false)
    expect('suppressPromptPersistence' in params).toBe(false)
  })

  it('a too-large attachment rejects the send before any gateway call', async () => {
    const { adapter, captured } = adapterWithCapturedGateway()
    const bigPath = join(mediaDir, 'huge.png')
    writeFileSync(bigPath, Buffer.alloc(OPENCLAW_INLINE_IMAGE_MAX_BYTES + 1))
    await expect(adapter.messaging.send({
      agentId: 'main',
      content: 'x',
      attachments: [{ path: bigPath, mimeType: 'image/png' }],
    })).rejects.toThrow(/inline limit/)
    expect(captured).toHaveLength(0)
  })
})
