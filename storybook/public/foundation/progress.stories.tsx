import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@makinbakin/sdk/ui'
import { useState } from 'react'
import { expect } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Progress',
  component: Progress,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Progress exposes exact determinate values and an honest indeterminate state. Always provide an accessible label; use tone to reinforce the work state, not to replace it.',
      },
    },
  },
  args: {
    value: 42,
  },
} satisfies Meta<typeof Progress>

export default meta
type Story = StoryObj<typeof meta>

export const States = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Progress primitive</p>
        <h1>Honest work state</h1>
        <p>Use a number only when the system can measure completion. Otherwise render indeterminate progress.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__stack">
          <Progress value={0}><ProgressLabel>Queued</ProgressLabel><ProgressValue /></Progress>
          <Progress value={42}><ProgressLabel>Generating assets</ProgressLabel><ProgressValue /></Progress>
          <Progress value={100}><ProgressLabel>Complete</ProgressLabel><ProgressValue /></Progress>
          <Progress value={null} tone="accent"><ProgressLabel>Connecting to runtime</ProgressLabel></Progress>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Tones = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Meaning</p>
        <h1>Progress tones</h1>
        <p>Primary is ordinary forward movement. Accent, attention, and danger reinforce explicitly labeled exceptional states.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__stack">
          <Progress value={70} tone="primary"><ProgressLabel>Processing</ProgressLabel><ProgressValue /></Progress>
          <Progress value={60} tone="accent"><ProgressLabel>Enrichment pass</ProgressLabel><ProgressValue /></Progress>
          <Progress value={50} tone="attention"><ProgressLabel>Approaching budget limit</ProgressLabel><ProgressValue /></Progress>
          <Progress value={35} tone="danger"><ProgressLabel>Failed items</ProgressLabel><ProgressValue /></Progress>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Sizes = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Density</p>
        <h1>Progress sizes</h1>
        <p>Small fits compact rows, medium is the default when progress is important, and large anchors a focused status surface.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__stack">
          <Progress value={28} size="sm"><ProgressLabel>Small</ProgressLabel><ProgressValue /></Progress>
          <Progress value={52} size="md"><ProgressLabel>Medium</ProgressLabel><ProgressValue /></Progress>
          <Progress value={76} size="lg"><ProgressLabel>Large</ProgressLabel><ProgressValue /></Progress>
        </div>
      </section>
    </main>
  ),
} satisfies Story

function InteractiveProgress() {
  const [value, setValue] = useState(20)
  return (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Behavior</p>
        <h1>Updates remain exact</h1>
        <p>The accessible value and visible value advance together.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <Progress value={value} size="md"><ProgressLabel>Migration</ProgressLabel><ProgressValue /></Progress>
        <div className="bakin-primitive-story__cluster"><Button size="sm" onClick={() => setValue((current) => Math.min(100, current + 20))}>Advance</Button></div>
      </section>
    </main>
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
