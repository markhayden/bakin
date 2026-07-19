import type { Meta, StoryObj } from '@storybook/react-vite'
import { Badge } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Badge',
  component: Badge,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Badge labels compact metadata. `tone` communicates meaning and `variant` controls treatment; prefer visible text that still makes sense without color.',
      },
    },
  },
  args: {
    children: 'Ready',
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Tones = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Status primitive</p>
        <h1>Badge tones</h1>
        <p>Use neutral for metadata, success for confirmed outcomes, attention for required review, danger for failure, and accent for a product signal.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <header><h2>Semantic tones</h2><p>The label—not the color alone—states what happened.</p></header>
        <div className="bakin-primitive-story__cluster">
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="primary">Active</Badge>
          <Badge tone="success">Published</Badge>
          <Badge tone="attention">Needs review</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="accent">New signal</Badge>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Treatments = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Emphasis</p>
        <h1>Badge treatments</h1>
        <p>Soft is the default. Solid is reserved for strong confirmed state; outline sits quietly beside dense data.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__cluster">
          <Badge tone="success" variant="soft">Soft</Badge>
          <Badge tone="success" variant="solid">Solid</Badge>
          <Badge tone="success" variant="outline">Outline</Badge>
          <Badge tone="success" variant="ghost">Ghost</Badge>
          <Badge tone="success" variant="link" render={<a href="#badge-treatment" />}>Linked</Badge>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Sizes = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Density</p>
        <h1>Two badge sizes</h1>
        <p>Small fits ordinary metadata. Medium supports stronger labels and comfortable interactive targets.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__cluster">
          <Badge size="sm" tone="neutral">Small metadata</Badge>
          <Badge size="md" tone="attention" variant="outline">Medium action state</Badge>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Interactive = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Composition</p>
        <h1>Interactive badges remain links</h1>
        <p>Render the correct native element and keep the badge treatment as presentation.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__cluster">
          <Badge size="md" tone="accent" variant="outline" render={<a href="#open-filter" />}>Open 4 filtered tasks</Badge>
        </div>
      </section>
    </main>
  ),
  play: async ({ canvas, userEvent }) => {
    const link = canvas.getByRole('link', { name: 'Open 4 filtered tasks' })
    await userEvent.tab()
    await expect(link).toHaveFocus()
  },
} satisfies Story
