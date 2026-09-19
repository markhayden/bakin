import type { Meta, StoryObj } from '@storybook/react-vite'
import { Stack } from '@makinbakin/sdk/layout'
import { Badge } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { CheckIcon, StoryCluster, StorySection, StoryStage } from '../../support'

const tones = ['neutral', 'primary', 'success', 'attention', 'danger', 'info', 'accent'] as const
const treatments = ['soft', 'solid', 'outline', 'ghost', 'link'] as const
const sizes = ['xs', 'sm', 'md'] as const

const meta = {
  title: 'Components/Primitives/Badge',
  component: Badge,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Badge labels compact metadata. `tone` communicates meaning and `variant` controls treatment; prefer visible text that still makes sense without color. Treatments compares every tone and variant; Sizes compares density with and without icons. These galleries show the current kit styling.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'non-color', 'long-labels'],
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
      <StorySection title="Long metadata labels" description="Badge keeps its label on one line. Use concise metadata; StatusBadge provides constrained truncation for longer state labels.">
        <StoryCluster>
          <Badge tone="neutral">Waiting for the next scheduled run</Badge>
          <Badge tone="info">Scheduled for tomorrow</Badge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    // Every tone carries a visible text label — status never rides on color alone.
    for (const label of ['Draft', 'Active', 'Published', 'Needs review', 'Blocked', 'Scheduled', 'New signal']) {
      await expect(canvas.getByText(label)).toBeVisible()
    }
  },
} satisfies Story

export const Treatments = {
  render: () => (
    <StoryStage
      eyebrow="Emphasis"
      title="Badge treatments"
      description="Compare all seven tones across all five current treatments. Link badges have a subtle persistent underline that strengthens on hover or keyboard focus; ghost badges remain plain."
    >
      {tones.map((tone) => (
        <StorySection key={tone} title={tone}>
          <StoryCluster>
            {treatments.map((variant) => (
              <Stack key={variant} align="start" gap="dense">
                <span className="text-bakin-typography-size-meta text-bakin-text-muted">{variant}</span>
                <Badge
                  tone={tone}
                  variant={variant}
                  render={variant === 'link' ? <a href="#badge-treatment-notes" /> : undefined}
                >
                  {tone}
                </Badge>
              </Stack>
            ))}
          </StoryCluster>
        </StorySection>
      ))}
      <p id="badge-treatment-notes" className="text-bakin-typography-size-meta text-bakin-text-muted">
        Tone carries meaning; treatment controls emphasis. Compare text, border, and fill separately.
        These are the existing styles, including differences in outline text color between tones.
      </p>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    for (const tone of tones) {
      await expect(canvas.getAllByText(tone, { selector: '[data-slot="badge"]' })).toHaveLength(treatments.length)
      const link = canvas.getByRole('link', { name: tone })
      await expect(link).toHaveAttribute('href', '#badge-treatment-notes')
      // Navigation stays identifiable before hover, including on touch screens.
      await expect(getComputedStyle(link).textDecorationLine).toBe('underline')
      const ghost = canvas.getByText(tone, { selector: '[data-variant="ghost"]' })
      await expect(getComputedStyle(ghost).textDecorationLine).toBe('none')
    }
  },
} satisfies Story

export const Sizes = {
  render: () => (
    <StoryStage
      eyebrow="Density"
      title="Three badge sizes"
      description="Compare xs, sm, and md with identical copy, with and without an icon. Small is the default; extra small fits compact counts, and medium gives labels more prominence."
    >
      {treatments.map((variant) => (
        <StorySection key={variant} title={variant}>
          <StoryCluster>
            {sizes.map((size) => (
              <Stack key={size} align="start" gap="dense">
                <span className="text-bakin-typography-size-meta text-bakin-text-muted">{size}</span>
                <Badge size={size} tone="success" variant={variant} render={variant === 'link' ? <a href="#badge-size-notes" /> : undefined}>Published</Badge>
                <Badge size={size} tone="success" variant={variant} render={variant === 'link' ? <a href="#badge-size-notes" /> : undefined}><CheckIcon />Published</Badge>
              </Stack>
            ))}
          </StoryCluster>
        </StorySection>
      ))}
      <p id="badge-size-notes" className="text-bakin-typography-size-meta text-bakin-text-muted">
        Icon size and spacing follow badge size. Visible text keeps the meaning available without the icon or color.
      </p>
    </StoryStage>
  ),
} satisfies Story

export const Interactive = {
  render: () => (
    <StoryStage
      eyebrow="Composition"
      title="Interactive badges remain links"
      description="Render navigation as a native link. The link treatment stays underlined before hover; other treatments retain their own appearance when rendered as links."
    >
      <StorySection title="Native link semantics">
        <StoryCluster>
          <Badge size="md" tone="accent" variant="outline" render={<a href="#open-filter" />}>Open 4 filtered tasks</Badge>
          <Badge size="md" tone="accent" variant="link" render={<a href="#open-filter" />}>View filtered tasks</Badge>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const link = canvas.getByRole('link', { name: 'Open 4 filtered tasks' })
    await expect(link).toHaveAttribute('href', '#open-filter')
    await userEvent.tab()
    await expect(link).toHaveFocus()
    await expect(getComputedStyle(link).textDecorationLine).toBe('none')
    const textLink = canvas.getByRole('link', { name: 'View filtered tasks' })
    await expect(getComputedStyle(textLink).textDecorationLine).toBe('underline')
    await expect(getComputedStyle(textLink).textDecorationColor).not.toBe(getComputedStyle(textLink).color)
    await userEvent.tab()
    await expect(textLink).toHaveFocus()
    await expect(getComputedStyle(textLink).textDecorationColor).toBe(getComputedStyle(textLink).color)
  },
} satisfies Story
