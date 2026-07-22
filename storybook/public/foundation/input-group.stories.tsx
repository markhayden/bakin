import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Label,
} from '@makinbakin/sdk/ui'
import { expect, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/InputGroup',
  component: InputGroup,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'InputGroup composes one editable control with contextual text or a local action. A trailing submit action is valid when it operates directly on the entered value, such as adding a note. The editable control still needs its own accessible label. Do not use adornments as a replacement for field descriptions or as a container for unrelated page actions.' } },
  },
} satisfies Meta<typeof InputGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Adornments = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Composed entry</p><h1>InputGroup</h1><p>Inline and block adornments share one focus boundary while preserving native control semantics.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="group-inline-heading">
        <header><h2 id="group-inline-heading">Inline context and action</h2></header>
        <div className="bakin-primitive-story__field">
          <Label htmlFor="group-path">Repository path</Label>
          <InputGroup aria-label="Repository address">
            <InputGroupAddon><InputGroupText>github.com/</InputGroupText></InputGroupAddon>
            <InputGroupInput id="group-path" defaultValue="makinbakin/reference-plugin" />
            <InputGroupAddon align="inline-end"><InputGroupButton>Copy</InputGroupButton></InputGroupAddon>
          </InputGroup>
        </div>
      </section>
      <section className="bakin-primitive-story__section" aria-labelledby="group-block-heading">
        <header><h2 id="group-block-heading">Multiline context</h2><p>The invalid control drives the group border; the associated message explains recovery.</p></header>
        <div className="bakin-primitive-story__field">
          <Label htmlFor="group-prompt">Execution prompt</Label>
          <InputGroup aria-label="Execution prompt editor">
            <InputGroupAddon align="block-start"><InputGroupText>Prompt template</InputGroupText></InputGroupAddon>
            <InputGroupTextarea id="group-prompt" rows={5} aria-invalid="true" aria-describedby="group-prompt-error" defaultValue="Summarize {{missing_input}} for the launch owner." />
            <InputGroupAddon align="block-end"><InputGroupText>Markdown supported</InputGroupText><InputGroupButton>Insert variable</InputGroupButton></InputGroupAddon>
          </InputGroup>
          <p className="bakin-primitive-story__error" id="group-prompt-error">Replace the unknown variable before saving.</p>
        </div>
      </section>
    </main>
  ),
} satisfies Story

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.75]">
      <path d="m2.5 2.5 11 5.5-11 5.5 2-5.5-2-5.5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8h5" strokeLinecap="round" />
    </svg>
  )
}

export const LocalSubmitAction = {
  render: function LocalSubmitActionStory() {
    const [note, setNote] = useState('')
    const [submittedNote, setSubmittedNote] = useState('')
    return (
      <main className="bakin-primitive-story">
        <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Local action</p><h1>Submit from the field</h1><p>Keep one action that operates on the entered value inside the shared input boundary.</p></header>
        <section className="bakin-primitive-story__section" aria-labelledby="group-submit-heading">
          <header><h2 id="group-submit-heading">Add a note</h2><p>The compact trailing action matches the field height, supports Enter through native form submission, and remains disabled without a value.</p></header>
          <div className="bakin-primitive-story__field">
            <Label htmlFor="group-note">Task note</Label>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!note.trim()) return
                setSubmittedNote(note.trim())
              }}
            >
              <InputGroup aria-label="Add task note">
                <InputGroupInput id="group-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note..." />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton type="submit" size="icon-xs" aria-label="Add note" disabled={!note.trim()}><SendIcon /></InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </form>
            <p role="status" className="bakin-primitive-story__muted">{submittedNote ? `Submitted: ${submittedNote}` : 'No note submitted.'}</p>
          </div>
        </section>
      </main>
    )
  },
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByRole('textbox', { name: 'Task note' })
    const submit = canvas.getByRole('button', { name: 'Add note' })
    await expect(submit).toBeDisabled()
    await userEvent.type(input, 'Confirm the launch owner')
    await expect(submit).toBeEnabled()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Submitted: Confirm the launch owner')
  },
} satisfies Story
