import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox, Field, FieldError, FieldLabel } from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { expect } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Checkbox for an independent yes/no choice or each item in a multi-selection. Mixed means a parent represents partially selected children; it is not a third persisted value.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'validation'],
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    defaultChecked: false,
    disabled: false,
  },
  argTypes: {
    defaultChecked: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
  render: (args) => (
    <Field orientation="horizontal">
      <Checkbox {...args} />
      <FieldLabel>Include archived tasks</FieldLabel>
    </Field>
  ),
  play: async ({ canvas, userEvent, args }) => {
    const checkbox = canvas.getByRole('checkbox', { name: 'Include archived tasks' })
    const startsChecked = Boolean(args.defaultChecked)
    if (startsChecked) await expect(checkbox).toBeChecked()
    else await expect(checkbox).not.toBeChecked()
    if (args.disabled) {
      await expect(checkbox).toBeDisabled()
      return
    }
    await userEvent.click(checkbox)
    if (startsChecked) await expect(checkbox).not.toBeChecked()
    else await expect(checkbox).toBeChecked()
  },
} satisfies Story

export const States = {
  render: () => (
    <StoryStage
      eyebrow="Independent choice"
      title="Checkbox"
      description="Visible labels, real form state, and a minimum 24px interactive target."
    >
      <StorySection title="Canonical states">
        <Stack gap="item" style={{ maxWidth: '40rem' }}>
          <Field orientation="horizontal">
            <Checkbox />
            <FieldLabel>Unchecked</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox defaultChecked />
            <FieldLabel>Checked</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox indeterminate />
            <FieldLabel>Partially selected</FieldLabel>
          </Field>
          <Field orientation="horizontal" invalid>
            <Checkbox required />
            <FieldLabel>Required acknowledgement</FieldLabel>
            <FieldError match>Review and acknowledge the change.</FieldError>
          </Field>
          <Field orientation="horizontal" disabled>
            <Checkbox />
            <FieldLabel>Disabled choice with a label long enough to wrap at 200% text zoom</FieldLabel>
          </Field>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => (
    <Stack gap="item">
      <Field orientation="horizontal">
        <Checkbox />
        <FieldLabel>Include archived tasks</FieldLabel>
      </Field>
      <Checkbox aria-label="Partially selected workspaces" indeterminate />
    </Stack>
  ),
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: 'Include archived tasks' })
    await userEvent.tab()
    await expect(checkbox).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(checkbox).toBeChecked()
    await userEvent.keyboard(' ')
    await expect(checkbox).not.toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: 'Partially selected workspaces' })).toHaveAttribute('aria-checked', 'mixed')
  },
} satisfies Story
