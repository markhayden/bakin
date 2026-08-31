import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import {
  Field,
  FieldError,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Label,
} from '@makinbakin/sdk/ui'

import { SendIcon, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/InputGroup',
  component: InputGroup,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'InputGroup composes one editable control with contextual text or a local action. A trailing submit action is valid when it operates directly on the entered value, such as adding a note. The editable control still needs its own accessible label. Do not use adornments as a replacement for field descriptions or as a container for unrelated page actions.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'disabled', 'error'],
  },
} satisfies Meta<typeof InputGroup>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div>
      <Label htmlFor="repository-path">Repository path</Label>
      <InputGroup aria-label="Repository address">
        <InputGroupAddon><InputGroupText>github.com/</InputGroupText></InputGroupAddon>
        <InputGroupInput id="repository-path" defaultValue="makinbakin/reference-plugin" />
      </InputGroup>
    </div>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Repository path' })
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('makinbakin/reference-plugin')
  },
} satisfies Story

export const Adornments = {
  render: () => (
    <StoryStage
      eyebrow="Composed entry"
      title="InputGroup"
      description="Inline and block adornments share one focus boundary while preserving native control semantics."
    >
      <StorySection title="Inline context and action">
        <Stack gap="dense">
          <Label htmlFor="group-path">Repository path</Label>
          <InputGroup aria-label="Repository address">
            <InputGroupAddon><InputGroupText>github.com/</InputGroupText></InputGroupAddon>
            <InputGroupInput id="group-path" defaultValue="makinbakin/reference-plugin" />
            <InputGroupAddon align="inline-end"><InputGroupButton>Copy</InputGroupButton></InputGroupAddon>
          </InputGroup>
        </Stack>
      </StorySection>
      <StorySection
        title="Multiline context"
        description="The invalid control drives the group border; the associated message explains recovery."
      >
        <Field invalid name="executionPrompt">
          <Label htmlFor="group-prompt">Execution prompt</Label>
          <InputGroup aria-label="Execution prompt editor">
            <InputGroupAddon align="block-start"><InputGroupText>Prompt template</InputGroupText></InputGroupAddon>
            <InputGroupTextarea id="group-prompt" rows={5} aria-invalid="true" aria-describedby="group-prompt-error" defaultValue="Summarize {{missing_input}} for the launch owner." />
            <InputGroupAddon align="block-end"><InputGroupText>Markdown supported</InputGroupText><InputGroupButton>Insert variable</InputGroupButton></InputGroupAddon>
          </InputGroup>
          <FieldError match id="group-prompt-error">Replace the unknown variable before saving.</FieldError>
        </Field>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Repository path' })).toHaveValue('makinbakin/reference-plugin')
    const prompt = canvas.getByRole('textbox', { name: 'Execution prompt' })
    await expect(prompt).toHaveAttribute('aria-invalid', 'true')
    await expect(prompt).toHaveAccessibleDescription('Replace the unknown variable before saving.')
  },
} satisfies Story

export const LocalSubmitAction = {
  render: function LocalSubmitActionStory() {
    const [note, setNote] = useState('')
    const [submittedNote, setSubmittedNote] = useState('')
    return (
      <StoryStage
        eyebrow="Local action"
        title="Submit from the field"
        description="Keep one action that operates on the entered value inside the shared input boundary."
      >
        <StorySection
          title="Add a note"
          description="The compact trailing action matches the field height, supports Enter through native form submission, and remains disabled without a value."
        >
          <Stack gap="dense">
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
            <p role="status" className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">{submittedNote ? `Submitted: ${submittedNote}` : 'No note submitted.'}</p>
          </Stack>
        </StorySection>
      </StoryStage>
    )
  },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Task note' })
    const submit = canvas.getByRole('button', { name: 'Add note' })
    await expect(submit).toBeDisabled()
    await userEvent.type(input, 'Confirm the launch owner')
    await expect(submit).toBeEnabled()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Submitted: Confirm the launch owner')
  },
} satisfies Story
