import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Label, Switch } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Switch',
  component: Switch,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Switch for a binary setting that takes effect immediately. Use Checkbox instead for acknowledgements, multi-selection, or choices submitted together by a later action.' } },
  },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

function SwitchBehavior() {
  const [enabled, setEnabled] = useState(false)
  return (
    <main className="bakin-primitive-story">
      <div className="bakin-primitive-story__selection-row"><Switch id="switch-behavior" checked={enabled} onCheckedChange={setEnabled} /><div><Label htmlFor="switch-behavior">Automatic retry</Label><p role="status">{enabled ? 'Enabled' : 'Disabled'}</p></div></div>
    </main>
  )
}

export const States = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Immediate setting</p><h1>Switch</h1><p>Both sizes preserve the same 24px minimum target. The compact size uses a slimmer visual track while keeping clear on/off contrast.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="switch-states-heading">
        <header><h2 id="switch-states-heading">Canonical states</h2></header>
        <div className="bakin-primitive-story__selection-stack">
          <div className="bakin-primitive-story__selection-row"><Switch id="switch-off" /><Label htmlFor="switch-off">Off</Label></div>
          <div className="bakin-primitive-story__selection-row"><Switch id="switch-on" defaultChecked /><Label htmlFor="switch-on">On</Label></div>
          <div className="bakin-primitive-story__selection-row"><Switch id="switch-small-off" size="sm" /><Label htmlFor="switch-small-off">Compact off</Label></div>
          <div className="bakin-primitive-story__selection-row"><Switch id="switch-small" size="sm" defaultChecked /><Label htmlFor="switch-small">Compact operational setting</Label></div>
          <div className="bakin-primitive-story__selection-row"><Switch id="switch-invalid" aria-invalid="true" /><div><Label htmlFor="switch-invalid">Invalid setting</Label><p className="bakin-primitive-story__error">Resolve the policy conflict.</p></div></div>
          <div className="bakin-primitive-story__selection-row"><Switch id="switch-disabled" disabled /><Label htmlFor="switch-disabled">Disabled organization-managed setting with a long wrapping label</Label></div>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Behavior = {
  render: () => <SwitchBehavior />,
  play: async ({ canvas, userEvent }) => {
    const control = canvas.getByRole('switch', { name: 'Automatic retry' })
    await userEvent.tab()
    await expect(control).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(control).toBeChecked()
    await expect(canvas.getByRole('status')).toHaveTextContent('Enabled')
  },
} satisfies Story
