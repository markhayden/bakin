import type { Meta, StoryObj } from '@storybook/react-vite'
import { ShimmerText } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/ShimmerText',
  component: ShimmerText,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'ShimmerText is the kit text-motion pattern: a left-to-right luminance sweep (muted gradient base, bright band, 2.4s linear loop) for labels describing work genuinely in motion right now. `active={false}` renders the same span without the sweep so toggling never changes markup, and `highlight` is a closed vocabulary — `ink` sweeps with the primary text token, `accent` with the brand accent token; there are no raw color props. Under reduced motion (`motion-reduce:animate-none`, which the automation fixture also forces) the animation stops and the gradient pins mid-sweep, leaving the label slightly brighter than body copy — the same distinction without motion, and a deterministic visual baseline. ShimmerText adds no semantics: it is the same visible text, with no role or aria of its own.',
      },
    },
    bakinCoverage: ['desktop', 'non-color', 'reduced-motion'],
  },
} satisfies Meta<typeof ShimmerText>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    active: true,
    highlight: 'ink',
    base: 'muted',
  },
  argTypes: {
    active: { control: 'boolean' },
    highlight: { control: 'select', options: ['ink', 'accent'] },
    base: { control: 'select', options: ['muted', 'primary'] },
    children: { control: false },
  },
  render: ({ children: _children, ...args }) => <ShimmerText {...args}>Generating summary…</ShimmerText>,
  play: async ({ canvas, args }) => {
    const label = canvas.getByText('Generating summary…')
    await expect(label).toHaveAttribute('data-slot', 'shimmer-text')
    await expect(label).toHaveAttribute('data-active', String(args.active ?? true))
    await expect(label).toHaveAttribute('data-highlight', args.highlight ?? 'ink')
    await expect(label).toHaveAttribute('data-base', args.base ?? 'muted')
    if (args.active ?? true) {
      await expect(label.className).toContain('animate-shimmer-sweep')
      await expect(label.className).toContain('motion-reduce:animate-none')
    }
  },
} satisfies Story

export const StatesAndHighlights = {
  render: () => (
    <StoryStage
      eyebrow="Primitives / text motion"
      title="Sweep only what is actually in motion"
      description="Reserve the shimmer for labels naming work happening right now; steady states render the identical span without the sweep. Reduced motion pins the band mid-sweep, keeping the active label slightly brighter than body copy."
    >
      <StorySection title="Active vs inactive">
        <p style={{ margin: 0, display: 'grid', gap: 'var(--bakin-layout-space-2)' }}>
          <ShimmerText>Composing reply</ShimmerText>
          <ShimmerText active={false} className="text-bakin-text-muted">
            Idle
          </ShimmerText>
        </p>
      </StorySection>
      <StorySection title="Highlight vocabulary">
        <p style={{ margin: 0, display: 'grid', gap: 'var(--bakin-layout-space-2)' }}>
          <ShimmerText highlight="ink">Ink sweep</ShimmerText>
          <ShimmerText highlight="accent">Accent sweep</ShimmerText>
        </p>
      </StorySection>
      <StorySection title="Base vocabulary" description="The resting text the band sweeps over: muted for secondary labels, primary for emphasized text.">
        <p style={{ margin: 0, display: 'grid', gap: 'var(--bakin-layout-space-2)' }}>
          <ShimmerText base="muted">Muted base</ShimmerText>
          <ShimmerText base="primary" highlight="accent">Primary base, accent band</ShimmerText>
        </p>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const activeLabel = canvas.getByText('Composing reply')
    await expect(activeLabel).toHaveAttribute('data-active', 'true')
    await expect(activeLabel.className).toContain('animate-shimmer-sweep')

    const inactiveLabel = canvas.getByText('Idle')
    await expect(inactiveLabel).toHaveAttribute('data-active', 'false')
    await expect(inactiveLabel.className).not.toContain('animate-shimmer-sweep')
    await expect(inactiveLabel.className).not.toContain('bg-clip-text')

    await expect(canvas.getByText('Ink sweep')).toHaveAttribute('data-highlight', 'ink')
    await expect(canvas.getByText('Accent sweep')).toHaveAttribute('data-highlight', 'accent')
    await expect(canvas.getByText('Muted base')).toHaveAttribute('data-base', 'muted')
    await expect(canvas.getByText('Primary base, accent band')).toHaveAttribute('data-base', 'primary')
  },
} satisfies Story
