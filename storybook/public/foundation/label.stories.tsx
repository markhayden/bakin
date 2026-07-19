import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input, Label } from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Label',
  component: Label,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Label names a native or SDK control through htmlFor. Requirement indicators and descriptions are separate copy; never rely on placeholder text as the label.' } },
  },
} satisfies Meta<typeof Label>

export default meta
type Story = StoryObj<typeof meta>

export const Association = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Form semantics</p><h1>Label</h1><p>Clicking the visible name moves focus to its control.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="label-example-heading">
        <header><h2 id="label-example-heading">Visible association</h2></header>
        <div className="bakin-primitive-story__field">
          <div className="bakin-primitive-story__label-row"><Label htmlFor="label-project-name">Project name</Label><span>Required</span></div>
          <p id="label-project-description">Use the name operators recognize in search.</p>
          <Input id="label-project-name" required aria-describedby="label-project-description" placeholder="Q3 launch" />
        </div>
      </section>
    </main>
  ),
} satisfies Story
