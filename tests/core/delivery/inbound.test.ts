import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-inbound-${Date.now()}`)
const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []

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

import type { InboundChannelMessage } from '../../../packages/core/src/adapters/runtime/channels'
import { createInboundSurface, type InboundSurfaceDeps } from '../../../src/core/delivery/discord/inbound'

const BOT_ID = 'bot-1'
const OWNER = 'owner-9'

function makeSurface(overrides: Partial<InboundSurfaceDeps> = {}) {
  const received: InboundChannelMessage[] = []
  const surface = createInboundSurface({
    botUserId: () => BOT_ID,
    settings: () => ({
      enabled: true,
      inbound: { enabled: true, agentId: 'main', requireMention: true, allowFrom: [OWNER] },
    }),
    download: async () => Buffer.from('img-bytes'),
    tmpDir: testDir,
    ...overrides,
  })
  surface.subscribe(message => received.push(message))
  return { surface, received }
}

function guildMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    channel_id: 'chan-5',
    guild_id: 'guild-1',
    content: 'hey bot',
    author: { id: OWNER, username: 'mark' },
    mentions: [{ id: BOT_ID }],
    attachments: [],
    ...overrides,
  }
}

describe('discord inbound gating', () => {
  beforeEach(() => {
    auditEvents.length = 0
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
  })
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('emits a neutral message for a mentioned, allowlisted guild message', async () => {
    const { surface, received } = makeSurface()
    await surface.handleMessage(guildMessage())
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      platform: 'discord',
      channelRef: 'discord:channel:chan-5',
      authorId: OWNER,
      authorName: 'mark',
      text: 'hey bot',
      messageRef: 'message:msg-1',
    })
  })

  it('ignores guild messages without an @mention (requireMention)', async () => {
    const { surface, received } = makeSurface()
    await surface.handleMessage(guildMessage({ mentions: [] }))
    expect(received).toHaveLength(0)
    expect(auditEvents).toHaveLength(0) // not a denial — just not addressed to the bot
  })

  it('allows unmentioned guild messages when requireMention is off', async () => {
    const { surface, received } = makeSurface({
      settings: () => ({
        enabled: true,
        inbound: { enabled: true, agentId: 'main', requireMention: false, allowFrom: [OWNER] },
      }),
    })
    await surface.handleMessage(guildMessage({ mentions: [] }))
    expect(received).toHaveLength(1)
  })

  it('DMs (no guild_id) need no mention', async () => {
    const { surface, received } = makeSurface()
    await surface.handleMessage(guildMessage({ guild_id: undefined, mentions: [] }))
    expect(received).toHaveLength(1)
  })

  it('denies non-allowlisted senders with an audit, never an emit — and never a download', async () => {
    let downloads = 0
    const { surface, received } = makeSurface({
      download: async () => { downloads += 1; return Buffer.from('x') },
    })
    await surface.handleMessage(guildMessage({
      author: { id: 'stranger', username: 'x' },
      attachments: [{ id: 'a1', filename: 'shot.png', url: 'https://cdn.example/shot.png', content_type: 'image/png', size: 10 }],
    }))
    expect(received).toHaveLength(0)
    expect(downloads).toBe(0) // denied senders cost zero CDN fetches
    expect(auditEvents.some(e => e.event === 'delivery.inbound_denied')).toBe(true)
  })

  it('fails closed on an empty allowlist', async () => {
    const { surface, received } = makeSurface({
      settings: () => ({
        enabled: true,
        inbound: { enabled: true, agentId: 'main', requireMention: true, allowFrom: [] },
      }),
    })
    await surface.handleMessage(guildMessage())
    expect(received).toHaveLength(0)
    expect(auditEvents.some(e => e.event === 'delivery.inbound_denied')).toBe(true)
  })

  it('ignores bot/self messages silently', async () => {
    const { surface, received } = makeSurface()
    await surface.handleMessage(guildMessage({ author: { id: BOT_ID, username: 'roscoe', bot: true } }))
    await surface.handleMessage(guildMessage({ author: { id: 'other-bot', username: 'b', bot: true } }))
    expect(received).toHaveLength(0)
    expect(auditEvents).toHaveLength(0)
  })

  it('ignores everything when inbound (or the bridge) is disabled', async () => {
    const { surface, received } = makeSurface({
      settings: () => ({
        enabled: true,
        inbound: { enabled: false, agentId: 'main', requireMention: true, allowFrom: [OWNER] },
      }),
    })
    await surface.handleMessage(guildMessage())
    expect(received).toHaveLength(0)
  })

  it('strips the bot mention from the text', async () => {
    const { surface, received } = makeSurface()
    await surface.handleMessage(guildMessage({ content: `<@${BOT_ID}> write a haiku` }))
    expect(received[0].text).toBe('write a haiku')
  })

  it('materializes attachments of ANY type; oversize is skipped with a visible note', async () => {
    const { surface, received } = makeSurface()
    await surface.handleMessage(guildMessage({
      attachments: [
        { id: 'a1', filename: 'shot.png', url: 'https://cdn.example/shot.png', content_type: 'image/png', size: 1000 },
        { id: 'a2', filename: 'notes.pdf', url: 'https://cdn.example/notes.pdf', content_type: 'application/pdf', size: 1000 },
        { id: 'a3', filename: 'huge.png', url: 'https://cdn.example/huge.png', content_type: 'image/png', size: 999_999_999 },
      ],
    }))
    const attachments = received[0].attachments ?? []
    expect(attachments.map(a => a.name)).toEqual(['shot.png', 'notes.pdf'])
    expect(fs.readFileSync(attachments[0].path).toString()).toBe('img-bytes')
    expect(received[0].text).toContain('huge.png')
    expect(received[0].text).toContain('skipped')
  })

  it('a failed attachment download degrades to text-only, never a dropped message', async () => {
    const { surface, received } = makeSurface({
      download: async () => { throw new Error('cdn down') },
    })
    await surface.handleMessage(guildMessage({
      attachments: [{ id: 'a1', filename: 'shot.png', url: 'https://cdn.example/shot.png', content_type: 'image/png', size: 10 }],
    }))
    expect(received).toHaveLength(1)
    expect(received[0].attachments ?? []).toHaveLength(0)
  })

  it('unsubscribe stops delivery', async () => {
    const { surface } = makeSurface()
    const late: InboundChannelMessage[] = []
    const unsubscribe = surface.subscribe(m => late.push(m))
    unsubscribe()
    await surface.handleMessage(guildMessage())
    expect(late).toHaveLength(0)
  })
})

describe('slash command handling', () => {
  const replies: string[] = []
  function commandSurface(allowFrom: string[] = [OWNER]) {
    const received: InboundChannelMessage[] = []
    const surface = createInboundSurface({
      botUserId: () => BOT_ID,
      settings: () => ({ enabled: true, inbound: { enabled: true, agentId: 'main', requireMention: true, allowFrom } }),
      download: async () => Buffer.from('x'),
      replyEphemeral: async (_id, _token, content) => { replies.push(content) },
      tmpDir: testDir,
    })
    surface.subscribe(m => received.push(m))
    return { surface, received }
  }
  const interaction = (name: string, userId = OWNER) => ({
    id: 'i1', token: 't', type: 2, data: { name }, channel_id: 'chan-9',
    member: { user: { id: userId, username: 'mark' } },
  })

  it('new-chat from an allowlisted user acks and emits a command message', async () => {
    replies.length = 0
    const { surface, received } = commandSurface()
    await surface.handleCommandInteraction(interaction('new-chat'))
    expect(received).toHaveLength(1)
    expect(received[0].command).toEqual({ name: 'new-chat' })
    expect(received[0].channelRef).toBe('discord:channel:chan-9')
    expect(replies.some(r => r.includes('Fresh chat'))).toBe(true)
  })

  it('denies non-allowlisted users ephemerally with an audit', async () => {
    replies.length = 0
    const { surface, received } = commandSurface(['someone-else'])
    await surface.handleCommandInteraction(interaction('new-chat'))
    expect(received).toHaveLength(0)
    expect(replies.some(r => r.includes('not authorized'))).toBe(true)
    expect(auditEvents.some(e => e.event === 'delivery.inbound_denied')).toBe(true)
  })

  it('acks the KNOWN command honestly when inbound is disabled (no ghost)', async () => {
    replies.length = 0
    const received: InboundChannelMessage[] = []
    const surface = createInboundSurface({
      botUserId: () => BOT_ID,
      settings: () => ({ enabled: true, inbound: { enabled: false, agentId: 'main', requireMention: true, allowFrom: [OWNER] } }),
      download: async () => Buffer.from('x'),
      replyEphemeral: async (_id, _token, content) => { replies.push(content) },
      tmpDir: testDir,
    })
    surface.subscribe(m => received.push(m))
    await surface.handleCommandInteraction(interaction('new-chat'))
    expect(received).toHaveLength(0)
    expect(replies.some(r => r.includes('disabled'))).toBe(true)
  })

  it("acks UNKNOWN commands honestly instead of Discord's did-not-respond ghost", async () => {
    replies.length = 0
    const { surface, received } = commandSurface()
    await surface.handleCommandInteraction(interaction('new'))
    expect(received).toHaveLength(0)
    expect(replies.some(r => r.includes('/new-chat'))).toBe(true)
  })
})
