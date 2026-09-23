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

import { TextEntryRecipes } from '../../support/form-input-recipes'

import { SendIcon, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/InputGroup',
  component: InputGroup,
  args: { size: 'md', variant: 'outlined' },
  argTypes: { size: { control: 'select', options: ['sm', 'md', 'lg'] }, variant: { control: 'select', options: ['outlined', 'filled', 'ghost'] } },
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
  args: {
    // One editable control plus contextual adornments — composition, not a control.
    children: (
      <>
        <InputGroupAddon><InputGroupText>github.com/</InputGroupText></InputGroupAddon>
        <InputGroupInput id="repository-path" defaultValue="makinbakin/reference-plugin" />
      </>
    ),
  },
  argTypes: {
    children: { control: false },
  },
  render: (args) => (
    <div>
      <Label htmlFor="repository-path">Repository path</Label>
      <InputGroup aria-label="Repository address" {...args} />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Repository path' })
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('makinbakin/reference-plugin')
    const group = canvas.getByRole('group', { name: 'Repository address' })
    await userEvent.tab()
    await expect(input).toHaveFocus()
    await expect(getComputedStyle(group).outlineStyle).toBe('solid')
    await expect(parseFloat(getComputedStyle(group).outlineWidth)).toBeGreaterThan(0)
    input.blur()
    await expect(getComputedStyle(group).outlineStyle).toBe('none')
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
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('textbox', { name: 'Repository path' })).toHaveValue('makinbakin/reference-plugin')
    const prompt = canvas.getByRole('textbox', { name: 'Execution prompt' })
    await expect(prompt).toHaveAttribute('aria-invalid', 'true')
    await expect(prompt).toHaveAccessibleDescription('Replace the unknown variable before saving.')
    const path = canvas.getByRole('textbox', { name: 'Repository path' })
    path.focus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Copy' })).toHaveFocus()
    await expect(getComputedStyle(canvas.getByRole('group', { name: 'Repository address' })).outlineStyle).toBe('none')
    await userEvent.tab()
    await expect(prompt).toHaveFocus()
    await expect(getComputedStyle(canvas.getByRole('group', { name: 'Execution prompt editor' })).outlineStyle).toBe('solid')
    prompt.blur()
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

export const SizesAndVariants = {
  render: () => <StoryStage eyebrow="Shared shell" title="Grouped controls" description="Size and appearance belong to the group. Addons remain inside its border and focus boundary.">
    {(['sm', 'md', 'lg'] as const).map(size => <StorySection key={size} title={size}>
      <Stack gap="dense">{(['outlined', 'filled', 'ghost'] as const).map(variant => <InputGroup key={variant} size={size} variant={variant} aria-label={`${variant} ${size}`}>
        <InputGroupAddon><InputGroupText>https://</InputGroupText></InputGroupAddon>
        <InputGroupInput aria-label={`${variant} ${size} address`} placeholder="example.com" />
        <InputGroupAddon align="inline-end"><InputGroupButton size="icon-xs" aria-label={`Open ${variant} ${size}`}><SendIcon /></InputGroupButton></InputGroupAddon>
      </InputGroup>)}</Stack>
    </StorySection>)}
  </StoryStage>,
  play: async ({ canvas }) => {
    for (const [size, height] of [['sm', 32], ['md', 36], ['lg', 44]] as const) {
      for (const variant of ['outlined', 'filled', 'ghost']) {
        const group = canvas.getByRole('group', { name: `${variant} ${size}` })
        await expect(group.getBoundingClientRect().height).toBe(height)
      }
    }
  },
} satisfies Story

export const TextEntry = {
  render: () => <StoryStage eyebrow="Text entry" title="Field actions" description="Clear, reveal, units, loading, copy, counts and guarded submission compose the public controls."><TextEntryRecipes /></StoryStage>,
  play: async ({ canvas, userEvent }) => {
    const query = canvas.getByRole('textbox', { name: 'Search notes' })
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search notes' }))
    await expect(query).toHaveValue('')
    await expect(query).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Show password' }))
    await expect(canvas.getByRole('textbox', { name: 'Password' })).toHaveValue('a-demo-password')
    await userEvent.click(canvas.getByRole('button', { name: 'Hide password' }))
    await expect(canvas.getByLabelText('Password')).toHaveAttribute('type', 'password')
    const note = canvas.getByRole('textbox', { name: 'Counted note' })
    await userEvent.type(note, 'Ready')
    await expect(canvas.getByText('5/120')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Add counted note' }))
    await expect(canvas.getByRole('button', { name: 'Adding note' })).toBeDisabled()
    await expect(canvas.findByText('Added: Ready')).resolves.toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Disabled reference' })).toBeDisabled()
  },
} satisfies Story
