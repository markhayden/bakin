import type { Meta, StoryObj } from '@storybook/react-vite'
import { Skeleton } from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { expect } from 'storybook/test'

import { StoryStage } from '../../support'

const meta = {
  title: 'Feedback/Skeleton',
  component: Skeleton,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Skeleton is silent loading presentation. Put `aria-busy="true"` and an accessible name on the region doing the loading; do not announce each placeholder.' } },
    bakinCoverage: ['desktop', 'loading', 'non-color'],
  },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    shape: 'rectangle',
  },
  // The shape knob drives the block placeholder; the two text lines stay fixed.
  argTypes: {
    shape: { control: 'select', options: ['rectangle', 'text', 'circle'] },
  },
  render: (args) => (
    <section aria-label="Loading task summary" aria-busy="true" style={{ display: 'grid', gap: '0.5rem', width: '16rem' }}>
      <Skeleton shape="text" style={{ width: '33%' }} />
      <Skeleton shape="text" style={{ width: '67%' }} />
      <Skeleton shape={args.shape} style={args.shape === 'circle' ? { width: '3rem' } : { height: '3rem' }} />
    </section>
  ),
  play: async ({ canvas, args }) => {
    const region = canvas.getByRole('region', { name: 'Loading task summary' })
    await expect(region).toHaveAttribute('aria-busy', 'true')
    const placeholders = region.querySelectorAll('[data-slot="skeleton"]')
    await expect(placeholders).toHaveLength(3)
    for (const placeholder of placeholders) {
      await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    }
    await expect(placeholders[2]).toHaveAttribute('data-shape', args.shape ?? 'rectangle')
  },
} satisfies Story

export const LoadingObject = {
  render: () => (
    <StoryStage
      eyebrow="Loading"
      title="Skeleton"
      description="Match the broad shape of arriving content without producing a decorative miniature UI."
    >
      <section aria-labelledby="loading-object-heading" aria-busy="true">
        <Stack gap="item">
          <header><h2 id="loading-object-heading">Loading assigned workflow</h2></header>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr)',
              gap: 'var(--bakin-layout-gap-item)',
              alignItems: 'start',
              minWidth: 0,
            }}
          >
            <Skeleton shape="circle" style={{ width: 'calc(var(--bakin-layout-space-8) + var(--bakin-layout-space-4))' }} />
            <Stack gap="dense">
              <Skeleton shape="text" style={{ width: '33%' }} />
              <Skeleton shape="text" style={{ width: '67%' }} />
              <Skeleton style={{ height: 'var(--bakin-layout-space-8)' }} />
            </Stack>
          </div>
        </Stack>
      </section>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const region = canvas.getByRole('region', { name: 'Loading assigned workflow' })
    await expect(region).toHaveAttribute('aria-busy', 'true')
    await expect(region).toHaveAttribute('aria-labelledby', 'loading-object-heading')
    // Placeholders stay silent: the region announces, each skeleton is hidden.
    for (const placeholder of region.querySelectorAll('[data-slot="skeleton"]')) {
      await expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    }
  },
} satisfies Story
