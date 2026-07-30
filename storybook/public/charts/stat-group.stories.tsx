import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { StatGroup, StatTile } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Charts/StatGroup',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'StatGroup is a labelled group (role group with the required `label` as its accessible name) that packs compact peer StatTiles from the start edge and wraps as one unit instead of stretching a handful of values across the page. Use it for short, equally important counters above a result set.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <StatGroup label="Task summary metrics">
      <StatTile label="Active" value={4} valueTone="accent" />
      <StatTile label="Blocked" value={23} valueTone="danger" />
      <StatTile label="Total" value={35} />
    </StatGroup>
  ),
  play: async ({ canvas }) => {
    const group = canvas.getByRole('group', { name: 'Task summary metrics' })
    await expect(group).toBeVisible()
    await expect(group).toHaveAttribute('data-stat-group', '')
    await expect(group.querySelectorAll('[data-stat-tile]')).toHaveLength(3)
  },
} satisfies Story

export const CompactMetrics = {
  render: () => (
    <StoryStage
      eyebrow="Data / compact peer summary"
      title="Keep short peer metrics together"
      description="A compact metric group packs from the start edge and wraps as one unit instead of stretching a handful of values across the page."
    >
      <StorySection title="Task summary" description="Use this treatment for short, equally important counters above a result set.">
        <StatGroup label="Task summary metrics">
          <StatTile label="Active" value={4} valueTone="accent" />
          <StatTile label="Blocked" value={23} valueTone="danger" />
          <StatTile label="Done today" value={0} valueTone="success" />
          <StatTile label="Total" value={35} />
          <StatTile label="Agents" value={3} valueTone="accent" />
        </StatGroup>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const group = canvas.getByRole('group', { name: 'Task summary metrics' })
    await expect(group).toHaveAttribute('data-stat-group', '')
    await expect(group.querySelectorAll('[data-stat-tile]')).toHaveLength(5)
  },
} satisfies Story
