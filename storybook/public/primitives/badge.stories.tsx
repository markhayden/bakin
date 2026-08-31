import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/Badge',
  component: Badge,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Badge labels compact metadata. `tone` communicates meaning and `variant` controls treatment; prefer visible text that still makes sense without color.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'non-color'],
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    tone: 'success',
    variant: 'solid',
    children: 'Published',
  },
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'primary', 'success', 'attention', 'danger', 'accent', 'info'] },
    variant: { control: 'select', options: ['soft', 'solid', 'outline', 'ghost', 'link'] },
    size: { control: 'select', options: ['xs', 'sm', 'md'] },
  },
  play: async ({ canvas, args }) => {
    // The visible label is the non-color cue: the status reads without the tone.
    const badge = canvas.getByText(String(args.children))
    await expect(badge).toBeVisible()
    await expect(badge).toHaveTextContent(/\S/)
  },
} satisfies Story

export const Tones = {
  render: () => (
    <StoryStage
      eyebrow="Status primitive"
      title="Badge tones"
      description="Use neutral for metadata, success for confirmed outcomes, attention for required review, danger for failure, and accent for a product signal."
    >
      <StorySection title="Semantic tones" description="The label—not the color alone—states what happened.">
        <StoryCluster>
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="primary">Active</Badge>
          <Badge tone="success">Published</Badge>
          <Badge tone="attention">Needs review</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="info">Scheduled</Badge>
          <Badge tone="accent">New signal</Badge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    // Every tone carries a visible text label — status never rides on color alone.
    for (const label of ['Draft', 'Active', 'Published', 'Needs review', 'Blocked', 'New signal']) {
      await expect(canvas.getByText(label)).toBeVisible()
    }
  },
} satisfies Story

export const Treatments = {
  render: () => (
    <StoryStage
      eyebrow="Emphasis"
      title="Badge treatments"
      description="Solid is preferred for semantic status, soft supports compact metadata, and outline sits quietly beside dense data or marks secondary context."
    >
      <StorySection title="One tone, five treatments">
        <StoryCluster>
          <Badge tone="success" variant="soft">Soft</Badge>
          <Badge tone="success" variant="solid">Solid</Badge>
          <Badge tone="success" variant="outline">Outline</Badge>
          <Badge tone="success" variant="ghost">Ghost</Badge>
          <Badge tone="success" variant="link" render={<a href="#badge-treatment" />}>Linked</Badge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Sizes = {
  render: () => (
    <StoryStage
      eyebrow="Density"
      title="Three badge sizes"
      description="Extra small fits compact counts, small fits ordinary metadata, and medium supports stronger labels and comfortable interactive targets."
    >
      <StorySection title="Purposeful sizes">
        <StoryCluster>
          <Badge size="xs" tone="neutral" variant="solid">3</Badge>
          <Badge size="sm" tone="neutral">Small metadata</Badge>
          <Badge size="md" tone="attention" variant="outline">Medium action state</Badge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Interactive = {
  render: () => (
    <StoryStage
      eyebrow="Composition"
      title="Interactive badges remain links"
      description="Render the correct native element and keep the badge treatment as presentation."
    >
      <StorySection title="Native link semantics">
        <StoryCluster>
          <Badge size="md" tone="accent" variant="outline" render={<a href="#open-filter" />}>Open 4 filtered tasks</Badge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const link = canvas.getByRole('link', { name: 'Open 4 filtered tasks' })
    await expect(link).toHaveAttribute('href', '#open-filter')
    await userEvent.tab()
    await expect(link).toHaveFocus()
  },
} satisfies Story
