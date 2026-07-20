import type { Meta, StoryObj } from '@storybook/react-vite'
import { Inline, PageShell, Stack } from '@makinbakin/sdk/layout'
import { Badge, Button, Separator } from '@makinbakin/sdk/ui'

import './layout.stories.css'

const meta = {
  title: 'Layout/PageShell and flow',
  component: PageShell,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'PageShell supplies bounded page width, container-responsive insets, and one page rhythm. Stack owns vertical flow; Inline owns wrapping peer content and actions. All choices map to the finite Bakin layout scale.',
      },
    },
  },
} satisfies Meta<typeof PageShell>

export default meta
type Story = StoryObj<typeof meta>

const taskStats = [
  { label: 'Active', value: '42', detail: 'Across 8 agents' },
  { label: 'Due today', value: '7', detail: '3 need attention' },
  { label: 'Blocked', value: '4', detail: 'Owners notified' },
]

export const ResponsivePage = {
  render: () => (
    <PageShell width="wide" className="bakin-layout-story">
      <Inline as="header" align="start" justify="between" gap="section">
        <Stack gap="dense" className="bakin-layout-story__heading">
          <p className="bakin-layout-story__eyebrow">Tasks / live operations</p>
          <h1>Coordinate active work</h1>
          <p className="bakin-layout-story__lede">Keep owners, timing, and operational context visible without building another one-off page wrapper.</p>
        </Stack>
        <Inline as="nav" aria-label="Page actions" gap="dense">
          <Button variant="outline">Export view</Button>
          <Button>New task</Button>
        </Inline>
      </Inline>

      <Separator />

      <Stack as="section" gap="section" aria-labelledby="task-overview-title">
        <Inline align="baseline" justify="between">
          <h2 id="task-overview-title">Task overview</h2>
          <Badge tone="success">Live</Badge>
        </Inline>
        <Inline align="stretch" gap="item" className="bakin-layout-story__stats">
          {taskStats.map((stat) => (
            <Stack key={stat.label} gap="dense" className="bakin-layout-story__stat">
              <span className="bakin-layout-story__stat-label">{stat.label}</span>
              <strong>{stat.value}</strong>
              <span>{stat.detail}</span>
            </Stack>
          ))}
        </Inline>
      </Stack>
    </PageShell>
  ),
} satisfies Story
