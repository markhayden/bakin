import type { Meta, StoryObj } from '@storybook/react-vite'
import { Input, Label } from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Input',
  component: Input,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Input is the low-level single-line text control. Preserve native type, inputMode, autoComplete, required, readOnly, disabled, and aria-invalid attributes. Prefer the SDK field pattern for routine form composition; a raw native input is reserved for documented domain-interface exceptions.' } },
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const StatesAndMobileModes = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Single-line entry</p><h1>Input</h1><p>State is semantic first and visual second; mobile modes ask for the appropriate virtual keyboard.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="input-states-heading">
        <header><h2 id="input-states-heading">States</h2></header>
        <div className="bakin-primitive-story__form-grid">
          <div className="bakin-primitive-story__field"><Label htmlFor="input-default">Default</Label><Input id="input-default" placeholder="Workflow name" /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="input-required">Required email</Label><Input id="input-required" type="email" inputMode="email" autoComplete="email" required defaultValue="owner@example.com" /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="input-number">Numeric mobile mode</Label><Input id="input-number" type="text" inputMode="numeric" autoComplete="one-time-code" defaultValue="482901" /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="input-readonly">Read-only identifier</Label><Input id="input-readonly" readOnly value="plugin://research/collector/production" /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="input-disabled">Disabled source</Label><Input id="input-disabled" disabled value="Managed by core" /></div>
          <div className="bakin-primitive-story__field"><Label htmlFor="input-invalid">Invalid URL</Label><Input id="input-invalid" type="url" inputMode="url" value="internal-host" aria-invalid="true" aria-describedby="input-invalid-error" readOnly /><p className="bakin-primitive-story__error" id="input-invalid-error">Enter a complete HTTPS URL.</p></div>
        </div>
      </section>
      <section className="bakin-primitive-story__section" aria-labelledby="input-long-heading">
        <header><h2 id="input-long-heading">Long value pressure</h2><p>The control stays inside a narrow container while the native text viewport scrolls.</p></header>
        <div className="bakin-primitive-story__narrow"><Label htmlFor="input-long">Artifact reference</Label><Input id="input-long" readOnly value="artifact://production/catalog/extraordinarily-long-generated-identifier-01JZ7A7RCM8S9P2B8H4VR4MVGQ" /></div>
      </section>
    </main>
  ),
} satisfies Story
