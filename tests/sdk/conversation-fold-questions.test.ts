/**
 * Question items in the fold (projects revamp D4/D5). State is DERIVED from
 * the transcript — never stored: the next user row answers (prefix match) or
 * skips the card; only the last open card is answerable.
 *
 * Pure logic — no DOM, no React.
 */
import { describe, expect, it } from 'bun:test'

import type { BakinQuestion, RuntimeChatChunk } from '@makinbakin/sdk/types'
import {
  foldConversation,
  formatQuestionAnswer,
  type ConversationMessage,
  type ConversationTurn,
  type TurnItem,
} from '@makinbakin/sdk/conversation'

const Q: BakinQuestion = {
  v: 1,
  id: 'q_0123456789abcdef',
  question: 'Which inbox are we cleaning?',
  options: [{ label: 'Personal Gmail', description: 'Fastest win.' }, { label: 'Personal and work' }],
  recommended: 0,
  allowOther: true,
}

const ts = (n: number) => `2026-10-25T10:00:0${n}.000Z`
const questionRow = (question: BakinQuestion = Q, turnId = 'turn-1'): ConversationMessage => ({
  kind: 'tool', ts: ts(2), turnId, callId: `call-${question.id}`, toolName: 'bakin_exec_ask_user', status: 'completed',
  summary: `bakin-question:${question.id} posted.`, metadata: { bakinQuestion: question },
})

function questionItems(turns: ConversationTurn[]): Extract<TurnItem, { type: 'question' }>[] {
  return turns.flatMap(turn => turn.kind === 'agent' ? turn.items : [])
    .filter((item): item is Extract<TurnItem, { type: 'question' }> => item.type === 'question')
}

describe('formatQuestionAnswer', () => {
  it('formats an option, free text, not-sure and an optional note', () => {
    expect(formatQuestionAnswer(Q, { kind: 'option', index: 0 })).toBe('**Which inbox are we cleaning?** → Personal Gmail')
    expect(formatQuestionAnswer(Q, { kind: 'other', text: ' A shared inbox ' })).toBe('**Which inbox are we cleaning?** → A shared inbox')
    expect(formatQuestionAnswer(Q, { kind: 'unsure' })).toBe('**Which inbox are we cleaning?** → Not sure — help me choose')
    expect(formatQuestionAnswer(Q, { kind: 'option', index: 1 }, '  only the last year  '))
      .toBe('**Which inbox are we cleaning?** → Personal and work\n\nonly the last year')
  })
})

describe('foldConversation question items', () => {
  it('a question tool row becomes a question item, not an activity call', () => {
    const turns = foldConversation([
      { kind: 'user', ts: ts(0), content: 'help me clean my inbox' },
      { kind: 'assistant', ts: ts(1), turnId: 'turn-1', content: 'Scope first.' },
      questionRow(),
    ])
    const agent = turns[1]
    expect(agent?.kind).toBe('agent')
    if (agent?.kind !== 'agent') return
    expect(agent.items.map(item => item.type)).toEqual(['text', 'question'])
    expect(questionItems(turns)[0]).toMatchObject({ question: Q, state: 'open', answerable: true })
  })

  it('the next user row answering with the prefix marks it answered with the answer text', () => {
    const turns = foldConversation([
      questionRow(),
      { kind: 'user', ts: ts(3), content: formatQuestionAnswer(Q, { kind: 'option', index: 0 }, 'just this year') },
    ])
    expect(questionItems(turns)[0]).toMatchObject({ state: 'answered', answer: 'Personal Gmail', answerable: false })
  })

  it('any other next user row marks it skipped', () => {
    const turns = foldConversation([
      questionRow(),
      { kind: 'user', ts: ts(3), content: 'actually, let us talk about budget first' },
    ])
    expect(questionItems(turns)[0]).toMatchObject({ state: 'skipped', answerable: false })
  })

  it('only the LAST open card is answerable', () => {
    const second = { ...Q, id: 'q_fedcba9876543210', question: 'What counts as done?' }
    const turns = foldConversation([questionRow(Q, 'turn-1'), questionRow(second, 'turn-1')])
    expect(questionItems(turns).map(item => [item.state, item.answerable])).toEqual([['open', false], ['open', true]])
  })

  it('malformed metadata stays an ordinary activity row', () => {
    const turns = foldConversation([{ ...questionRow(), metadata: { bakinQuestion: { v: 1, question: 'no id or options' } } } as ConversationMessage])
    expect(questionItems(turns)).toHaveLength(0)
    const agent = turns[0]
    expect(agent?.kind === 'agent' && agent.items[0]?.type).toBe('activity')
  })

  it('live chunks: the running call is replaced by the question when its result lands', () => {
    const call: RuntimeChatChunk = { type: 'tool', data: { phase: 'call', callId: 'c1', toolName: 'bakin_exec_ask_user', status: 'running' } }
    const result: RuntimeChatChunk = { type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bakin_exec_ask_user', status: 'completed', metadata: { bakinQuestion: Q } } }
    const running = foldConversation([], { liveChunks: [call] })
    expect(running[0]?.kind === 'agent' && running[0].items[0]?.type).toBe('activity')
    const settled = foldConversation([], { liveChunks: [{ type: 'text', content: 'Scope first.' }, call, result] })
    const live = settled[0]
    expect(live?.kind === 'agent' && live.items.map(item => item.type)).toEqual(['text', 'question'])
  })
})

describe('foldTurnChunks (read-only embeds)', () => {
  it('renders a question as an "Asked:" chip', async () => {
    const { foldTurnChunks } = await import('@makinbakin/sdk/conversation')
    const output = foldTurnChunks([
      { type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bakin_exec_ask_user', status: 'completed', metadata: { bakinQuestion: Q } } },
    ])
    expect(output.tools).toEqual([{ key: Q.id, toolName: 'bakin_exec_ask_user', summary: `Asked: ${Q.question}`, status: 'completed' }])
  })
})
