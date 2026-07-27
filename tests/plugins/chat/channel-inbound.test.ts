/**
 * Chat plugin — inbound channel wiring (#669 Phase B).
 * Real store on a temp dir; the turn engine is mocked (startChatTurn spy);
 * the runtime channels surface is a fake.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import fs from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-inbound-${Date.now()}`)

function testPaths() {
  return { home: testDir, chat: join(testDir, 'chat'), settings: join(testDir, 'settings.json'), db: join(testDir, 'bakin.db') }
}
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: testPaths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: testPaths }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const startedTurns: Array<{ chatId: string; content: string; attachments?: unknown[] }> = []
mock.module('../../../plugins/chat/lib/stream-bridge', () => ({
  startChatTurn: async (_ctx: unknown, chatId: string, content: string, attachments?: unknown[]) => {
    startedTurns.push({ chatId, content, attachments })
    return 'accepted'
  },
}))

import type { InboundChannelMessage } from '../../../packages/core/src/adapters/runtime/channels'
import { wireChannelInbound, extractReplyText } from '../../../plugins/chat/lib/channel-inbound'
import {
  createChat,
  findChatByExternalKey,
  listChats,
  appendTranscriptRow,
  attachmentsDir,
} from '../../../plugins/chat/lib/store'

type BusHandler = (event: string, data: Record<string, unknown>) => void

function makeCtx(opts: { imageInput?: boolean; withInbound?: boolean } = {}) {
  let inboundHandler: ((m: InboundChannelMessage) => void) | null = null
  const sends: Array<{ channels: string[]; body: string }> = []
  const typing: string[] = []
  const busHandlers = new Map<string, Set<BusHandler>>()

  const channels = {
    list: async () => [{ id: 'discord:channel:77', platform: 'discord', label: '#lounge', capabilities: ['message'] }],
    sendNotification: async () => ({ deliveries: [] }),
    sendMessage: async (args: { channels: string[]; message: { body: string } }) => {
      sends.push({ channels: args.channels, body: args.message.body })
      return { deliveries: [] }
    },
    deliverContent: async () => ({ deliveries: [] }),
    createApproval: async () => ({ deliveries: [] }),
    editApproval: async () => ({ deliveries: [] }),
    cancelApproval: async () => {},
    resolveApproval: async () => {},
    subscribeApprovalResponses: () => () => {},
    ...(opts.withInbound === false ? {} : {
      subscribeInboundMessages: (handler: (m: InboundChannelMessage) => void) => {
        inboundHandler = handler
        return () => { inboundHandler = null }
      },
      sendTyping: async (args: { channel: string }) => { typing.push(args.channel) },
    }),
  }

  const ctx = {
    runtime: {
      channels,
      capabilities: async () => ({ input: { imageInput: opts.imageInput ?? true } }),
    },
    events: {
      on: (pattern: string, handler: BusHandler) => {
        let set = busHandlers.get(pattern)
        if (!set) { set = new Set(); busHandlers.set(pattern, set) }
        set.add(handler)
        return () => set!.delete(handler)
      },
      emit: (event: string, data: Record<string, unknown>) => {
        for (const handler of busHandlers.get(event) ?? []) handler(event, data)
      },
    },
  }
  return {
    ctx: ctx as never,
    sends,
    typing,
    emit: ctx.events.emit,
    inbound: (m: InboundChannelMessage) => inboundHandler?.(m),
  }
}

function inboundMessage(overrides: Partial<InboundChannelMessage> = {}): InboundChannelMessage {
  return {
    platform: 'discord',
    channelRef: 'discord:channel:77',
    authorId: 'owner-1',
    authorName: 'mark',
    text: 'hello agent',
    messageRef: 'message:m1',
    ...overrides,
  }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20))

/** Minimal real-PNG-magic payload — the image lane sniffs bytes now. */
const pngBytes = (tag: string) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(tag)])

