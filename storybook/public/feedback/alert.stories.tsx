import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { expect } from 'storybook/test'

import { SignalIcon, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Feedback/Alert',
  component: Alert,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Alert presents inline system feedback. Routine tones use polite `status` semantics; danger uses assertive `alert` semantics unless the message was already announced elsewhere.',
      },
    },
    bakinCoverage: ['desktop', 'keyboard', 'non-color'],
  },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    tone: 'danger',
  },
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'success', 'attention', 'danger', 'accent'] },
    children: { control: false },
  },
  render: ({ children: _children, ...args }) => (
    <Alert {...args} style={{ maxWidth: '26rem' }}>
      <AlertTitle>Connection failed</AlertTitle>
      <AlertDescription>Bakin could not reach the configured runtime.</AlertDescription>
    </Alert>
  ),
  play: async ({ canvas, args }) => {
    // Danger announces assertively as an alert; routine tones use polite status.
    const alert = canvas.getByRole(args.tone === 'danger' ? 'alert' : 'status')
    await expect(alert).toHaveAttribute('data-tone', args.tone ?? 'neutral')
    await expect(alert).toHaveTextContent('Connection failed')
  },
} satisfies Story

export const Tones = {
  render: () => (
    <StoryStage
      eyebrow="Feedback primitive"
      title="Alert tones"
      description="Every notice combines a clear title, actionable copy, and a semantic role appropriate to its urgency."
    >
      <StorySection title="Semantic tones" description="Titles carry the meaning; tone reinforces it and never stands alone.">
        <Stack gap="item">
          <Alert tone="neutral"><SignalIcon /><AlertTitle>Runtime update available</AlertTitle><AlertDescription>Review the release notes before restarting active work.</AlertDescription></Alert>
          <Alert tone="success"><SignalIcon /><AlertTitle>Configuration saved</AlertTitle><AlertDescription>New dispatches will use the updated limits.</AlertDescription></Alert>
          <Alert tone="attention"><SignalIcon /><AlertTitle>Review required</AlertTitle><AlertDescription>Two workflow steps need an owner before the run can start.</AlertDescription></Alert>
          <Alert tone="danger"><SignalIcon /><AlertTitle>Connection failed</AlertTitle><AlertDescription>Bakin could not reach the configured runtime.</AlertDescription></Alert>
          <Alert tone="accent"><SignalIcon /><AlertTitle>New capability detected</AlertTitle><AlertDescription>The plugin now contributes a searchable asset provider.</AlertDescription></Alert>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    // Danger is the only assertive announcement; routine tones stay polite.
    await expect(canvas.getByRole('alert')).toHaveTextContent('Connection failed')
    await expect(canvas.getAllByRole('status')).toHaveLength(4)
  },
} satisfies Story

export const WithAction = {
  render: () => (
    <StoryStage
      eyebrow="Recovery"
      title="Actionable feedback"
      description="Keep recovery local to the message when one short action can resolve the condition."
    >
      <StorySection title="Local recovery">
        <Alert tone="danger">
          <SignalIcon />
          <AlertTitle>Health checks could not finish</AlertTitle>
          <AlertDescription>The runtime stopped responding during the final check.</AlertDescription>
          <AlertAction><Button size="xs" variant="outline">Retry</Button></AlertAction>
        </Alert>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const retry = canvas.getByRole('button', { name: 'Retry' })
    await userEvent.tab()
    await expect(retry).toHaveFocus()
  },
} satisfies Story

export const PreviouslyAnnouncedDanger = {
  render: () => (
    <StoryStage
      eyebrow="Semantics"
      title="Avoid duplicate announcements"
      description="Override the role when an upstream live region has already announced the same failure."
    >
      <StorySection title="Role override">
        <Alert tone="danger" role="status">
          <AlertTitle>Import still needs attention</AlertTitle>
          <AlertDescription>Fix the two invalid rows and try the import again.</AlertDescription>
        </Alert>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const notice = canvas.getByRole('status')
    await expect(notice).toHaveAttribute('data-tone', 'danger')
  },
} satisfies Story
