import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn } from 'storybook/test'

import { CalendarItem } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Lists/CalendarItem',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CalendarItem is the one interactive calendar entry — job occurrences, plugin domain events, recurring-series rollups — shared by every calendar surface so tone, density, and past-state treatment stay identical across views. The item owns its whole-surface button affordance and text hierarchy: a truncating title, a mono time label, an optional detail line (one line compact, three expanded), and an expanded-only mono meta line. Consumers own the slots — `leading` identity (avatar, kind icon), the `marker` beside the time (disposition dot, attention icon; give markers screen-reader text, never a bare `title` attribute) — and the cell layout it sits in: the item never carries its own margins, so the surrounding calendar cell owns rhythm. `accent`/`danger` tint the surface and time for domain events and deadlines; `attention` is reserved for entries that need a human look; `past` de-emphasizes an elapsed entry by dropping the title to muted and dimming the identity slot — text never fades below contrast compliance. It forwards its ref and button props, so it composes as a popover or menu trigger via `render`.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'interaction', 'long-labels', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface CalendarItemCanonicalArgs {
  /** `accent`/`danger` tint domain events and deadlines; `attention` flags entries needing a human look. */
  tone: 'neutral' | 'accent' | 'danger' | 'attention'
  /** `compact` for dense grid cells, `expanded` for agenda timelines. */
  density: 'compact' | 'expanded'
  /** De-emphasizes an entry whose instant has already passed. */
  past: boolean
  onClick: () => void
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    tone: 'neutral',
    density: 'compact',
    past: false,
    onClick: fn(),
  },
  // No meta `component` (required `title` prop breaks render-only stories),
  // so the knobs declare themselves.
  argTypes: {
    tone: { control: 'select', options: ['neutral', 'accent', 'danger', 'attention'] },
    density: { control: 'select', options: ['compact', 'expanded'] },
    past: { control: 'boolean' },
  },
  // Width frame: the item fills its container (calendar cells own width); the
  // centered canvas needs a definite inline size or it collapses.
  render: (args: CalendarItemCanonicalArgs) => (
    <div style={{ inlineSize: '18rem', maxInlineSize: '100%' }}>
      <CalendarItem
        tone={args.tone}
        density={args.density}
        past={args.past}
        onClick={args.onClick}
        title="Hourly inbox sync"
        time="9:30am"
        detail="Summarize unread mail into the morning brief"
      />
    </div>
  ),
  play: async ({ canvas, userEvent, args }) => {
    const item = canvas.getByRole('button', { name: /Hourly inbox sync/ })
    await expect(item).toHaveAttribute('data-tone', args.tone)
    await expect(item).toHaveAttribute('data-density', args.density)
    await userEvent.click(item)
    await expect(args.onClick).toHaveBeenCalled()
  },
} satisfies StoryObj<CalendarItemCanonicalArgs>

function Avatar() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        inlineSize: 'var(--bakin-layout-space-6)',
        blockSize: 'var(--bakin-layout-space-6)',
        borderRadius: 'var(--bakin-radius-pill)',
        background: 'var(--bakin-color-surface-default)',
        border: '1px solid var(--bakin-color-border-subtle)',
        fontSize: 'var(--bakin-typography-size-meta)',
        color: 'var(--bakin-color-text-muted)',
      }}
    >
      A
    </span>
  )
}

function DispositionDot({ fired }: { fired: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        inlineSize: 'var(--bakin-layout-space-2)',
        blockSize: 'var(--bakin-layout-space-2)',
        borderRadius: 'var(--bakin-radius-pill)',
        background: fired
          ? 'var(--bakin-color-action-primary-background)'
          : 'var(--bakin-color-signal-highlight)',
      }}
    >
      <span className="sr-only">{fired ? 'Fired' : 'Skipped'}</span>
    </span>
  )
}

export const TonesAndDensities = {
  render: () => (
    <StoryStage
      eyebrow="Lists / calendar entries"
      title="One entry treatment across every calendar surface"
      description="Neutral entries are job occurrences; accent and danger tint plugin domain events and deadlines; attention is reserved for entries needing a human look. Compact suits dense grid cells, expanded suits agenda timelines; past de-emphasizes elapsed entries."
    >
      <StorySection
        title="Tones — compact"
        description="The marker slot carries consumer status (disposition dots, attention icons) with screen-reader text."
      >
        <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-1)', maxInlineSize: '20rem' }}>
          <CalendarItem
            title="Hourly inbox sync"
            time="9:30am"
            leading={<Avatar />}
            marker={<DispositionDot fired />}
          />
          <CalendarItem tone="accent" title="Launch post publishes" time="11am" />
          <CalendarItem tone="danger" title="Invoice run due" time="5pm" />
          <CalendarItem
            tone="attention"
            title="Hourly inbox sync"
            detail="0 done · 23 skipped"
            leading={<Avatar />}
          />
        </div>
      </StorySection>
      <StorySection
        title="Expanded and past"
        description="Expanded entries show a three-line detail clamp and a mono meta line; past entries drop to muted text with a dimmed identity slot — never a contrast-breaking surface fade. Long titles truncate."
      >
        <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)', maxInlineSize: '24rem' }}>
          <CalendarItem
            density="expanded"
            title="Weekly retrospective digest across every active workstream"
            time="4:15pm"
            detail="Collect the week's shipped work, open risks, and blocked reviews into one digest for Monday planning."
            meta="Every Friday at 4:15pm"
            leading={<Avatar />}
          />
          <CalendarItem
            past
            title="Morning brief"
            time="7am"
            detail="Yesterday's occurrence"
            leading={<Avatar />}
            marker={<DispositionDot fired={false} />}
          />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const attention = canvas.getByRole('button', { name: /0 done · 23 skipped/ })
    await expect(attention).toHaveAttribute('data-tone', 'attention')
    const past = canvas.getByRole('button', { name: /Morning brief/ })
    await expect(past).toHaveAttribute('data-past')
    // Marker status is real text for screen readers, never a title tooltip.
    await expect(past).toHaveTextContent('Skipped')
    const expanded = canvas.getByRole('button', { name: /Weekly retrospective digest/ })
    await expect(expanded).toHaveAttribute('data-density', 'expanded')
    await expect(expanded).toHaveTextContent('Every Friday at 4:15pm')
  },
} satisfies Story
