import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Inline, Stack } from '@makinbakin/sdk/layout'
import { Badge } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Layout/Stack and Inline',
  component: Stack,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Stack owns vertical content flow; Inline owns wrapping peer content such as actions, metadata, and stat rows. Both take the finite semantic gap scale (`none`, `dense`, `item`, `section`, `page`) instead of arbitrary spacing, render as any layout element via `as`, and expose alignment (`align`, plus Inline `justify` and baseline alignment). Inline wraps by default so peer rows reflow instead of overflowing on narrow canvases.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'long-labels'],
  },
} satisfies Meta<typeof Stack>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Stack gap="dense">
      <Inline align="baseline" justify="between" gap="item">
        <strong>Task overview</strong>
        <Badge tone="success">Live</Badge>
      </Inline>
      <span>42 active tasks across 8 agents.</span>
    </Stack>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Task overview')).toBeVisible()
    const stack = canvasElement.querySelector('[data-slot="stack"]')
    await expect(stack).toHaveAttribute('data-gap', 'dense')
    const inline = canvasElement.querySelector('[data-slot="inline"]')
    await expect(inline).toHaveAttribute('data-justify', 'between')
    await expect(inline).toHaveAttribute('data-align', 'baseline')
  },
} satisfies Story

const gapScale = ['none', 'dense', 'item', 'section', 'page'] as const

const wrappingLabels = [
  'Blocked',
  'Needs review',
  'Waiting on runtime credentials',
  'Deliberately long operational label that must wrap instead of overflowing the row',
  'Due today',
]

export const GapScaleAndWrapping = {
  render: () => (
    <StoryStage
      eyebrow="Layout / one-dimensional flow"
      title="One finite spacing scale"
      description="Builders choose a semantic gap, not a pixel value. Stack keeps vertical rhythm consistent; Inline keeps peer rows wrapping instead of overflowing."
    >
      <StorySection title="Stack gaps" description="The same two rows at each semantic gap.">
        <Inline align="start" gap="section">
          {gapScale.map((gap) => (
            <Stack key={gap} gap={gap} data-testid={`stack-gap-${gap}`}>
              <Badge tone="neutral">{gap}</Badge>
              <span>Second row</span>
            </Stack>
          ))}
        </Inline>
      </StorySection>
      <StorySection title="Inline wrapping" description="Peer content wraps by default; no label forces a horizontal scrollbar.">
        <Inline gap="item" data-testid="wrapping-inline">
          {wrappingLabels.map((label) => (
            <Badge key={label} tone="neutral">{label}</Badge>
          ))}
        </Inline>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    for (const gap of gapScale) {
      await expect(canvas.getByTestId(`stack-gap-${gap}`)).toHaveAttribute('data-gap', gap)
    }
    const wrapping = canvas.getByTestId('wrapping-inline')
    await expect(wrapping).toHaveAttribute('data-wrap', 'true')
    await expect(canvas.getByText(/Deliberately long operational label/)).toBeVisible()
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story
