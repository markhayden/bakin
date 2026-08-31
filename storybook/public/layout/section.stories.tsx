import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Section } from '@makinbakin/sdk/layout'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Layout/Section',
  component: Section,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Section is the semantic content region with predictable internal rhythm. `spacing` (`compact`, `default`, `generous`) sets the internal gap from the finite layout scale; `divider="top"` adds the canonical top border plus matching padding to separate a section from its preceding peer. Renders as `section` by default (`article` and `div` via `as`); label it with `aria-labelledby` when it should be a named landmark region.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320'],
  },
} satisfies Meta<typeof Section>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    spacing: 'default',
    divider: 'none',
  },
  // Section is polymorphic, so docgen cannot infer its props.
  argTypes: {
    spacing: { control: 'select', options: ['compact', 'default', 'generous'] },
    divider: { control: 'select', options: ['none', 'top'] },
  },
  render: (args) => (
    <Section spacing={args.spacing} divider={args.divider} aria-labelledby="runtime-signals-title">
      <h2 id="runtime-signals-title">Runtime signals</h2>
      <p>18 healthy agents reported in the last five minutes.</p>
    </Section>
  ),
  play: async ({ canvas, args }) => {
    const region = canvas.getByRole('region', { name: 'Runtime signals' })
    await expect(region).toBeVisible()
    await expect(region).toHaveAttribute('data-slot', 'section')
    await expect(region).toHaveAttribute('data-spacing', args.spacing ?? 'default')
    await expect(region).toHaveAttribute('data-divider', args.divider ?? 'none')
  },
} satisfies Story

const spacings = ['compact', 'default', 'generous'] as const

export const SpacingAndDividers = {
  render: () => (
    <StoryStage
      eyebrow="Layout / section rhythm"
      title="Consistent section separation"
      description="Sections own their internal gap and their separation from the preceding peer, so page rhythm never depends on ad-hoc margins."
    >
      <StorySection title="Spacing scale" description="The same content at each semantic spacing.">
        {spacings.map((spacing) => (
          <Section key={spacing} spacing={spacing} data-testid={`section-spacing-${spacing}`} aria-label={`Spacing ${spacing}`}>
            <h3>{spacing}</h3>
            <p>Internal rows separate by the section&apos;s named spacing.</p>
          </Section>
        ))}
      </StorySection>
      <StorySection title="Top divider" description="A dividing section carries the canonical border and matching padding itself.">
        <Section divider="top" data-testid="section-divider-top" aria-label="Divided section">
          <h3>Active operations</h3>
          <p>The divider stays attached to the section, not the neighbor above it.</p>
        </Section>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    for (const spacing of spacings) {
      await expect(canvas.getByTestId(`section-spacing-${spacing}`)).toHaveAttribute('data-spacing', spacing)
    }
    const divided = canvas.getByTestId('section-divider-top')
    await expect(divided).toHaveAttribute('data-divider', 'top')
    const borderWidth = Number.parseFloat(getComputedStyle(divided).borderTopWidth)
    await expect(borderWidth).toBeGreaterThan(0)
  },
} satisfies Story
