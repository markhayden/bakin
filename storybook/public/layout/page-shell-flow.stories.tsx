import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Inline, PageShell, Stack } from '@makinbakin/sdk/layout'
import { PageHeader } from '@makinbakin/sdk/patterns'
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
        component: 'PageShell supplies bounded page width, container-responsive insets, one page rhythm, and protected bottom clearance above the owning scroll boundary. PageHeader owns page identity and the stable controls/action row. Stack owns vertical content flow; Inline owns wrapping peer content. All choices map to the finite Bakin layout scale.',
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
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Keep owners, timing, and operational context visible without building another one-off page wrapper."
        actions={<><Button variant="outline">Export view</Button><Button>New task</Button></>}
      />

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

export const ProtectedScrollEnd = {
  render: () => (
    <PageShell width="content" className="bakin-layout-story">
      <PageHeader
        eyebrow="Agents / active context"
        title="Long interior page"
        description="The page shell owns clearance after the final result, even when content grows beyond the viewport."
      />
      <Stack gap="section">
        {Array.from({ length: 12 }, (_, index) => (
          <Stack key={index} gap="dense" className="bakin-layout-story__stat">
            <strong>Result {index + 1}</strong>
            <span>Operational content remains in the host-owned page flow.</span>
          </Stack>
        ))}
      </Stack>
      <p data-testid="protected-scroll-end">End of results</p>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    const finalContent = canvas.getByTestId('protected-scroll-end')
    const shellContent = finalContent.closest('[data-slot="page-shell-content"]')
    await expect(shellContent).toBeTruthy()
    const shellTop = shellContent!.getBoundingClientRect().top
    const protectedGap = shellTop + shellContent!.scrollHeight - finalContent.getBoundingClientRect().bottom
    await expect(protectedGap).toBeGreaterThanOrEqual(32)
  },
} satisfies Story
