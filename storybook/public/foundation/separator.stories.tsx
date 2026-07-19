import type { Meta, StoryObj } from '@storybook/react-vite'
import { Separator } from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Separator',
  component: Separator,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Separator reinforces an existing content boundary. It is decorative by default; set `decorative={false}` only when the separator itself communicates meaningful structure.' } },
  },
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Orientation = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Structure</p>
        <h1>Separator</h1>
        <p>Subtle boundaries support—not create—the content hierarchy.</p>
      </header>
      <section className="bakin-primitive-story__section" aria-labelledby="horizontal-heading">
        <header><h2 id="horizontal-heading">Horizontal</h2></header>
        <p>Deployment policy</p><Separator /><p className="bakin-primitive-story__status">All production runs require approval.</p>
      </section>
      <section className="bakin-primitive-story__section" aria-labelledby="vertical-heading">
        <header><h2 id="vertical-heading">Vertical</h2></header>
        <div className="bakin-primitive-story__vertical-separator">
          <span>12 active</span><Separator orientation="vertical" /><span>3 blocked</span><Separator orientation="vertical" /><span>8 due today</span>
        </div>
      </section>
    </main>
  ),
} satisfies Story
