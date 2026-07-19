import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
  Label,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/InputGroup',
  component: InputGroup,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'InputGroup composes one editable control with contextual text or local actions. The editable control still needs its own accessible label. Do not use adornments as a replacement for field descriptions.' } },
  },
} satisfies Meta<typeof InputGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Adornments = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Composed entry</p><h1>InputGroup</h1><p>Inline and block adornments share one focus boundary while preserving native control semantics.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="group-inline-heading">
        <header><h2 id="group-inline-heading">Inline context and action</h2></header>
        <div className="bakin-primitive-story__field">
          <Label htmlFor="group-path">Repository path</Label>
          <InputGroup aria-label="Repository address">
            <InputGroupAddon><InputGroupText>github.com/</InputGroupText></InputGroupAddon>
            <InputGroupInput id="group-path" defaultValue="makinbakin/reference-plugin" />
            <InputGroupAddon align="inline-end"><InputGroupButton>Copy</InputGroupButton></InputGroupAddon>
          </InputGroup>
        </div>
      </section>
      <section className="bakin-primitive-story__section" aria-labelledby="group-block-heading">
        <header><h2 id="group-block-heading">Multiline context</h2><p>The invalid control drives the group border; the associated message explains recovery.</p></header>
        <div className="bakin-primitive-story__field">
          <Label htmlFor="group-prompt">Execution prompt</Label>
          <InputGroup aria-label="Execution prompt editor">
            <InputGroupAddon align="block-start"><InputGroupText>Prompt template</InputGroupText></InputGroupAddon>
            <InputGroupTextarea id="group-prompt" rows={5} aria-invalid="true" aria-describedby="group-prompt-error" defaultValue="Summarize {{missing_input}} for the launch owner." />
            <InputGroupAddon align="block-end"><InputGroupText>Markdown supported</InputGroupText><InputGroupButton>Insert variable</InputGroupButton></InputGroupAddon>
          </InputGroup>
          <p className="bakin-primitive-story__error" id="group-prompt-error">Replace the unknown variable before saving.</p>
        </div>
      </section>
    </main>
  ),
} satisfies Story
