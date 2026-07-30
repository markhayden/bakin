import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Inline, PageShell, Stack } from '@makinbakin/sdk/layout'
import { PageHeader } from '@makinbakin/sdk/patterns'
import { Badge, Button, Separator } from '@makinbakin/sdk/ui'

import './page-shell.stories.css'

const meta = {
  title: 'Layout/PageShell',
  component: PageShell,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'PageShell supplies bounded page width (`content`, `wide`, `full`), container-responsive insets, one page rhythm via `gap`, protected bottom clearance above the owning scroll boundary, and device-safe-area clearance. PageHeader owns page identity and the stable controls/action row; standard descriptions use the available width on narrow canvases and may grow to half of the owned page canvas on desktop. All choices map to the finite Bakin layout scale.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'overflow', 'scroll-ownership', 'long-content'],
  },
} satisfies Meta<typeof PageShell>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  render: () => (
    <PageShell width="content">
      <PageHeader
        eyebrow="Tasks / live operations"
        title="Coordinate active work"
        description="Track work across your agents while keeping owners and timing visible."
      />
      <p>Page content joins the shell&apos;s single vertical rhythm.</p>
    </PageShell>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Coordinate active work' })).toBeVisible()
    const shell = canvasElement.querySelector('[data-slot="page-shell"]')
    await expect(shell).toHaveAttribute('data-width', 'content')
    await expect(shell!.querySelector('[data-slot="page-shell-content"]')).toBeTruthy()
  },
} satisfies Story

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
        description="Create, assign, and track work across your agents while keeping owners, timing, and operational context visible from backlog through completion."
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
  play: async ({ canvas }) => {
    const header = canvas.getByRole('banner')
    const description = canvas.getByText(/Create, assign, and track work/)
    await expect(description).toBeVisible()
    // The standard measure caps copy at 50cqw only once the header container
    // reaches @3xl (48rem); below that the copy deliberately spans full width.
    const headerWidth = header.getBoundingClientRect().width
    if (headerWidth >= 768) {
      await expect(description.getBoundingClientRect().width).toBeLessThanOrEqual(headerWidth * 0.51)
    }
  },
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
