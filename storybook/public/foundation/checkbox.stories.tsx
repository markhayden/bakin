import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox, Label } from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Checkbox',
  component: Checkbox,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Checkbox for an independent yes/no choice or each item in a multi-selection. Mixed means a parent represents partially selected children; it is not a third persisted value.' } },
  },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const States = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Independent choice</p><h1>Checkbox</h1><p>Visible labels, real form state, and a minimum 24px interactive target.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="checkbox-states-heading">
        <header><h2 id="checkbox-states-heading">Canonical states</h2></header>
        <div className="bakin-primitive-story__selection-stack">
          <div className="bakin-primitive-story__selection-row"><Checkbox id="checkbox-unchecked" /><Label htmlFor="checkbox-unchecked">Unchecked</Label></div>
          <div className="bakin-primitive-story__selection-row"><Checkbox id="checkbox-checked" defaultChecked /><Label htmlFor="checkbox-checked">Checked</Label></div>
          <div className="bakin-primitive-story__selection-row"><Checkbox id="checkbox-mixed" indeterminate /><Label htmlFor="checkbox-mixed">Partially selected</Label></div>
          <div className="bakin-primitive-story__selection-row"><Checkbox id="checkbox-required" required aria-invalid="true" /><div><Label htmlFor="checkbox-required">Required acknowledgement</Label><p className="bakin-primitive-story__error">Review and acknowledge the change.</p></div></div>
          <div className="bakin-primitive-story__selection-row"><Checkbox id="checkbox-disabled" disabled /><Label htmlFor="checkbox-disabled">Disabled choice with a label long enough to wrap at 200% text zoom</Label></div>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const Behavior = {
  render: () => (
    <main className="bakin-primitive-story">
      <div className="bakin-primitive-story__selection-row"><Checkbox id="checkbox-behavior" /><Label htmlFor="checkbox-behavior">Include archived tasks</Label></div>
      <Checkbox aria-label="Partially selected workspaces" indeterminate />
    </main>
  ),
  play: async ({ canvas, userEvent }) => {
    const checkbox = canvas.getByRole('checkbox', { name: 'Include archived tasks' })
    await userEvent.tab()
    await expect(checkbox).toHaveFocus()
    await userEvent.keyboard(' ')
    await expect(checkbox).toBeChecked()
    await expect(canvas.getByRole('checkbox', { name: 'Partially selected workspaces' })).toHaveAttribute('aria-checked', 'mixed')
  },
} satisfies Story
