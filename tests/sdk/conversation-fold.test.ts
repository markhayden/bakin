/**
 * foldConversation — THE single folding engine for conversation surfaces
 * (spec: .claude/specs/chat-conversation-kit.md §4.1). Subsumes the three
 * prior implementations (foldTurnChunks, brainstorm activity folding,
 * use-chat-data text coalescing) and fixes their shared limitation: item
 * ORDER inside a turn is preserved (text → tools → text), instead of
 * hoisting all tools above the text.
 *
 * Pure logic — no DOM, no React.
 */
import { describe, expect, it } from 'bun:test'

import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import {
  foldConversation,
  type ConversationMessage,
} from '@makinbakin/sdk/conversation'

const text = (content: string, format?: 'markdown' | 'plain' | 'code'): RuntimeChatChunk =>
  ({ type: 'text', content, ...(format ? { format } : {}) })

const toolCall = (over: Record<string, unknown> = {}): RuntimeChatChunk =>
  ({ type: 'tool', data: { phase: 'call', toolName: 'web_search', ...over } }) as RuntimeChatChunk

const toolResult = (over: Record<string, unknown> = {}): RuntimeChatChunk =>
  ({ type: 'tool', data: { phase: 'result', toolName: 'web_search', status: 'completed', ...over } }) as RuntimeChatChunk

const user = (content: string, over: Partial<ConversationMessage> = {}): ConversationMessage =>
  ({ kind: 'user', ts: '2026-07-11T10:00:00.000Z', content, ...over }) as ConversationMessage

