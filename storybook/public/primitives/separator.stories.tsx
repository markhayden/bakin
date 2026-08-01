import type { Meta, StoryObj } from '@storybook/react-vite'
import { Separator } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Separator',
  component: Separator,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Separator reinforces an existing content boundary. It is decorative by default; set `decorative={false}` only when the separator itself communicates meaningful structure.' } },
    bakinCoverage: ['desktop', 'mobile-320'],
  },
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div>
      <p>Deployment policy</p>
      <Separator />
      <p>All production runs require approval.</p>
    </div>
  ),
  play: async ({ canvas, canvasElement }) => {
    const separator = canvasElement.querySelector('[data-orientation="horizontal"]')
    // Decorative by default: hidden from the accessibility tree, horizontal in layout.
    await expect(separator).toHaveAttribute('role', 'presentation')
    await expect(separator).not.toHaveAttribute('aria-orientation')
    await expect(canvas.getByText('Deployment policy')).toBeVisible()
    await expect(canvas.getByText('All production runs require approval.')).toBeVisible()
  },
} satisfies Story

export const Orientation = {
  render: () => (
    <StoryStage
      eyebrow="Structure"
      title="Separator"
      description="Subtle boundaries support—not create—the content hierarchy."
    >
      <StorySection title="Horizontal">
        <p>Deployment policy</p>
        <Separator />
        <p>All production runs require approval.</p>
      </StorySection>
      <StorySection title="Vertical">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--bakin-layout-gap-item)', alignItems: 'stretch', minHeight: 'var(--bakin-layout-size-control)' }}>
          <span>12 active</span><Separator orientation="vertical" /><span>3 blocked</span><Separator orientation="vertical" /><span>8 due today</span>
        </div>
      </StorySection>
      <StorySection title="Meaningful boundary" description="Only a separator that itself communicates structure opts out of decorative.">
        <p>Everything above this line ships in the next release.</p>
        <Separator decorative={false} />
        <p>Everything below is still in review.</p>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, canvasElement }) => {
    // Vertical separators carry the vertical orientation and stay decorative.
    const verticals = canvasElement.querySelectorAll('[data-orientation="vertical"]')
    await expect(verticals).toHaveLength(2)
    for (const vertical of verticals) {
      await expect(vertical).toHaveAttribute('role', 'presentation')
    }
    // A meaningful boundary is exposed as a real separator with its orientation.
    const semantic = canvas.getByRole('separator')
    await expect(semantic).toHaveAttribute('aria-orientation', 'horizontal')
  },
} satisfies Story
