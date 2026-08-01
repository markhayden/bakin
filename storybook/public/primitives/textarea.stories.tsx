import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { Grid } from '@makinbakin/sdk/layout'
import { Field, FieldControl, FieldError, FieldLabel, Textarea } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Textarea',
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
    rows: 4,
    disabled: false,
    readOnly: false,
  },
  argTypes: {
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