describe('foldConversation — live chunks', () => {
  it('coalesces consecutive same-format text and splits on format change, in order', () => {
    const turns = foldConversation([], {
      liveChunks: [text('Hello '), text('world'), text('raw', 'plain'), text(' bytes', 'plain'), text('back')],
    })
    expect(turns).toHaveLength(1)
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    expect(turn.status).toBe('streaming')
    expect(turn.items).toEqual([
      { type: 'text', format: 'markdown', content: 'Hello world' },
      { type: 'text', format: 'plain', content: 'raw bytes' },
      { type: 'text', format: 'markdown', content: 'back' },
    ])
  })

  it('groups consecutive tool chunks into ONE activity item and preserves interleaving with text', () => {
    const turns = foldConversation([], {
      liveChunks: [
        toolCall({ callId: 'c1', summary: 'q1' }),
        toolResult({ callId: 'c1' }),
        toolCall({ callId: 'c2', summary: 'q2' }),
        toolResult({ callId: 'c2' }),
        text('interim finding'),
        toolCall({ callId: 'c3', toolName: 'web_fetch', summary: 'url' }),
      ],
    })
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    expect(turn.items.map((i) => i.type)).toEqual(['activity', 'text', 'activity'])
    const first = turn.items[0]
    if (first.type !== 'activity') throw new Error('expected activity')
    expect(first.calls.map((c) => c.callId)).toEqual(['c1', 'c2'])
    expect(first.calls.every((c) => c.status === 'completed')).toBe(true)
    const second = turn.items[2]
    if (second.type !== 'activity') throw new Error('expected activity')
    expect(second.calls).toEqual([
      expect.objectContaining({ callId: 'c3', toolName: 'web_fetch', status: 'running', summary: 'url' }),
    ])
  })

  it('pairs a result to its call by callId ACROSS a text boundary (earlier group settles, no new chip)', () => {
    const turns = foldConversation([], {
      liveChunks: [
        toolCall({ callId: 'c1', summary: 'slow query' }),
        text('while that runs…'),
        toolResult({ callId: 'c1', durationMs: 1200 }),
      ],
    })
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    expect(turn.items.map((i) => i.type)).toEqual(['activity', 'text'])
    const activity = turn.items[0]
    if (activity.type !== 'activity') throw new Error('expected activity')
    expect(activity.calls).toEqual([
      expect.objectContaining({ callId: 'c1', status: 'completed', summary: 'slow query', durationMs: 1200 }),
    ])
  })

  it('a callId-less result closes the MOST RECENT running call of the same tool; earlier ones stay', () => {
    const turns = foldConversation([], {
      liveChunks: [
        toolCall({ summary: 'first' }),
        toolCall({ summary: 'second' }),
        toolResult({}),
      ],
    })
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    const activity = turn.items[0]
    if (activity.type !== 'activity') throw new Error('expected activity')
    expect(activity.calls).toHaveLength(2)
    expect(activity.calls[0]).toMatchObject({ summary: 'first', status: 'running' })
    expect(activity.calls[1]).toMatchObject({ summary: 'second', status: 'completed' })
  })

  it('an orphan callId-less result settles as its own call (no crash, no spinner)', () => {
    const turns = foldConversation([], {
      liveChunks: [toolResult({ toolName: 'web_fetch', status: 'failed', summary: 'timeout' })],
    })
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    const activity = turn.items[0]
    if (activity.type !== 'activity') throw new Error('expected activity')
    expect(activity.calls).toEqual([
      expect.objectContaining({ toolName: 'web_fetch', status: 'failed', summary: 'timeout' }),
    ])
  })

  it('a result keeps the call summary when the result has none, and merges previews/duration', () => {
    const turns = foldConversation([], {
      liveChunks: [
        toolCall({ callId: 'c1', summary: 'ls -la', inputPreview: '{"cmd":"ls"}' }),
        toolResult({ callId: 'c1', outputPreview: 'file1\nfile2', durationMs: 40 }),
      ],
    })
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    const activity = turn.items[0]
    if (activity.type !== 'activity') throw new Error('expected activity')
    expect(activity.calls[0]).toMatchObject({
      summary: 'ls -la',
      inputPreview: '{"cmd":"ls"}',
      outputPreview: 'file1\nfile2',
      durationMs: 40,
      status: 'completed',
    })
  })

  it('latest status chunk wins as the streaming label; done marks the turn complete', () => {
    const streaming = foldConversation([], {
      liveChunks: [{ type: 'status', content: 'thinking' }, { type: 'status', content: 'reading files' }],
    })
    const s = streaming[0]
    if (s.kind !== 'agent') throw new Error('expected agent turn')
    expect(s.status).toBe('streaming')
    expect(s.statusLabel).toBe('reading files')

    const done = foldConversation([], { liveChunks: [text('hi'), { type: 'done' }] })
    const d = done[0]
    if (d.kind !== 'agent') throw new Error('expected agent turn')
    expect(d.status).toBe('complete')
  })

  it('an error chunk ends the turn as error with a typed item', () => {
    const turns = foldConversation([], {
      liveChunks: [text('partial'), { type: 'error', content: 'boom', data: { kind: 'transport' } }],
    })
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    expect(turn.status).toBe('error')
    expect(turn.items).toEqual([
      { type: 'text', format: 'markdown', content: 'partial' },
      { type: 'error', message: 'boom', errorKind: 'transport' },
    ])
  })

  it('empty live chunks still produce a streaming turn (the thinking placeholder)', () => {
    const turns = foldConversation([], { liveChunks: [] })
    expect(turns).toHaveLength(1)
    const turn = turns[0]
    if (turn.kind !== 'agent') throw new Error('expected agent turn')
    expect(turn.status).toBe('streaming')
    expect(turn.items).toEqual([])
  })
})

