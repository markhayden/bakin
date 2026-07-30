import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel, Switch } from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { expect } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Switch',
  component: Switch,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Switch for a binary setting that takes effect immediately. Use Checkbox instead for acknowledgements, multi-selection, or choices submitted together by a later action.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'validation'],
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

function SwitchBehaviorFixture() {
  const [enabled, setEnabled] = useState(false)
  return (
    <Field orientation="horizontal">
      <Switch checked={enabled} onCheckedChange={setEnabled} />
      <FieldLabel>Automatic retry</FieldLabel>
      <FieldDescription role="status">{enabled ? 'Enabled' : 'Disabled'}</FieldDescription>
    </Field>
  )
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Field orientation="horizontal">
      <Switch />
      <FieldLabel>Automatic retry</FieldLabel>
    </Field>
  ),
  play: async ({ canvas, userEvent }) => {
    const control = canvas.getByRole('switch', { name: 'Automatic retry' })
    await expect(control).not.toBeChecked()
    await userEvent.click(control)
    await expect(control).toBeChecked()
  },
} satisfies Story

export const States = {
  render: () => (
    <StoryStage
      eyebrow="Immediate setting"
      title="Switch"
      description="Both sizes preserve the same 24px minimum target. The compact size uses a slimmer visual track while keeping clear on/off contrast."
    >
      <StorySection title="Canonical states">
        <Stack gap="item" style={{ maxWidth: '40rem' }}>
          <Field orientation="horizontal">
            <Switch />
            <FieldLabel>Off</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch defaultChecked />
            <FieldLabel>On</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch size="sm" />
            <FieldLabel>Compact off</FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Switch size="sm" defaultChecked />
            <FieldLabel>Compact operational setting</FieldLabel>
          </Field>
          <Field orientation="horizontal" invalid>
            <Switch />
            <FieldLabel>Invalid setting</FieldLabel>
            <FieldError match>Resolve the policy conflict.</FieldError>
          </Field>
          <Field orientation="horizontal" disabled>
            <Switch />
            <FieldLabel>Disabled organization-managed setting with a long wrapping label</FieldLabel>
          </Field>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => <SwitchBehaviorFixture />,
  play: async ({ canvas, userEvent }) => {
    const control = canvas.getByRole('switch', { name: 'Automatic retry' })
    await userEvent.tab()
    await expect(control).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(control).toBeChecked()
    await expect(canvas.getByRole('status')).toHaveTextContent('Enabled')
    await userEvent.keyboard(' ')
    await expect(control).not.toBeChecked()
    await expect(canvas.getByRole('status')).toHaveTextContent('Disabled')
  },
} satisfies Story
