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

import { Conversation, foldConversation, type BakinQuestion, type ConversationMessage } from '@makinbakin/sdk/conversation'

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

function renderConversation(rows: ConversationMessage[], opts: { streaming?: boolean; busy?: boolean } = {}) {
  const onAnswerQuestion = mock((_text: string) => {})
  // Streaming: the question arrives inside the still-live turn's chunks.
  const turns = opts.streaming
    ? foldConversation([], { liveChunks: [{ type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bakin_exec_ask_user', status: 'completed', metadata: { bakinQuestion: Q } } }] })
    : foldConversation(rows)
  const view = render(<Conversation turns={turns} onAnswerQuestion={onAnswerQuestion} busy={opts.busy} />)
  return { ...view, onAnswerQuestion }
}

const FIELD = 'Write your own answer, or add a note to your choice'
const NOTE_ONLY = 'Add a note to your choice (optional)'

function card() {
  return document.querySelector('[data-conv-question]') as HTMLElement
}

describe('QuestionCard', () => {
  it('lists the options with Recommended labelled but nothing preselected', () => {
    renderConversation([questionRow])
    const group = within(card()).getByRole('radiogroup', { name: Q.question })
    const radios = within(group).getAllByRole('radio')
    // Two options + Not sure.
    expect(radios).toHaveLength(3)
    for (const radio of radios) expect(radio.getAttribute('aria-checked')).toBe('false')
    expect(within(card()).getByText('Recommended')).toBeTruthy()
    expect((within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })

  it('offers one text field and no "Something else" radio', () => {
    renderConversation([questionRow])
    expect(within(card()).getAllByRole('textbox')).toHaveLength(1)
    expect(within(card()).queryByRole('radio', { name: /Something else/ })).toBeNull()
    expect(within(card()).getByRole('radio', { name: 'Not sure — help me choose' })).toBeTruthy()
    cleanup()
  })

  it('answers with the chosen option and the text as a note', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: /Personal and work/ })) })
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: FIELD }), { target: { value: 'last year only' } })
    })
    await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Answer' })) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Personal and work\n\nlast year only')
    cleanup()
  })

  it('text with nothing picked is the user\'s own answer', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    const answer = within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement
    expect(answer.disabled).toBe(true)
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: FIELD }), { target: { value: 'A shared team inbox' } })
    })
    expect(answer.disabled).toBe(false)
    await act(async () => { fireEvent.click(answer) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → A shared team inbox')
    cleanup()
  })

  it('whitespace-only text sends nothing', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: FIELD }), { target: { value: '   ' } })
    })
    expect((within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { fireEvent.submit(card().closest('form') ?? card()) })
    expect(onAnswerQuestion).not.toHaveBeenCalled()
    cleanup()
  })

  it('Enter in the text field submits the answer exactly once', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    const field = within(card()).getByRole('textbox', { name: FIELD })
    await act(async () => { fireEvent.change(field, { target: { value: 'A shared team inbox' } }) })
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(onAnswerQuestion).toHaveBeenCalledTimes(1)
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → A shared team inbox')
    cleanup()
  })

  it('Enter in the text field submits once with an option picked and Clear choice showing', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: /Personal Gmail/ })) })
    const field = within(card()).getByRole('textbox', { name: FIELD })
    await act(async () => { fireEvent.change(field, { target: { value: 'last year only' } }) })
    expect(within(card()).getByRole('button', { name: 'Clear choice' })).toBeTruthy()
    await act(async () => { fireEvent.keyDown(field, { key: 'Enter' }) })
    expect(onAnswerQuestion).toHaveBeenCalledTimes(1)
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Personal Gmail\n\nlast year only')
    cleanup()
  })

  it('Enter in an empty text field with nothing picked sends nothing', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.keyDown(within(card()).getByRole('textbox', { name: FIELD }), { key: 'Enter' }) })
    expect(onAnswerQuestion).not.toHaveBeenCalled()
    cleanup()
  })

  it('"Clear choice" unpicks the option, so the text becomes the answer', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    expect(within(card()).queryByRole('button', { name: 'Clear choice' })).toBeNull()
    const radio = within(card()).getByRole('radio', { name: /Personal Gmail/ })
    await act(async () => { fireEvent.click(radio) })
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: FIELD }), { target: { value: 'A shared team inbox' } })
    })
    await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Clear choice' })) })
    expect(radio.getAttribute('aria-checked')).toBe('false')
    expect(within(card()).queryByRole('button', { name: 'Clear choice' })).toBeNull()
    // The button unmounts on clear; focus moves to the field so a keyboard user keeps typing.
    expect(document.activeElement).toBe(within(card()).getByRole('textbox', { name: FIELD }))
    await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Answer' })) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → A shared team inbox')
    cleanup()
  })

  it('"Not sure" asks the agent to help choose, with the text as a note', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: 'Not sure — help me choose' })) })
    await act(async () => {
      fireEvent.change(within(card()).getByRole('textbox', { name: FIELD }), { target: { value: 'both feel too big' } })
    })
    await act(async () => { fireEvent.click(within(card()).getByRole('button', { name: 'Answer' })) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Not sure — help me choose\n\nboth feel too big')
    cleanup()
  })

  it('when the agent disallows free text, the field is a note only and never an answer by itself', async () => {
    const { onAnswerQuestion } = renderConversation([{ ...questionRow, metadata: { bakinQuestion: { ...Q, allowOther: false } } }])
    expect(within(card()).queryByRole('textbox', { name: FIELD })).toBeNull()
    const note = within(card()).getByRole('textbox', { name: NOTE_ONLY })
    await act(async () => { fireEvent.change(note, { target: { value: 'A shared team inbox' } }) })
    const answer = within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement
    expect(answer.disabled).toBe(true)
    await act(async () => { fireEvent.click(within(card()).getByRole('radio', { name: /Personal Gmail/ })) })
    expect(answer.disabled).toBe(false)
    await act(async () => { fireEvent.click(answer) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Personal Gmail\n\nA shared team inbox')
    cleanup()
  })

  it('is read-only while its turn is still streaming', () => {
    renderConversation([questionRow], { streaming: true })
    const radios = within(card()).getAllByRole('radio')
    for (const radio of radios) expect(radio.getAttribute('aria-disabled') === 'true' || radio.hasAttribute('data-disabled')).toBe(true)
    expect((within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })

  it('Enter on a selected radio submits the answer', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    const radio = within(card()).getByRole('radio', { name: /Personal Gmail/ })
    await act(async () => { fireEvent.click(radio) })
    await act(async () => { fireEvent.keyDown(radio, { key: 'Enter' }) })
    expect(onAnswerQuestion).toHaveBeenCalledWith('**Which inbox are we cleaning?** → Personal Gmail')
    cleanup()
  })

  it('Enter with nothing selected sends nothing', async () => {
    const { onAnswerQuestion } = renderConversation([questionRow])
    await act(async () => { fireEvent.keyDown(within(card()).getAllByRole('radio')[0]!, { key: 'Enter' }) })
    expect(onAnswerQuestion).not.toHaveBeenCalled()
    cleanup()
  })

  it('holds input while the thread is busy even when the persisted turn folded as settled', () => {
    // Remount mid-turn: the question row is persisted (folds complete) while
    // the surface still reports the turn in flight.
    renderConversation([questionRow], { busy: true })
    for (const radio of within(card()).getAllByRole('radio')) {
      expect(radio.getAttribute('aria-disabled') === 'true' || radio.hasAttribute('data-disabled')).toBe(true)
    }
    expect((within(card()).getByRole('button', { name: 'Answer' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
  })

  it('a malformed option description never reaches the card', () => {
    const malformed = { ...Q, options: [{ label: 'A', description: { unexpected: 'object' } }, { label: 'B' }] }
    renderConversation([{ ...questionRow, metadata: { bakinQuestion: malformed } } as ConversationMessage])
    expect(card()).toBeNull()
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
