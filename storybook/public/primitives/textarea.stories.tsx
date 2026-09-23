import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { useState } from 'react'

import { Grid } from '@makinbakin/sdk/layout'
import { Button, Field, FieldControl, FieldError, FieldLabel, Textarea } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/Textarea',
  component: Textarea,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Textarea is the low-level multiline control. It grows with content where supported, retains vertical resize, and preserves native validation and read-only semantics.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'disabled', 'error'],
  },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    rows: 3,
    size: 'md',
    variant: 'outlined',
    disabled: false,
    readOnly: false,
  },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    variant: { control: 'select', options: ['outlined', 'filled', 'ghost'] },
    rows: { control: { type: 'number', min: 1 } },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
  },
  render: (args) => (
    <Field name="handoff">
      <FieldLabel>Operator handoff</FieldLabel>
      <FieldControl render={<Textarea placeholder="What should the next operator know?" {...args} />} />
    </Field>
  ),
  play: async ({ canvas, userEvent, args }) => {
    const textarea = canvas.getByRole('textbox', { name: 'Operator handoff' })
    if (args.disabled) {
      await expect(textarea).toBeDisabled()
      return
    }
    if (args.readOnly) {
      await expect(textarea).toHaveAttribute('readonly')
      return
    }
    await userEvent.type(textarea, 'Confirm the launch checklist.')
    await expect(textarea).toHaveValue('Confirm the launch checklist.')
  },
} satisfies Story

export const BoundedGrowth = {
  render: () => (
    <StoryStage eyebrow="Multiline sizing" title="Bounded growth" description="Manual rows are the default. Auto mode grows to its maximum, then scrolls internally.">
      <Field>
        <FieldLabel>Growing note</FieldLabel>
        <FieldControl render={<Textarea autoSize minRows={3} maxRows={6} />} />
      </Field>
      <Grid layout="split" gap="section">
        {(['outlined', 'filled', 'ghost'] as const).flatMap((variant) =>
          (['sm', 'md', 'lg'] as const).map((size) => (
            <Field key={`${variant}-${size}`}>
              <FieldLabel>{variant} {size}</FieldLabel>
              <FieldControl render={<Textarea rows={3} size={size} variant={variant} defaultValue="Editable notes" />} />
            </Field>
          )),
        )}
      </Grid>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const textarea = canvas.getByRole('textbox', { name: 'Growing note' })
    const initial = textarea.getBoundingClientRect().height
    await userEvent.type(textarea, Array(12).fill('A line of notes').join('\n'))
    await expect(textarea.getBoundingClientRect().height).toBeGreaterThan(initial)
    await expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight)
    await userEvent.clear(textarea)
    await expect(textarea.getBoundingClientRect().height).toBe(initial)
    textarea.blur()
  },
} satisfies Story

export const SizingFixture = {
  render: function SizingFixture() {
    const [value, setValue] = useState('')
    return (
      <form onReset={() => setValue('')}>
        <Field><FieldLabel>Automatic notes</FieldLabel><FieldControl render={<Textarea autoSize minRows={3} maxRows={6} value={value} onChange={(event) => setValue(event.target.value)} />} /></Field>
        <Button type="button" onClick={() => setValue(Array(15).fill('A long line of notes for resizing').join('\n'))}>Load notes</Button>
        <Button type="reset">Reset notes</Button>
        <Field><FieldLabel>Manual notes</FieldLabel><FieldControl render={<Textarea rows={3} />} /></Field>
      </form>
    )
  },
} satisfies Story

export const ContentAndStates = {
  render: () => (
    <StoryStage
      eyebrow="Multiline entry"
      title="Textarea"
      description="Long operational content remains readable and vertically resizable without horizontal page overflow."
    >
      <StorySection title="States">
        <Grid layout="split" gap="section">
          <Field name="operatorHandoff">
            <FieldLabel>Operator handoff</FieldLabel>
            <FieldControl render={<Textarea rows={5} defaultValue="Confirm the launch checklist, notify the assigned agents, and record any exception before the publishing window opens." />} />
          </Field>
          <Field name="generatedSummary">
            <FieldLabel>Generated summary</FieldLabel>
            <FieldControl render={<Textarea rows={5} readOnly value="This summary is generated from the current workflow definition and cannot be edited here." />} />
          </Field>
          <Field invalid name="rationale">
            <FieldLabel>Required rationale</FieldLabel>
            <FieldControl render={<Textarea rows={4} required />} />
            <FieldError match>Explain why this production exception is needed.</FieldError>
          </Field>
          <Field disabled name="archivedNote">
            <FieldLabel>Archived note</FieldLabel>
            <FieldControl render={<Textarea rows={4} disabled defaultValue="Archived workflows cannot accept new notes." />} />
          </Field>
        </Grid>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Generated summary' })).toHaveAttribute('readonly')
    await expect(canvas.getByLabelText('Archived note')).toBeDisabled()
    const invalid = canvas.getByRole('textbox', { name: 'Required rationale' })
    await expect(invalid).toHaveAttribute('aria-invalid', 'true')
    await expect(invalid).toHaveAccessibleDescription('Explain why this production exception is needed.')
  },
} satisfies Story
