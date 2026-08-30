import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Field,
  FieldError,
  FieldLabel,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@makinbakin/sdk/ui'
import { Grid } from '@makinbakin/sdk/layout'
import { expect, waitFor, within } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/Select',
  component: Select,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Select for one choice from a bounded, known list. Group labels describe option sets; the field still needs its own visible label. Long options wrap within the viewport, and an empty-value item is an explicit none choice rather than a missing label.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'validation', 'overflow'],
  },
} satisfies Meta<typeof Select>

export default meta
type Story = StoryObj<typeof meta>

interface SelectCanonicalArgs {
  /** Trigger density: `default` control height or the compact `sm`. */
  size: 'default' | 'sm'
  /** Disable the whole select. */
  disabled: boolean
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    size: 'default',
    disabled: false,
  },
  // `size` styles SelectTrigger, not the Select root, so docgen cannot infer it.
  argTypes: {
    size: { control: 'select', options: ['default', 'sm'] },
    disabled: { control: 'boolean' },
  },
  // Width frame: the centered (shrink-to-fit) canvas collapses the full-width
  // trigger to min-content. In the app selects sit in field layouts with
  // inherited width.
  render: (args: SelectCanonicalArgs) => (
    <div style={{ inlineSize: '20rem', maxInlineSize: '100%' }}>
      <Field>
        <FieldLabel>Execution runtime</FieldLabel>
        <Select items={{ pi: 'Pi', openclaw: 'OpenClaw' }} defaultValue="openclaw" disabled={args.disabled}>
          <SelectTrigger size={args.size} style={{ width: '100%' }}>
            <SelectValue placeholder="Choose a runtime" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pi">Pi</SelectItem>
            <SelectItem value="openclaw">OpenClaw</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  ),
  play: async ({ canvas, userEvent, args }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Execution runtime' })
    await expect(trigger).toHaveTextContent('OpenClaw')
    await expect(trigger).toHaveAttribute('data-size', args.size)
    if (args.disabled) {
      await expect(trigger.matches('[disabled], [data-disabled]')).toBe(true)
      return
    }
    await userEvent.click(trigger)
    const page = within(document.body)
    const option = await page.findByRole('option', { name: 'Pi' })
    await userEvent.click(option)
    await waitFor(() => expect(trigger).toHaveTextContent('Pi'))
    // The popup exits with a transition; the post-play axe scan must not
    // race its focus guards (aria-hidden + tabindex) — wait for unmount.
    await waitFor(() => {
      expect(document.querySelector('[data-base-ui-focus-guard]')).toBeNull()
    })
  },
} satisfies StoryObj<SelectCanonicalArgs>

function RuntimeSelect({ disabled = false, invalid = false, compact = false }: { disabled?: boolean; invalid?: boolean; compact?: boolean }) {
  const label = disabled ? 'Managed runtime' : invalid ? 'Required runtime' : compact ? 'Dense-row runtime' : 'Execution runtime'
  return (
    <Field disabled={disabled} invalid={invalid}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        items={{ '': 'No runtime', pi: 'Pi', openclaw: 'OpenClaw', managed: 'Managed production runtime with an intentionally long descriptive option that wraps safely', unavailable: 'Unavailable runtime' }}
        defaultValue={disabled ? 'managed' : invalid ? null : 'openclaw'}
        disabled={disabled}
        required={invalid}
      >
        <SelectTrigger aria-invalid={invalid || undefined} size={compact ? 'sm' : 'default'} style={{ width: '100%' }}>
          <SelectValue placeholder="Choose a runtime" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">No runtime</SelectItem>
          <SelectGroup><SelectLabel>Local</SelectLabel><SelectItem value="pi">Pi</SelectItem><SelectItem value="openclaw">OpenClaw</SelectItem></SelectGroup>
          <SelectSeparator />
          <SelectGroup><SelectLabel>Managed</SelectLabel><SelectItem value="managed">Managed production runtime with an intentionally long descriptive option that wraps safely</SelectItem><SelectItem value="unavailable" disabled>Unavailable runtime</SelectItem></SelectGroup>
        </SelectContent>
      </Select>
      {invalid && <FieldError match>Choose a runtime before continuing.</FieldError>}
    </Field>
  )
}

export const States = {
  render: () => (
    <StoryStage
      eyebrow="Bounded choice"
      title="Select"
      description="Trigger and option states stay readable under long content and narrow containers."
    >
      <StorySection title="Canonical states">
        <Grid layout="split" gap="section">
          <RuntimeSelect />
          <RuntimeSelect compact />
          <RuntimeSelect invalid />
          <RuntimeSelect disabled />
        </Grid>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => <RuntimeSelect />,
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
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
