import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid } from '@makinbakin/sdk/layout'
import { StatTile } from '@makinbakin/sdk/patterns'

import { StoryCluster, StorySection, StoryStage } from '../../support'

function MetricIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 16 16" className={className}><path d="M3 12V8m5 4V3m5 9V6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" /></svg>
}

const meta = {
  title: 'Components/Charts/StatTile',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'StatTile presents one compact technical metric: an uppercase label, an exact mono value with optional semantic `valueTone`, supporting `sub` copy, and an optional labelled `progress` meter that exposes exact aria values. The `plain` variant is the quiet default for static summaries; `variant="surface"` with `onClick` renders a native button for metrics that open a filtered view. Label, value, and sub copy stay visible text, so meaning never rides on color alone.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'non-color', 'progress', 'keyboard', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <StatTile
      label="Success rate"
      value="91.4%"
      valueTone="success"
      sub="128 of 140 observed"
      progress={{ percent: 91.4, tone: 'success', label: 'Success rate' }}
    />
  ),
  play: async ({ canvas }) => {
    // The exact value and label are visible text — the non-color status cue.
    await expect(canvas.getByText('Success rate')).toBeVisible()
    await expect(canvas.getByText('91.4%')).toBeVisible()
    await expect(canvas.getByText('128 of 140 observed')).toBeVisible()
    // The progress prop renders a labelled meter with the exact accessible value.
    const meter = canvas.getByRole('progressbar', { name: 'Success rate' })
    await expect(meter).toHaveAttribute('aria-valuenow', '91.4')
    await expect(meter).toHaveAttribute('aria-valuemin', '0')
    await expect(meter).toHaveAttribute('aria-valuemax', '100')
    await expect(canvas.getByText('91.4%').closest('[data-stat-tile]')).toHaveAttribute('data-variant', 'plain')
    await expect(canvas.getByText('91.4%').closest('[data-stat-tile]')).toHaveAttribute('data-value-tone', 'success')
  },
} satisfies Story

export const DenseMetrics = {
  render: () => (
    <StoryStage
      eyebrow="Data / scan rhythm"
      title="Keep technical metrics dense and honest"
      description="The default treatment uses type, spacing, and a quiet divider instead of placing a card around every number."
    >
      <StorySection title="Task summary" description="Exact context and coverage stay beside the value, including at narrow widths and 200% text.">
        <Grid layout="quarters" gap="dense" aria-label="Task summary metrics">
          <StatTile icon={MetricIcon} label="Active" value={42} sub="Across six agents" />
          <StatTile label="Success rate" value="91.4%" valueTone="success" sub="128 of 140 observed" progress={{ percent: 91.4, tone: 'success', label: 'Success rate' }} />
          <StatTile label="Search p95" value="184 ms" sub="Last 60 minutes" />
          <StatTile label="Plugin migration coverage across official surfaces" value="128 / 140" valueTone="attention" sub="12 surfaces remain" progress={{ percent: 91.428, tone: 'attention', label: 'Plugin migration coverage' }} />
        </Grid>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByText(/Active|Success rate|Search p95|Plugin migration coverage/)).toHaveLength(4)
    await expect(canvas.getByRole('progressbar', { name: 'Success rate' })).toHaveAttribute('aria-valuenow', '91.4')
    await expect(canvas.getByRole('progressbar', { name: 'Plugin migration coverage' })).toHaveAttribute('aria-valuenow', '91.428')
    for (const tile of canvas.getAllByText(/42|91.4%|184 ms|128 \/ 140/).map((node) => node.closest('[data-stat-tile]'))) {
      await expect(tile).toHaveAttribute('data-variant', 'plain')
    }
  },
} satisfies Story

function ActionableMetricsExample() {
  const [selected, setSelected] = useState<string | null>(null)
  const choose = (value: string) => setSelected((current) => current === value ? null : value)

  return (
    <StoryStage
      eyebrow="Data / bounded actions"
      title="Use a surface only when the metric is an object"
      description="Actionable tiles become native buttons with visible focus. Static summary numbers stay on the quieter default treatment."
    >
      <StorySection title="Open a filtered task view" description="The label, value, and supporting copy form one keyboard-operable action.">
        <Grid layout="cards" gap="item" aria-label="Actionable task metrics">
          <StatTile variant="surface" label="Needs review" value={8} valueTone="attention" sub="Open the review queue" onClick={() => choose('Needs review')} />
          <StatTile variant="surface" label="Blocked tasks" value={3} valueTone="danger" sub="Inspect unavailable dependencies" onClick={() => choose('Blocked tasks')} />
          <StatTile variant="surface" label="Completed today" value={27} valueTone="success" sub="Review delivered work" onClick={() => choose('Completed today')} />
        </Grid>
        <StoryCluster>
          <p role="status">{selected ? `${selected} selected` : 'No metric selected'}</p>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  )
}

export const ActionableMetrics = {
  render: () => <ActionableMetricsExample />,
  play: async ({ canvas, userEvent }) => {
    const blocked = canvas.getByRole('button', { name: /Blocked tasks 3/ })
    blocked.focus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Blocked tasks selected')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('No metric selected')
    await expect(blocked).toHaveFocus()
  },
} satisfies Story
