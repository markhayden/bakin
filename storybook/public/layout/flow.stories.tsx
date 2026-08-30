import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import {
  Inline,
  Stack,
  type InlineAlign,
  type InlineJustify,
  type LayoutGap,
  type StackAlign,
} from '@makinbakin/sdk/layout'
import { Badge } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const gapOptions = ['none', 'dense', 'item', 'section', 'page'] as const

const meta = {
  title: 'Components/Layout/Stack and Inline',
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

interface FlowCanonicalArgs {
  /** Stack gap from the finite semantic scale. */
  gap: LayoutGap
  /** Stack cross-axis alignment. */
  align: StackAlign
  /** Gap on the nested Inline row. */
  inlineGap: LayoutGap
  /** Alignment on the nested Inline row. */
  inlineAlign: InlineAlign
  /** Main-axis distribution on the nested Inline row. */
  inlineJustify: InlineJustify
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    gap: 'dense',
    align: 'stretch',
    inlineGap: 'item',
    inlineAlign: 'baseline',
    inlineJustify: 'between',
  },
  // Stack is polymorphic, so docgen cannot infer its props; the inline* knobs
  // drive the nested Inline row so both flow primitives stay playable here.
  argTypes: {
    gap: { control: 'select', options: gapOptions },
    align: { control: 'select', options: ['stretch', 'start', 'center', 'end'] },
    inlineGap: { control: 'select', options: gapOptions },
    inlineAlign: { control: 'select', options: ['stretch', 'start', 'center', 'end', 'baseline'] },
    inlineJustify: { control: 'select', options: ['start', 'center', 'end', 'between'] },
  },
  render: (args: FlowCanonicalArgs) => (
    <Stack gap={args.gap} align={args.align}>
      <Inline align={args.inlineAlign} justify={args.inlineJustify} gap={args.inlineGap}>
        <strong>Task overview</strong>
        <Badge tone="success">Live</Badge>
      </Inline>
      <span>42 active tasks across 8 agents.</span>
    </Stack>
  ),
  play: async ({ canvas, canvasElement, args }) => {
    await expect(canvas.getByText('Task overview')).toBeVisible()
    const stack = canvasElement.querySelector('[data-slot="stack"]')
    await expect(stack).toHaveAttribute('data-gap', args.gap)
    await expect(stack).toHaveAttribute('data-align', args.align)
    const inline = canvasElement.querySelector('[data-slot="inline"]')
    await expect(inline).toHaveAttribute('data-gap', args.inlineGap)
    await expect(inline).toHaveAttribute('data-justify', args.inlineJustify)
    await expect(inline).toHaveAttribute('data-align', args.inlineAlign)
  },
} satisfies StoryObj<FlowCanonicalArgs>

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
