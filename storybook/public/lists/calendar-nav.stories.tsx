import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'

import { CalendarNav } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Lists/CalendarNav',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CalendarNav is the range navigation cluster for calendar surfaces: previous/next chevrons around the current range label, plus the optional Today jump. One geometry serves every zoom level — the label box holds a shared minimum width with tabular numerals, so the chevrons never shift as the label changes with navigation. Consumers own the range state and the label copy; the kit owns sizing, spacing, and the accessible-name contract (`navLabel` for the cluster, `previousLabel`/`nextLabel` for the chevrons).',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'interaction'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface CalendarNavCanonicalArgs {
  /** Current range identity shown between the chevrons. */
  label: string
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    label: 'August 2026',
    onPrevious: fn(),
    onNext: fn(),
    onToday: fn(),
  },
  // No meta `component` (required handler props break render-only stories),
  // so the knobs declare themselves.
  argTypes: {
    label: { control: 'text' },
  },
  render: (args: CalendarNavCanonicalArgs) => (
    <CalendarNav
      label={args.label}
      navLabel="Month navigation"
      previousLabel="Previous month"
      nextLabel="Next month"
      onPrevious={args.onPrevious}
      onNext={args.onNext}
      onToday={args.onToday}
    />
  ),
  play: async ({ canvas, userEvent, args }) => {
    const nav = canvas.getByRole('group', { name: 'Month navigation' })
    await expect(nav).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Previous month' }))
    await expect(args.onPrevious).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Next month' }))
    await expect(args.onNext).toHaveBeenCalled()
    await userEvent.click(canvas.getByRole('button', { name: 'Today' }))
    await expect(args.onToday).toHaveBeenCalled()
  },
} satisfies StoryObj<CalendarNavCanonicalArgs>

export const RangeShapes = {
  render: () => (
    <StoryStage
      eyebrow="Lists / calendar navigation"
      title="One geometry for every zoom level"
      description="Week, month, and label-only ranges share the same chevron sizing and label box, so switching views never moves the controls."
    >
      <StorySection title="Week range">
        <CalendarNav
          label="Aug 9 — Aug 15, 2026"
          navLabel="Week navigation"
          previousLabel="Previous week"
          nextLabel="Next week"
          onPrevious={() => {}}
          onNext={() => {}}
          onToday={() => {}}
        />
      </StorySection>
      <StorySection title="Month range" description="Without `onToday`, the jump is omitted.">
        <CalendarNav
          label="August 2026"
          navLabel="Month navigation"
          previousLabel="Previous month"
          nextLabel="Next month"
          onPrevious={() => {}}
          onNext={() => {}}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Week navigation' })).toBeVisible()
    const month = canvas.getByRole('group', { name: 'Month navigation' })
    await expect(month).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Today' })).toHaveLength(1)
  },
} satisfies Story
