import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Select',
  component: Select,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Select for one choice from a bounded, known list. Group labels describe option sets; the field still needs its own visible label. Long options wrap within the viewport, and an empty-value item is an explicit none choice rather than a missing label.' } },
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

function RuntimeSelect({ disabled = false, invalid = false, compact = false }: { disabled?: boolean; invalid?: boolean; compact?: boolean }) {
  const labelId = `select-${disabled ? 'disabled' : invalid ? 'invalid' : compact ? 'compact' : 'default'}-label`
  return (
    <div className="bakin-primitive-story__field">
      <Label id={labelId}>{disabled ? 'Managed runtime' : invalid ? 'Required runtime' : compact ? 'Dense-row runtime' : 'Execution runtime'}</Label>
      <Select
        items={{ '': 'No runtime', pi: 'Pi', openclaw: 'OpenClaw', managed: 'Managed production runtime with an intentionally long descriptive option that wraps safely', unavailable: 'Unavailable runtime' }}
        defaultValue={disabled ? 'managed' : invalid ? null : 'openclaw'}
        disabled={disabled}
        required={invalid}
      >
        <SelectTrigger aria-labelledby={labelId} aria-invalid={invalid || undefined} size={compact ? 'sm' : 'default'} className="bakin-primitive-story__selection-trigger">
          <SelectValue placeholder="Choose a runtime" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">No runtime</SelectItem>
          <SelectGroup><SelectLabel>Local</SelectLabel><SelectItem value="pi">Pi</SelectItem><SelectItem value="openclaw">OpenClaw</SelectItem></SelectGroup>
          <SelectSeparator />
          <SelectGroup><SelectLabel>Managed</SelectLabel><SelectItem value="managed">Managed production runtime with an intentionally long descriptive option that wraps safely</SelectItem><SelectItem value="unavailable" disabled>Unavailable runtime</SelectItem></SelectGroup>
        </SelectContent>
      </Select>
      {invalid && <p className="bakin-primitive-story__error">Choose a runtime before continuing.</p>}
    </div>
  )
}

export const States = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro"><p className="bakin-primitive-story__eyebrow">Bounded choice</p><h1>Select</h1><p>Trigger and option states stay readable under long content and narrow containers.</p></header>
      <section className="bakin-primitive-story__section" aria-labelledby="select-states-heading">
        <header><h2 id="select-states-heading">Canonical states</h2></header>
        <div className="bakin-primitive-story__form-grid"><RuntimeSelect /><RuntimeSelect compact /><RuntimeSelect invalid /><RuntimeSelect disabled /></div>
      </section>
    </main>
  ),
} satisfies Story

export const Behavior = {
  render: () => <main className="bakin-primitive-story"><RuntimeSelect /></main>,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Execution runtime' })
    await userEvent.tab()
    await expect(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('listbox')).toBeVisible())
    await expect(page.getByRole('group', { name: 'Local' })).toBeVisible()
    await userEvent.keyboard('{Home}{ArrowDown}{Enter}')
    await expect(trigger).toHaveTextContent('Pi')
    await expect(trigger).toHaveFocus()
  },
} satisfies Story
