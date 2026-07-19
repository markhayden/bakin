import type { Meta, StoryObj } from '@storybook/react-vite'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Collapsible',
  component: Collapsible,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Collapsible for optional supporting detail. Its trigger owns the expanded state and panel relationship; required decisions and primary actions must remain visible.' } },
  },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

export const Behavior = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Disclosure</p>
        <h1>Collapsible</h1>
        <p>Optional advanced detail starts closed and remains completely keyboard operable.</p>
      </header>
      <section className="bakin-primitive-story__section" aria-labelledby="collapsible-heading">
        <header><h2 id="collapsible-heading">Retry policy</h2></header>
        <Collapsible>
          <CollapsibleTrigger>Advanced retry policy <span aria-hidden="true">+</span></CollapsibleTrigger>
          <CollapsibleContent>Retry twice, waiting 30 seconds and then 2 minutes before marking the dispatch blocked.</CollapsibleContent>
        </Collapsible>
      </section>
    </main>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Advanced retry policy' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{Enter}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/Retry twice/)).toBeVisible()
  },
} satisfies Story
