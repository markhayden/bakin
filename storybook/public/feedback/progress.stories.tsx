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
        component: 'Progress exposes exact determinate values and an honest indeterminate state. Always provide an accessible label; use tone to reinforce the work state, not to replace it. `markers` renders reference ticks on the track (thresholds, budgets) — the tick only marks where; name what it means in visible text.',
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
  args: {
    value: 42,
    children: (
      <>
        <ProgressLabel>Generating assets</ProgressLabel>
        <ProgressValue />
      </>
    ),
  },
  argTypes: {
    children: { control: false },
  },
  render: (args) => <Progress {...args} style={{ width: '20rem' }} />,
  play: async ({ canvas, args }) => {
    const progress = canvas.getByRole('progressbar', { name: 'Generating assets' })
    if (typeof args.value === 'number') {
      await expect(progress).toHaveAttribute('aria-valuenow', String(args.value))
      await expect(canvas.getByText(`${args.value}%`)).toBeVisible()
    } else {
      await expect(progress).not.toHaveAttribute('aria-valuenow')
    }
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

export const Markers = {
  render: () => (
    <StoryStage
      eyebrow="Reference points"
      title="Track markers"
      description="A marker names a fixed reference on the track — where the runtime auto-compacts, where a budget window rolls — while the fill stays the exact reading."
    >
      <StorySection
        title="Thresholds on the track"
        description="The tick marks where; the visible label says what. Never rely on the tick alone."
      >
        <Stack gap="item" style={{ maxWidth: '32rem' }}>
          <Progress value={62} size="md" markers={[{ value: 94, label: 'Auto-compaction threshold' }]}>
            <ProgressLabel>Context used (compacts at 94%)</ProgressLabel>
            <ProgressValue />
          </Progress>
          <Progress
            value={140}
            max={200}
            size="md"
            tone="attention"
            markers={[{ value: 150, label: 'Soft cap' }, { value: 180, label: 'Hard cap' }]}
          >
            <ProgressLabel>Spend this window (soft cap 150, hard cap 180)</ProgressLabel>
            <ProgressValue />
          </Progress>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('progressbar', { name: 'Context used (compacts at 94%)' })).toHaveAttribute('aria-valuenow', '62')
    const markers = canvasElement.querySelectorAll('[data-slot="progress-marker"]')
    await expect(markers.length).toBe(3)
    await expect((markers[0] as HTMLElement).style.insetInlineStart).toBe('94%')
    // Value-domain markers scale by max: 150 of 200 sits at 75% of the track.
    await expect((markers[1] as HTMLElement).style.insetInlineStart).toBe('75%')
  },
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
