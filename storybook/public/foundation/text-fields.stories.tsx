import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  Label,
  Textarea,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Text fields',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Low-level text-field controls retain native browser semantics while standardizing Product Character presentation. Routine forms should compose them through the field patterns published in the patterns entrypoint; raw native controls are an explicit domain-interface exception.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview = {
  render: function TextFieldOverview() {
    const [owner, setOwner] = useState('research-ops@example.com')
    return (
      <main className="bakin-primitive-story">
        <header className="bakin-primitive-story__intro">
          <p className="bakin-primitive-story__eyebrow">Foundation</p>
          <h1>Text fields</h1>
          <p>Native input behavior, consistent state language, and one composable adornment system.</p>
        </header>

        <section className="bakin-primitive-story__section" aria-labelledby="field-defaults-heading">
          <header><h2 id="field-defaults-heading">Routine entry</h2><p>Labels name the control; descriptions and validation messages use explicit associations.</p></header>
          <div className="bakin-primitive-story__form-grid">
            <div className="bakin-primitive-story__field">
              <div className="bakin-primitive-story__label-row"><Label htmlFor="overview-owner">Owner email</Label><span>Required</span></div>
              <p id="overview-owner-description">Used for approval notifications.</p>
              <Input id="overview-owner" type="email" inputMode="email" autoComplete="email" required aria-describedby="overview-owner-description" value={owner} onChange={(event) => setOwner(event.target.value)} />
            </div>
            <div className="bakin-primitive-story__field">
              <div className="bakin-primitive-story__label-row"><Label htmlFor="overview-summary">Operational summary</Label><span>Optional</span></div>
              <Textarea id="overview-summary" rows={4} placeholder="What should the next operator know?" />
            </div>
          </div>
        </section>

        <section className="bakin-primitive-story__section" aria-labelledby="field-states-heading">
          <header><h2 id="field-states-heading">State language</h2><p>Read-only is legible, disabled is unavailable, and invalid points to a specific recovery message.</p></header>
          <div className="bakin-primitive-story__form-grid">
            <div className="bakin-primitive-story__field"><Label htmlFor="overview-readonly">Generated identifier</Label><Input id="overview-readonly" value="workflow_01JZ7A7RCM8S9P2B8H4VR4MVGQ" readOnly /></div>
            <div className="bakin-primitive-story__field"><Label htmlFor="overview-disabled">Managed source</Label><Input id="overview-disabled" value="Core catalog" disabled /></div>
            <div className="bakin-primitive-story__field"><Label htmlFor="overview-invalid">Webhook URL</Label><Input id="overview-invalid" defaultValue="not-a-url" aria-invalid="true" aria-describedby="overview-invalid-error" /><p className="bakin-primitive-story__error" id="overview-invalid-error">Enter a complete HTTPS URL.</p></div>
          </div>
        </section>

        <section className="bakin-primitive-story__section" aria-labelledby="field-group-heading">
          <header><h2 id="field-group-heading">Composed control</h2><p>InputGroup joins non-editable context and a local action without nesting controls inside the text input.</p></header>
          <div className="bakin-primitive-story__field">
            <Label htmlFor="overview-repository">Repository path</Label>
            <InputGroup aria-label="Repository address">
              <InputGroupAddon><InputGroupText>github.com/</InputGroupText></InputGroupAddon>
              <InputGroupInput id="overview-repository" defaultValue="makinbakin/plugin-example" />
              <InputGroupAddon align="inline-end"><InputGroupButton>Copy</InputGroupButton></InputGroupAddon>
            </InputGroup>
          </div>
        </section>
      </main>
    )
  },
} satisfies Story
