import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-send-${Date.now()}`)

const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []
const idempotencyRows = new Map<string, unknown>()
let hookResults: Record<string, unknown> = {}
let ledgerThrows = false

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, _agent: string, data: Record<string, unknown>) => {
    auditEvents.push({ event, data })
  },
}))
mock.module('../../../src/core/execution-ledger', () => ({
  getIdempotent: (key: string) => {
    if (ledgerThrows) throw new Error('ledger unavailable')
    return idempotencyRows.has(key) ? { kind: 'delivery', result: idempotencyRows.get(key) } : null
  },
  putIdempotent: (key: string, _kind: string, result: unknown) => {
    if (ledgerThrows) throw new Error('ledger unavailable')
    idempotencyRows.set(key, result)
  },
}))
mock.module('../../../packages/core/src/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (name: string) => {
      if (name in hookResults) return hookResults[name]
      throw new Error(`no hook ${name}`)
    },
  }),
}))

import { createSendSurface, chunkDiscordText, type SendApi } from '../../../src/core/delivery/discord/send'

interface SentMessage { channelId: string; payload: Record<string, unknown> }

function makeApi(overrides: Partial<SendApi> = {}) {
  const sent: SentMessage[] = []
  const edits: Array<{ channelId: string; messageId: string; body: string }> = []
  let counter = 0
  const api: SendApi = {
    createMessage: async (channelId, payload) => {
      sent.push({ channelId, payload: payload as Record<string, unknown> })
      counter += 1
      return { id: `m${counter}` }
    },
    editMessage: async (channelId, messageId, body) => {
      edits.push({ channelId, messageId, body })
    },
    startThread: async () => ({ id: 'thread-1' }),
    createDM: async (userId) => ({ id: `dm-${userId}` }),
    showTyping: async () => {},
    ...overrides,
  }
  return { api, sent, edits }
}

function makeSurface(api: SendApi, opts: { maxUploadBytes?: number } = {}) {
  return createSendSurface({
    api,
    maxUploadBytes: opts.maxUploadBytes ?? 25 * 1024 * 1024,
    sleep: async () => {},
  })
}

describe('discord send surface', () => {
  beforeEach(() => {
    auditEvents.length = 0
    idempotencyRows.clear()
    hookResults = {}
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
  })
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('sends a message: title+body joined, delivery ref from first message', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    const result = await surface.sendMessage({
      channels: ['discord:channel:123'],
      message: { title: 'Hi', body: 'there' },
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].channelId).toBe('123')
    expect(sent[0].payload.content).toBe('Hi\n\nthere')
    expect(result.deliveries).toEqual([
      { channelId: 'discord:channel:123', ref: 'message:m1', renderedAt: expect.any(String) },
    ])
    expect(auditEvents.some(e => e.event === 'delivery.sent')).toBe(true)
  })

  it('chunks long content at 2000 chars; ref is the first chunk', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    const body = 'a'.repeat(2500)
    const result = await surface.sendMessage({ channels: ['channel:1'], message: { body } })
    expect(sent).toHaveLength(2)
    expect((sent[0].payload.content as string).length).toBeLessThanOrEqual(2000)
    expect(result.deliveries[0].ref).toBe('message:m1')
  })

  it('sends DMs via discord:user:<id> refs', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    await surface.sendMessage({ channels: ['discord:user:42'], message: { body: 'yo' } })
    expect(sent[0].channelId).toBe('dm-42')
  })

  it('retries transient failures then succeeds without a failure audit', async () => {
    let failures = 2
    const { api, sent } = makeApi({
      createMessage: async (channelId, payload) => {
        if (failures > 0) { failures -= 1; throw new Error('flaky') }
        return { id: 'ok-1' }
      },
    })
    void sent
    const surface = makeSurface(api)
    const result = await surface.sendMessage({ channels: ['channel:1'], message: { body: 'x' } })
    expect(result.deliveries[0].ref).toBe('message:ok-1')
    expect(auditEvents.some(e => e.event === 'delivery.send_failed')).toBe(false)
  })

  it('audits delivery.send_failed after exhausting retries', async () => {
    const { api } = makeApi({ createMessage: async () => { throw new Error('down hard') } })
    const surface = makeSurface(api)
    await expect(surface.sendMessage({ channels: ['channel:1'], message: { body: 'x' } })).rejects.toThrow('down hard')
    expect(auditEvents.some(e => e.event === 'delivery.send_failed')).toBe(true)
  })

  it('renders notifications as severity-colored embeds with fields', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    await surface.sendNotification({
      channels: ['channel:9'],
      notification: {
        severity: 'error',
        title: 'Broken',
        body: 'It broke',
        fields: [{ label: 'Task', value: 't-1' }],
      },
    })
    const embeds = sent[0].payload.embeds as Array<Record<string, unknown>>
    expect(embeds).toHaveLength(1)
    expect(embeds[0].title).toBe('Broken')
    expect(embeds[0].description).toBe('It broke')
    expect(embeds[0].color).toBe(0xef4444)
    expect(embeds[0].fields).toEqual([{ name: 'Task', value: 't-1', inline: true }])
  })

  it('delivers content with path-file attachments', async () => {
    const filePath = join(testDir, 'report.txt')
    fs.writeFileSync(filePath, 'file-content')
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    await surface.deliverContent({
      channels: ['channel:1'],
      content: { title: 'Report', body: 'attached', files: [{ name: 'report.txt', path: filePath }] },
    })
    const files = sent[0].payload.files as Array<{ name: string; data: Uint8Array }>
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe('report.txt')
    expect(Buffer.from(files[0].data).toString()).toBe('file-content')
  })

  it('degrades oversize attachments to an honest note instead of failing', async () => {
    const filePath = join(testDir, 'big.bin')
    fs.writeFileSync(filePath, Buffer.alloc(64, 1))
    const { api, sent } = makeApi()
    const surface = makeSurface(api, { maxUploadBytes: 10 })
    await surface.deliverContent({
      channels: ['channel:1'],
      content: { title: 'Big', body: 'see attachment', files: [{ name: 'big.bin', path: filePath }] },
    })
    expect(sent[0].payload.files ?? []).toHaveLength(0)
    expect(String(sent[0].payload.content)).toContain('big.bin')
    expect(String(sent[0].payload.content)).toContain('too large')
  })

  it('resolves { kind: asset } refs through the assets hook', async () => {
    const assetPath = join(testDir, 'asset.png')
    fs.writeFileSync(assetPath, 'png-bytes')
    hookResults['assets.resolveServe'] = { path: assetPath, contentType: 'image/png' }
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    await surface.deliverContent({
      channels: ['channel:1'],
      content: { title: 'Asset', files: [{ kind: 'asset', filename: 'my-asset', mimeType: 'image/png' }] },
    })
    const files = sent[0].payload.files as Array<{ name: string; data: Uint8Array }>
    expect(files).toHaveLength(1)
    expect(Buffer.from(files[0].data).toString()).toBe('png-bytes')
  })

  it('creates threads and returns a discord channelRef', async () => {
    const { api } = makeApi()
    const surface = makeSurface(api)
    const thread = await surface.createThread({ channel: 'discord:channel:5', messageRef: 'message:m9', name: 'Discussion' })
    expect(thread).toEqual({ threadId: 'thread-1', channelRef: 'discord:channel:thread-1' })
  })

  it('edits messages by delivery ref', async () => {
    const { api, edits } = makeApi()
    const surface = makeSurface(api)
    await surface.editMessage({ channel: 'discord:channel:5', messageRef: 'message:m2', body: 'updated' })
    expect(edits).toEqual([{ channelId: '5', messageId: 'm2', body: 'updated' }])
  })

  it('suppresses duplicate sends behind metadata.idempotencyKey', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    const first = await surface.sendMessage({
      channels: ['channel:1'],
      message: { body: 'once', metadata: { idempotencyKey: 'alert-42' } },
    })
    const second = await surface.sendMessage({
      channels: ['channel:1'],
      message: { body: 'once', metadata: { idempotencyKey: 'alert-42' } },
    })
    expect(sent).toHaveLength(1)
    expect(second.deliveries).toEqual(first.deliveries)
  })
})

describe('chunkDiscordText', () => {
  it('returns short text whole and splits on newlines when possible', () => {
    expect(chunkDiscordText('hi', 2000)).toEqual(['hi'])
    const chunks = chunkDiscordText(`${'a'.repeat(1500)}\n${'b'.repeat(1000)}`, 2000)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toBe('a'.repeat(1500))
  })

  it('hard-splits a single overlong line', () => {
    const chunks = chunkDiscordText('x'.repeat(4100), 2000)
    expect(chunks.map(c => c.length)).toEqual([2000, 2000, 100])
  })
})

describe('review-hardening regressions', () => {
  beforeEach(() => {
    auditEvents.length = 0
    idempotencyRows.clear()
  })

  it('fails fast on deterministic 4xx errors (no retry)', async () => {
    let attempts = 0
    const { api } = makeApi({
      createMessage: async () => {
        attempts += 1
        const err = new Error('Missing Access') as Error & { status: number }
        err.status = 403
        throw err
      },
    })
    const surface = makeSurface(api)
    await expect(surface.sendMessage({ channels: ['channel:1'], message: { body: 'x' } })).rejects.toThrow('Missing Access')
    expect(attempts).toBe(1)
  })

  it('per-channel idempotency: a retry after partial failure re-sends only the failed channel', async () => {
    let failSecond = true
    const posted: string[] = []
    const { api } = makeApi({
      createMessage: async (channelId) => {
        if (failSecond && channelId === '2') {
          const err = new Error('unknown channel') as Error & { status: number }
          err.status = 404
          throw err
        }
        posted.push(channelId)
        return { id: `m-${channelId}-${posted.length}` }
      },
    })
    const surface = makeSurface(api)
    const args = {
      channels: ['channel:1', 'channel:2'],
      message: { body: 'multi', metadata: { idempotencyKey: 'multi-1' } },
    }
    await expect(surface.sendMessage(args)).rejects.toThrow('unknown channel')
    expect(posted).toEqual(['1'])

    failSecond = false
    const result = await surface.sendMessage(args)
    // channel:1 suppressed by its recorded delivery; only channel:2 posts.
    expect(posted).toEqual(['1', '2'])
    expect(result.deliveries).toHaveLength(2)
  })

  it('a failed idempotency write never converts a delivered send into a failure', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    ledgerThrows = true
    try {
      const result = await surface.sendMessage({
        channels: ['channel:1'],
        message: { body: 'x', metadata: { idempotencyKey: 'k1' } },
      })
      expect(result.deliveries).toHaveLength(1)
      expect(sent).toHaveLength(1)
    } finally {
      ledgerThrows = false
    }
  })

  it('unreadable path files degrade to a visible omission, not a failed delivery', async () => {
    const { api, sent } = makeApi()
    const surface = makeSurface(api)
    await surface.deliverContent({
      channels: ['channel:1'],
      content: { title: 'Doc', files: [{ name: 'gone.txt', path: join(testDir, 'does-not-exist.txt') }] },
    })
    expect(sent).toHaveLength(1)
    expect(String(sent[0].payload.content)).toContain('gone.txt')
    expect(String(sent[0].payload.content)).toContain('could not be read')
  })
})