describe('chat channel inbound wiring', () => {
  beforeEach(() => {
    startedTurns.length = 0
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(join(testDir, 'chat'), { recursive: true })
  })
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('creates a bound chat (channel-label title) and starts a turn', async () => {
    const { ctx, inbound } = makeCtx()
    wireChannelInbound(ctx)
    inbound(inboundMessage())
    await settle()

    const chat = findChatByExternalKey('discord:channel:77')
    expect(chat).not.toBeNull()
    expect(chat!.title).toBe('#lounge · Discord')
    expect(startedTurns).toEqual([{ chatId: chat!.id, content: 'hello agent', attachments: [] }])
  })

  it('typing rides the engine lifecycle: pulses on chat.started, stops on chat.done', async () => {
    const { ctx, emit, typing } = makeCtx()
    wireChannelInbound(ctx)
    const chat = await createChat({ agentId: 'main', title: 't', externalKey: 'discord:channel:77' })
    emit('chat.started', { chatId: chat.id, agentId: 'main' })
    await settle()
    expect(typing.length).toBeGreaterThanOrEqual(1)
    const pulses = typing.length
    emit('chat.done', { chatId: chat.id, agentId: 'main', aborted: true })
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(typing.length).toBe(pulses) // interval cleared — no further pulses
  })

  it('a burst of first-contact messages binds exactly ONE chat (creation race)', async () => {
    const { ctx, inbound } = makeCtx()
    wireChannelInbound(ctx)
    inbound(inboundMessage({ text: 'one' }))
    inbound(inboundMessage({ text: 'two' }))
    await settle()
    expect(listChats()).toHaveLength(1)
    expect(new Set(startedTurns.map(t => t.chatId)).size).toBe(1)
  })

  it('uniquifies colliding attachment names instead of overwriting earlier rows', async () => {
    const fileA = join(testDir, 'a-image.png')
    const fileB = join(testDir, 'b-image.png')
    fs.writeFileSync(fileA, pngBytes('first'))
    fs.writeFileSync(fileB, pngBytes('second'))
    const { ctx, inbound } = makeCtx({ imageInput: true })
    wireChannelInbound(ctx)
    inbound(inboundMessage({ attachments: [{ name: 'image.png', path: fileA, contentType: 'image/png' }] }))
    await settle()
    inbound(inboundMessage({ text: 'second', attachments: [{ name: 'image.png', path: fileB, contentType: 'image/png' }] }))
    await settle()

    const chat = findChatByExternalKey('discord:channel:77')!
    const dir = attachmentsDir(chat.id)
    const files = fs.readdirSync(dir).sort()
    expect(files).toHaveLength(2)
    expect(fs.readFileSync(join(dir, 'image.png')).equals(pngBytes('first'))).toBe(true) // original untouched
  })

  it('reuses the bound chat for the same channel', async () => {
    const { ctx, inbound } = makeCtx()
    wireChannelInbound(ctx)
    inbound(inboundMessage())
    await settle()
    inbound(inboundMessage({ text: 'second' }))
    await settle()
    expect(listChats()).toHaveLength(1)
    expect(startedTurns).toHaveLength(2)
    expect(startedTurns[1].chatId).toBe(startedTurns[0].chatId)
  })

  it('posts the assistant reply back to the channel on chat.done', async () => {
    const { ctx, sends, emit } = makeCtx()
    wireChannelInbound(ctx)
    const chat = await createChat({ agentId: 'main', title: 't', externalKey: 'discord:channel:77' })
    await appendTranscriptRow(chat.id, { kind: 'user', ts: '1', content: 'q' })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: '2', content: 'the answer' })
    emit('chat.done', { chatId: chat.id, agentId: 'main' })
    await settle()
    expect(sends).toEqual([{ channels: ['discord:channel:77'], body: 'the answer' }])
  })

  it('never posts for aborted turns or unbound chats', async () => {
    const { ctx, sends, emit } = makeCtx()
    wireChannelInbound(ctx)
    const bound = await createChat({ agentId: 'main', title: 't', externalKey: 'discord:channel:77' })
    await appendTranscriptRow(bound.id, { kind: 'user', ts: '1', content: 'q' })
    await appendTranscriptRow(bound.id, { kind: 'assistant', ts: '2', content: 'a' })
    emit('chat.done', { chatId: bound.id, agentId: 'main', aborted: true })

    const unbound = await createChat({ agentId: 'main', title: 'web chat' })
    await appendTranscriptRow(unbound.id, { kind: 'user', ts: '1', content: 'q' })
    await appendTranscriptRow(unbound.id, { kind: 'assistant', ts: '2', content: 'a' })
    emit('chat.done', { chatId: unbound.id, agentId: 'main' })
    await settle()
    expect(sends).toHaveLength(0)
  })

  it('posts an honest failure message on chat.error', async () => {
    const { ctx, sends, emit } = makeCtx()
    wireChannelInbound(ctx)
    const chat = await createChat({ agentId: 'main', title: 't', externalKey: 'discord:channel:77' })
    emit('chat.error', { chatId: chat.id, agentId: 'main', message: 'model exploded' })
    await settle()
    expect(sends).toHaveLength(1)
    expect(sends[0].body).toContain('model exploded')
  })

  it('adopts image attachments into the chat attachment dir when the agent supports images', async () => {
    const tempFile = join(testDir, 'incoming.png')
    fs.writeFileSync(tempFile, pngBytes('one'))
    const { ctx, inbound } = makeCtx({ imageInput: true })
    wireChannelInbound(ctx)
    inbound(inboundMessage({ attachments: [{ name: 'incoming.png', path: tempFile, contentType: 'image/png' }] }))
    await settle()

    const chat = findChatByExternalKey('discord:channel:77')!
    const attachments = startedTurns[0].attachments as Array<{ name: string; path: string }>
    expect(attachments).toHaveLength(1)
    expect(attachments[0].path).toBe(join(attachmentsDir(chat.id), 'incoming.png'))
    expect(fs.readFileSync(attachments[0].path).equals(pngBytes('one'))).toBe(true)
    expect(fs.existsSync(tempFile)).toBe(false) // temp file consumed
  })

  it('degrades images to a saved-file note when the agent lacks image input', async () => {
    const tempFile = join(testDir, 'incoming.png')
    fs.writeFileSync(tempFile, pngBytes('one'))
    const { ctx, inbound } = makeCtx({ imageInput: false })
    wireChannelInbound(ctx)
    inbound(inboundMessage({ attachments: [{ name: 'incoming.png', path: tempFile, contentType: 'image/png' }] }))
    await settle()
    expect(startedTurns[0].attachments).toEqual([])
    expect(startedTurns[0].content).toContain('saved at')
    expect(startedTurns[0].content).toContain('no image input')
  })

  it('routes non-raster files (svg, pdf) to the FILE lane — never the image lane', async () => {
    const svgFile = join(testDir, 'logo.svg')
    fs.writeFileSync(svgFile, '<svg/>')
    const { ctx, inbound } = makeCtx({ imageInput: true })
    wireChannelInbound(ctx)
    inbound(inboundMessage({ attachments: [{ name: 'logo.svg', path: svgFile, contentType: 'image/svg+xml' }] }))
    await settle()

    const chat = findChatByExternalKey('discord:channel:77')!
    // The file lands in the chat's dir with its path noted for tool access —
    // an svg+xml data URL in the session would poison every later turn.
    expect(startedTurns[0].attachments).toEqual([])
    expect(startedTurns[0].content).toContain('logo.svg')
    expect(startedTurns[0].content).toContain('file tools')
    expect(fs.existsSync(join(attachmentsDir(chat.id), 'logo.svg'))).toBe(true)
  })

  it('sniffs bytes: a non-image labeled image/png goes to the FILE lane, not the model', async () => {
    const fake = join(testDir, 'fake.png')
    fs.writeFileSync(fake, 'MZ-this-is-not-a-png')
    const { ctx, inbound } = makeCtx({ imageInput: true })
    wireChannelInbound(ctx)
    inbound(inboundMessage({ attachments: [{ name: 'fake.png', path: fake, contentType: 'image/png' }] }))
    await settle()
    expect(startedTurns[0].attachments).toEqual([])
    expect(startedTurns[0].content).toContain('file tools')
  })

  it('sanitizes hostile filenames before they hit the attachment dir', async () => {
    const src = join(testDir, 'src-file')
    fs.writeFileSync(src, '<svg/>')
    const { ctx, inbound } = makeCtx({ imageInput: true })
    wireChannelInbound(ctx)
    inbound(inboundMessage({ attachments: [{ name: 'evil.svg+xml', path: src, contentType: 'image/svg+xml' }] }))
    await settle()
    const chat = findChatByExternalKey('discord:channel:77')!
    const files = fs.readdirSync(attachmentsDir(chat.id))
    expect(files).toHaveLength(1)
    expect(files[0]).toBe('evil.svg_xml') // '+' sanitized — no image/svg+xml mintable from the extension
  })

  it('/new-chat unbinds the chat so the next message starts fresh', async () => {
    const { ctx, inbound } = makeCtx()
    wireChannelInbound(ctx)
    inbound(inboundMessage())
    await settle()
    const first = findChatByExternalKey('discord:channel:77')!

    inbound(inboundMessage({ text: '', messageRef: 'interaction:i1', command: { name: 'new-chat' } }))
    await settle()
    expect(findChatByExternalKey('discord:channel:77')).toBeNull()
    expect(startedTurns).toHaveLength(1) // the command itself never starts a turn

    inbound(inboundMessage({ text: 'fresh start' }))
    await settle()
    const second = findChatByExternalKey('discord:channel:77')!
    expect(second.id).not.toBe(first.id)
    expect(listChats()).toHaveLength(2) // old chat keeps its history
  })

  it('is inert on runtimes without an inbound stream', () => {
    const { ctx } = makeCtx({ withInbound: false })
    const unsubscribe = wireChannelInbound(ctx)
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  it('unsubscribe detaches the inbound handler', async () => {
    const { ctx, inbound } = makeCtx()
    const unsubscribe = wireChannelInbound(ctx)
    unsubscribe()
    inbound(inboundMessage())
    await settle()
    expect(startedTurns).toHaveLength(0)
  })
})

describe('extractReplyText', () => {
  it('joins assistant rows after the last user row, skipping tool rows', () => {
    expect(extractReplyText([
      { kind: 'user', ts: '1', content: 'old q' },
      { kind: 'assistant', ts: '2', content: 'old a' },
      { kind: 'user', ts: '3', content: 'new q' },
      { kind: 'tool', ts: '4', toolName: 'search', status: 'completed' },
      { kind: 'assistant', ts: '5', content: 'part one' },
      { kind: 'assistant', ts: '6', content: 'part two' },
    ])).toBe('part one\n\npart two')
  })

  it('returns empty for turns with no assistant output', () => {
    expect(extractReplyText([{ kind: 'user', ts: '1', content: 'q' }])).toBe('')
  })

  it('handles drained combined turns (consecutive user rows before the reply)', () => {
    expect(extractReplyText([
      { kind: 'user', ts: '1', content: 'first queued' },
      { kind: 'user', ts: '2', content: 'second queued' },
      { kind: 'assistant', ts: '3', content: 'combined answer' },
    ])).toBe('combined answer')
  })
})
