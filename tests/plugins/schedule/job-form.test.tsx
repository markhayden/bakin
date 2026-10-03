// @vitest-environment jsdom
/**
 * JobForm refuses a non-prompt before submit (spec D5): the submit button
 * stays disabled and the prompt field explains itself for an empty prompt or
 * a single marker token; a real sentence enables it in every mode, including
 * adopt. Storybook: forms/form-composition — Overview (Field invalid + FieldError).
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/hooks', () => ({
  useMainAgentId: () => 'main',
  useAgentList: () => [],
  useAgentStore: (selector: (state: { displaySettings: Record<string, never>; teams: never[] }) => unknown) => selector({ displaySettings: {}, teams: [] }),
}))
mock.module('@bakin/schedule/components/schedule-input', () => ({
  ScheduleInput: ({ value, onChange, onParsed }: { value: string; onChange: (v: string) => void; onParsed?: (r: unknown) => void }) => (
    <input
      aria-label="Schedule"
      value={value}
      onChange={(event) => { onChange(event.target.value); onParsed?.(event.target.value ? { kind: 'cron', expr: event.target.value, human: 'daily' } : null) }}
    />
  ),
}))

import { JobForm } from '../../../plugins/schedule/components/job-form'

afterEach(() => document.body.replaceChildren())

function submitButton() {
  return screen.getByRole('button', { name: /Adopt into Bakin|Create job|Save changes/ })
}

function isDisabled(button: HTMLElement): boolean {
  return button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true'
}

describe('JobForm task prompt gate', () => {
  it('adopt mode: a bare marker command cannot be submitted; the field says why; a real prompt unlocks it', async () => {
    const onSubmit = mock(async () => {})
    render(<JobForm mode="adopt" submitting={false} onCancel={() => {}} onSubmit={onSubmit}
      initial={{ name: 'dream', schedule: '0 3 * * *', taskPrompt: '__openclaw_memory_core_short_term_promotion_dream__' }} />)

    expect(isDisabled(submitButton())).toBe(true)
    expect(screen.getByText(/needs more than one word/)).toBeTruthy()

    const prompt = screen.getByRole('textbox', { name: /task prompt/i })
    await act(async () => { fireEvent.change(prompt, { target: { value: 'Promote short-term memories to long-term notes' } }) })
    expect(screen.queryByText(/needs more than one word/)).toBeNull()
    expect(isDisabled(submitButton())).toBe(false)

    await act(async () => { fireEvent.submit(prompt.closest('form')!) })
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ taskPrompt: 'Promote short-term memories to long-term notes' }))
  })

  it('create mode: an empty prompt keeps submit disabled without shouting; typing one token shows the message', async () => {
    render(<JobForm mode="create" submitting={false} onCancel={() => {}} onSubmit={async () => {}} />)
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /^name/i }), { target: { value: 'Daily' } })
      fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '0 9 * * *' } })
    })
    expect(isDisabled(submitButton())).toBe(true)
    expect(screen.queryByText(/needs more than one word/)).toBeNull()

    await act(async () => { fireEvent.change(screen.getByRole('textbox', { name: /task prompt/i }), { target: { value: 'heartbeat' } }) })
    expect(screen.getByText(/needs more than one word/)).toBeTruthy()
    expect(isDisabled(submitButton())).toBe(true)

    await act(async () => { fireEvent.change(screen.getByRole('textbox', { name: /task prompt/i }), { target: { value: 'Summarize yesterday for the team' } }) })
    expect(isDisabled(submitButton())).toBe(false)
  })
})
