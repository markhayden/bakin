import type { Meta, StoryObj } from '@storybook/react-vite'
import { Label, Textarea } from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Textarea',
  component: Textarea,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Textarea is the low-level multiline control. It grows with content where supported, retains vertical resize, and preserves native validation and read-only semantics.' } },
  },
} satisfies Meta<typeof Textarea>

export default meta
type Story = StoryObj<typeof meta>

export const ContentAndStates = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Multiline entry</p><h1>Textarea</h1><p>Long operational content remains readable and vertically resizable without horizontal page overflow.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="textarea-states-heading">
        <header><h2 id="textarea-states-heading">States</h2></header>
        <div className="bakin-primitive-story__form-grid">
          <div className="bakin-primitive-story__field"><Label htmlFor="textarea-default">Operator handoff</Label><Textarea id="textarea-default" rows={5} defaultValue="Confirm the launch checklist, notify the assigned agents, and record any exception before the publishing window opens." /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="textarea-readonly">Generated summary</Label><Textarea id="textarea-readonly" rows={5} readOnly value="This summary is generated from the current workflow definition and cannot be edited here." /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="textarea-invalid">Required rationale</Label><Textarea id="textarea-invalid" rows={4} required aria-invalid="true" aria-describedby="textarea-invalid-error" /><p className="bakin-primitive-story__error" id="textarea-invalid-error">Explain why this production exception is needed.</p></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="textarea-disabled">Archived note</Label><Textarea id="textarea-disabled" rows={4} disabled defaultValue="Archived workflows cannot accept new notes." /></div>
        </div>
      </section>
    </main>
  ),
} satisfies Story