describe('foldConversation — persisted rows', () => {
  const rows: ConversationMessage[] = [
    user('find me a reddit post'),
    { kind: 'tool', ts: '2026-07-11T10:00:01.000Z', turnId: 't1', callId: 'c1', toolName: 'web_search', status: 'completed', summary: 'site:reddit.com', durationMs: 900 },
    { kind: 'tool', ts: '2026-07-11T10:00:02.000Z', turnId: 't1', callId: 'c2', toolName: 'web_search', status: 'failed', summary: 'second query' },
    { kind: 'assistant', ts: '2026-07-11T10:00:03.000Z', turnId: 't1', content: 'Here is the post.' },
    user('thanks'),
    { kind: 'assistant', ts: '2026-07-11T10:01:00.000Z', turnId: 't2', content: 'Anytime.' },
  ]

  it('groups rows into user/agent turns with tool rows folded into activity items', () => {
    const turns = foldConversation(rows)
    expect(turns.map((t) => t.kind)).toEqual(['user', 'agent', 'user', 'agent'])
    const agent1 = turns[1]
    if (agent1.kind !== 'agent') throw new Error('expected agent turn')
    // Agent turns expose their turnId (#733 — the usage-footer join key);
    // legacy rows without one fold to an undefined turnId.
    expect(agent1.turnId).toBe('t1')
    const agent2 = turns[3]
    if (agent2.kind !== 'agent') throw new Error('expected agent turn')
    expect(agent2.turnId).toBe('t2')
    const legacy = foldConversation([user('hi'), { kind: 'assistant', ts: '2026-07-11T10:00:01.000Z', content: 'no turn id' }])
    const legacyAgent = legacy[1]
    if (legacyAgent.kind !== 'agent') throw new Error('expected agent turn')
    expect(legacyAgent.turnId).toBeUndefined()
    expect(agent1.status).toBe('complete')
    expect(agent1.items.map((i) => i.type)).toEqual(['activity', 'text'])
    const activity = agent1.items[0]
    if (activity.type !== 'activity') throw new Error('expected activity')
    expect(activity.calls).toEqual([
      expect.objectContaining({ callId: 'c1', status: 'completed', durationMs: 900 }),
      expect.objectContaining({ callId: 'c2', status: 'failed' }),
    ])
  })

  it('splits agent turns by turnId even without an intervening user row', () => {
    const turns = foldConversation([
      user('go'),
      { kind: 'assistant', ts: '2026-07-11T10:00:01.000Z', turnId: 'a', content: 'first turn' },
      { kind: 'assistant', ts: '2026-07-11T10:00:02.000Z', turnId: 'b', content: 'second turn' },
    ])
    expect(turns.map((t) => t.kind)).toEqual(['user', 'agent', 'agent'])
  })

  it('groups legacy rows WITHOUT turnId into one agent turn between user rows', () => {
    const turns = foldConversation([
      user('legacy question'),
      { kind: 'tool', ts: '2026-07-11T10:00:01.000Z', toolName: 'bash', status: 'completed', summary: 'ls' } as ConversationMessage,
      { kind: 'assistant', ts: '2026-07-11T10:00:02.000Z', content: 'legacy answer' } as ConversationMessage,
      user('next'),
    ])
    expect(turns.map((t) => t.kind)).toEqual(['user', 'agent', 'user'])
    const agent = turns[1]
    if (agent.kind !== 'agent') throw new Error('expected agent turn')
    expect(agent.items.map((i) => i.type)).toEqual(['activity', 'text'])
  })

  it('done marker rows are invisible: never split a turn, never open a phantom one (#735)', () => {
    // Mid-transcript and trailing markers across two turns — the fold must
    // produce exactly the turns the content rows describe.
    const turns = foldConversation([
      user('q1'),
      { kind: 'assistant', ts: '2026-07-26T10:00:01.000Z', turnId: 'a', content: 'answer one' },
      { kind: 'done', ts: '2026-07-26T10:00:02.000Z', turnId: 'a' },
      user('q2'),
      { kind: 'assistant', ts: '2026-07-26T10:01:01.000Z', turnId: 'b', content: 'answer two' },
      { kind: 'done', ts: '2026-07-26T10:01:02.000Z', turnId: 'b' },
    ] as ConversationMessage[])
    expect(turns.map((t) => t.kind)).toEqual(['user', 'agent', 'user', 'agent'])
    const second = turns[3]
    if (second.kind !== 'agent') throw new Error('expected agent turn')
    // Trailing marker: the turn still folds complete with its turnId intact.
    expect(second.status).toBe('complete')
    expect(second.turnId).toBe('b')
    expect(second.items).toEqual([{ type: 'text', format: 'markdown', content: 'answer two' }])

    // A done row wedged between two turnIds must not merge or split them —
    // the split comes from the content rows alone.
    const backToBack = foldConversation([
      user('go'),
      { kind: 'assistant', ts: '2026-07-26T10:00:01.000Z', turnId: 'a', content: 'first' },
      { kind: 'done', ts: '2026-07-26T10:00:02.000Z', turnId: 'a' },
      { kind: 'assistant', ts: '2026-07-26T10:00:03.000Z', turnId: 'b', content: 'second' },
    ] as ConversationMessage[])
    expect(backToBack.map((t) => t.kind)).toEqual(['user', 'agent', 'agent'])

    // A done row with no open builder must not open a phantom agent turn.
    const bare = foldConversation([
      user('hi'),
      { kind: 'done', ts: '2026-07-26T10:00:01.000Z', turnId: 'x' },
    ] as ConversationMessage[])
    expect(bare.map((t) => t.kind)).toEqual(['user'])
  })

  it('error and aborted rows mark the turn status and render as items/footers', () => {
    const errored = foldConversation([
      user('q'),
      { kind: 'assistant', ts: '2026-07-11T10:00:01.000Z', turnId: 't', content: 'partial' },
      { kind: 'error', ts: '2026-07-11T10:00:02.000Z', turnId: 't', message: 'session died', errorKind: 'session_died' },
    ])
    const errTurn = errored[1]
    if (errTurn.kind !== 'agent') throw new Error('expected agent turn')
    expect(errTurn.status).toBe('error')
    expect(errTurn.items).toContainEqual({ type: 'error', message: 'session died', errorKind: 'session_died' })

    const aborted = foldConversation([
      user('q'),
      { kind: 'assistant', ts: '2026-07-11T10:00:01.000Z', turnId: 't', content: 'partial' },
      { kind: 'aborted', ts: '2026-07-11T10:00:02.000Z', turnId: 't' },
    ])
    const abTurn = aborted[1]
    if (abTurn.kind !== 'agent') throw new Error('expected agent turn')
    expect(abTurn.status).toBe('aborted')
  })

  it('user turns carry content, timestamp, and attachments', () => {
    const turns = foldConversation([
      user('look at this', {
        attachments: [{ name: 'shot.png', mimeType: 'image/png', url: '/api/plugins/chat/chats/x/attachments/shot.png' }],
      }),
    ])
    const u = turns[0]
    if (u.kind !== 'user') throw new Error('expected user turn')
    expect(u.content).toBe('look at this')
    expect(u.ts).toBe('2026-07-11T10:00:00.000Z')
    expect(u.attachments).toEqual([
      { name: 'shot.png', mimeType: 'image/png', url: '/api/plugins/chat/chats/x/attachments/shot.png' },
    ])
  })

  it('appends the live turn AFTER persisted turns', () => {
    const turns = foldConversation([user('q'), { kind: 'assistant', ts: '2026-07-11T10:00:01.000Z', turnId: 't1', content: 'done earlier' }], {
      liveChunks: [text('streaming now')],
    })
    expect(turns.map((t) => t.kind)).toEqual(['user', 'agent', 'agent'])
    const live = turns[2]
    if (live.kind !== 'agent') throw new Error('expected agent turn')
    expect(live.status).toBe('streaming')
    expect(live.items).toEqual([{ type: 'text', format: 'markdown', content: 'streaming now' }])
  })

  it('agent turns carry the agentId from their rows; liveAgentId labels the live turn', () => {
    const turns = foldConversation(
      [
        user('q'),
        { kind: 'assistant', ts: '2026-07-11T10:00:01.000Z', turnId: 't1', agentId: 'research', content: 'from research' },
      ],
      { liveChunks: [text('live')], liveAgentId: 'main' },
    )
    const persisted = turns[1]
    if (persisted.kind !== 'agent') throw new Error('expected agent turn')
    expect(persisted.agentId).toBe('research')
    const live = turns[2]
    if (live.kind !== 'agent') throw new Error('expected agent turn')
    expect(live.agentId).toBe('main')
  })

  it('turn keys are stable and unique across the conversation', () => {
    const turns = foldConversation(rows, { liveChunks: [text('live')] })
    const keys = turns.map((t) => t.key)
    expect(new Set(keys).size).toBe(keys.length)
    // re-fold yields identical keys (stability across re-renders)
    expect(foldConversation(rows, { liveChunks: [text('live')] }).map((t) => t.key)).toEqual(keys)
  })
})
