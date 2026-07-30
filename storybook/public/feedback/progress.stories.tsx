import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Feedback/Progress',
  component: Progress,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Progress exposes exact determinate values and an honest indeterminate state. Always provide an accessible label; use tone to reinforce the work state, not to replace it.',
      },
    },
    bakinCoverage: ['desktop', 'interaction', 'non-color'],
  },
  args: {
    value: 42,
  },
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Progress value={42} style={{ width: '20rem' }}>
      <ProgressLabel>Generating assets</ProgressLabel>
      <ProgressValue />
    </Progress>
  ),
  play: async ({ canvas }) => {
    const progress = canvas.getByRole('progressbar', { name: 'Generating assets' })
    await expect(progress).toHaveAttribute('aria-valuenow', '42')
    await expect(canvas.getByText('42%')).toBeVisible()
  },
} satisfies Story

export const States = {
  render: () => (
    <StoryStage
      eyebrow="Progress primitive"
      title="Honest work state"
      description="Use a number only when the system can measure completion. Otherwise render indeterminate progress."
    >
      <StorySection title="Determinate and indeterminate">
        <Stack gap="item" style={{ maxWidth: '32rem' }}>
          <Progress value={0}><ProgressLabel>Queued</ProgressLabel><ProgressValue /></Progress>
          <Progress value={42}><ProgressLabel>Generating assets</ProgressLabel><ProgressValue /></Progress>
          <Progress value={100}><ProgressLabel>Complete</ProgressLabel><ProgressValue /></Progress>
          <Progress value={null} tone="accent"><ProgressLabel>Connecting to runtime</ProgressLabel></Progress>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Generating assets' })).toHaveAttribute('aria-valuenow', '42')
    await expect(canvas.getByRole('progressbar', { name: 'Connecting to runtime' })).not.toHaveAttribute('aria-valuenow')
  },
} satisfies Story

export const Tones = {
  render: () => (
    <StoryStage
      eyebrow="Meaning"
      title="Progress tones"
      description="Primary is ordinary forward movement. Accent, attention, and danger reinforce explicitly labeled exceptional states."
    >
      <StorySection title="Labeled tone reinforcement" description="The label carries the meaning; tone reinforces it and never stands alone.">
        <Stack gap="item" style={{ maxWidth: '32rem' }}>
          <Progress value={70} tone="primary"><ProgressLabel>Processing</ProgressLabel><ProgressValue /></Progress>
          <Progress value={60} tone="accent"><ProgressLabel>Enrichment pass</ProgressLabel><ProgressValue /></Progress>
          <Progress value={50} tone="attention"><ProgressLabel>Approaching budget limit</ProgressLabel><ProgressValue /></Progress>
          <Progress value={35} tone="danger"><ProgressLabel>Failed items</ProgressLabel><ProgressValue /></Progress>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Sizes = {
  render: () => (
    <StoryStage
      eyebrow="Density"
      title="Progress sizes"
      description="Small fits compact rows, medium is the default when progress is important, and large anchors a focused status surface."
    >
      <StorySection title="Track heights">
        <Stack gap="item" style={{ maxWidth: '32rem' }}>
          <Progress value={28} size="sm"><ProgressLabel>Small</ProgressLabel><ProgressValue /></Progress>
          <Progress value={52} size="md"><ProgressLabel>Medium</ProgressLabel><ProgressValue /></Progress>
          <Progress value={76} size="lg"><ProgressLabel>Large</ProgressLabel><ProgressValue /></Progress>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

function InteractiveProgress() {
  const [value, setValue] = useState(20)
  return (
    <StoryStage
      eyebrow="Behavior"
      title="Updates remain exact"
      description="The accessible value and visible value advance together."
    >
      <StorySection title="Advancing work">
        <Stack gap="item" style={{ maxWidth: '32rem' }}>
          <Progress value={value} size="md"><ProgressLabel>Migration</ProgressLabel><ProgressValue /></Progress>
          <StoryCluster><Button size="sm" onClick={() => setValue((current) => Math.min(100, current + 20))}>Advance</Button></StoryCluster>
        </Stack>
      </StorySection>
    </StoryStage>
  )
}

export const Behavior = {
  render: () => <InteractiveProgress />,
  play: async ({ canvas, userEvent }) => {
    const progress = canvas.getByRole('progressbar', { name: 'Migration' })
    await expect(progress).toHaveAttribute('aria-valuenow', '20')
    await userEvent.click(canvas.getByRole('button', { name: 'Advance' }))
    await expect(progress).toHaveAttribute('aria-valuenow', '40')
    await expect(canvas.getByText('40%')).toBeInTheDocument()
  },
} satisfies Story
