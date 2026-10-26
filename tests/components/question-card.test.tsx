// @vitest-environment jsdom
/**
 * QuestionCard (projects revamp D3/D4/D5) rendered through the public
 * Conversation surface: recommended is labelled but never preselected,
 * answers leave through `onAnswerQuestion` as the formatted user message,
 * and only the newest open card — on a settled turn — accepts input.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-question-card-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import '../rtl-settle'

import type { BakinQuestion } from '@makinbakin/sdk/types'
import { Conversation, foldConversation, type ConversationMessage } from '@makinbakin/sdk/conversation'

const Q: BakinQuestion = {
  v: 1,
  id: 'q_0123456789abcdef',
  question: 'Which inbox are we cleaning?',
  options: [
    { label: 'Personal Gmail', description: 'Fastest win.' },
    { label: 'Personal and work', description: 'Two sets of rules.' },
  ],
  recommended: 0,
  allowOther: true,
}

const questionRow: ConversationMessage = {
  kind: 'tool', ts: '2026-10-25T10:00:02.000Z', turnId: 't1', callId: 'c1', toolName: 'bakin_exec_ask_user',
  status: 'completed', metadata: { bakinQuestion: Q },
}

function renderConversation(rows: ConversationMessage[], opts: { streaming?: boolean } = {}) {
  const onAnswerQuestion = mock((_text: string) => {})
  // Streaming: the question arrives inside the still-live turn's chunks.
  const turns = opts.streaming
    ? foldConversation([], { liveChunks: [{ type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bakin_exec_ask_user', status: 'completed', metadata: { bakinQuestion: Q } } }] })
    : foldConversation(rows)
  const view = render(<Conversation turns={turns} onAnswerQuestion={onAnswerQuestion} />)
  return { ...view, onAnswerQuestion }
}

function card() {
  return document.querySelector('[data-conv-question]') as HTMLElement
}

describe('QuestionCard', () => {
  it('lists the options with Recommended labelled but nothing preselected', () => {
    renderConversation([questionRow])
    const group = within(card()).getByRole('radiogroup', { name: Q.question })
    const radios = within(group).getAllByRole('radio')
    // Two options + Something else + Not sure.
    expect(radios).toHaveLength(4)
    for (const radio of radios) expect(radio.getAttribute('aria-checked')).toBe('false')
    expect(within(card()).getByText('Recommended')).toBeTruthy()
    expect((within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })

  it('answers with the chosen option and an optional note', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: /Personal and work/ })) })
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: 'Add a note (optional)' }), { target: { value: 'last year only' } })
    })
    await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Answer' })) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Personal and work\n\nlast year only')
    cleanup()
  })

  it('"Something else" requires its free text', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: 'Something else…' })) })
    const answer = within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement
    expect(answer.disabled).toBe(true)
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: 'Your answer' }), { target: { value: 'A shared team inbox' } })
    })
    expect(answer.disabled).toBe(false)
    await act(async () => { fireEvent.click(answer) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → A shared team inbox')
    cleanup()
  })

  it('"Not sure" asks the agent to help choose', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: 'Not sure — help me choose' })) })
    await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Answer' })) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Not sure — help me choose')
    cleanup()
  })

  it('omits "Something else" when the agent disallows it', () => {
    renderConversation([{ ...questionRow, metadata: { bakinQuestion: { ...Q, allowOther: false } } }])
    expect(within(card()).queryByRole('radio', { name: 'Something else…' })).toBeNull()
    cleanup()
  })

  it('is read-only while its turn is still streaming', () => {
    renderConversation([questionRow], { streaming: true })
    const radios = within(card()).getAllByRole('radio')
    for (const radio of radios) expect(radio.getAttribute('aria-disabled') === 'true' || radio.hasAttribute('data-disabled')).toBe(true)
    expect((within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })

  it('collapses to "question → answer" once answered', () => {
    renderConversation([questionRow, { kind: 'user', ts: '2026-10-25T10:00:03.000Z', content: '**Which inbox are we cleaning?** → Personal Gmail' }])
    expect(within(card()).queryByRole('radiogroup')).toBeNull()
    expect(card().textContent).toContain('Personal Gmail')
    expect(card().getAttribute('data-state')).toBe('answered')
    cleanup()
  })

  it('collapses to "skipped" when the user replied with something else', () => {
    renderConversation([questionRow, { kind: 'user', ts: '2026-10-25T10:00:03.000Z', content: 'let us talk budget first' }])
    expect(card().getAttribute('data-state')).toBe('skipped')
    expect(card().textContent).toContain('Skipped')
    cleanup()
  })

  it('without an answer handler the card is read-only', () => {
    const turns = foldConversation([questionRow])
    render(<Conversation turns={turns} />)
    expect(within(card()).queryByRole('button', { name: 'Answer' })).toBeNull()
    cleanup()
  })
})
