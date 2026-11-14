import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn } from 'storybook/test'

import { FirstVisitCallout } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

/** A stand-in picture with its subject on the left, the way area illustrations are composed. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#111"/><circle cx="90" cy="96" r="52" fill="#f0368c"/><circle cx="72" cy="88" r="7" fill="#2a1420"/><circle cx="108" cy="88" r="7" fill="#2a1420"/><path d="M72 112c12 12 24 12 36 0" stroke="#2a1420" stroke-width="6" fill="none" stroke-linecap="round"/></svg>')}`

const meta = {
  title: 'Components/Feedback/FirstVisitCallout',
  component: FirstVisitCallout,
  args: {
    title: 'Meet your new coworkers.',
    children: 'Chat is where you work with your agents. Pick one and ask for anything; every conversation is kept.',
    illustration: PICTURE,
    onDismiss: fn(),
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'FirstVisitCallout is the welcome a place gives the first time someone arrives: an eyebrow, a headline, a line or two, an optional picture, and a way to close it. It is onboarding, not feedback — nothing is wrong and nothing needs doing — so it carries no status tone and no action beyond closing; use Alert or Banner when something needs attention. It is presentational: the owner decides where it sits and remembers that it was closed. Float it at the bottom middle of the content it introduces (see FloatingLayer), clear of the controls pages keep in their corners, and never over a dialog.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'interaction', 'keyboard'],
  },
} satisfies Meta<typeof FirstVisitCallout>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    eyebrow: { control: 'text' },
    title: { control: 'text' },
    children: { control: 'text' },
    illustration: { control: 'text' },
    dismissLabel: { control: 'text' },
    headingLevel: { control: 'select', options: [2, 3, 4] },
  },
  // Width frame: in the app the callout takes the width its layer gives it.
  render: (args) => (
    <div style={{ inlineSize: '42rem', maxInlineSize: '100%' }}>
      <FirstVisitCallout {...args} />
    </div>
  ),
  play: async ({ canvas, args, userEvent }) => {
    const callout = canvas.getByRole('complementary', { name: String(args.title) })
    await expect(callout).toBeVisible()
    await expect(canvas.getByRole('heading', { name: String(args.title) })).toBeVisible()
    await expect(canvas.getByText('First time here')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }))
    await expect(args.onDismiss).toHaveBeenCalledTimes(1)
  },
} satisfies Story

export const WithoutIllustration = {
  parameters: { layout: 'centered' },
  args: { illustration: undefined, title: 'Bakin keeps an eye on itself.', children: 'If something needs attention it shows up here in plain words, usually with a fix. Quiet means all is well.' },
  render: (args) => (
    <div style={{ inlineSize: '42rem', maxInlineSize: '100%' }}>
      <FirstVisitCallout {...args} />
    </div>
  ),
} satisfies Story

function FloatingExample() {
  const [open, setOpen] = useState(true)
  return (
    <StoryStage
      eyebrow="Placement"
      title="Floating over the content it introduces"
      description="The owner places it: bottom middle of the content area, in a layer that lets clicks through to the page. Closing is the owner's to remember."
    >
      <StorySection title="A page with its welcome">
        <div style={{ position: 'relative', blockSize: '24rem', border: '1px solid var(--bakin-color-border-subtle)', borderRadius: 'var(--bakin-radius-surface)', overflow: 'hidden' }}>
          <div style={{ padding: 'var(--bakin-layout-space-6)' }}>
            <Button variant="outline" onClick={() => setOpen(true)}>Show the welcome again</Button>
          </div>
          {open ? (
            <div style={{ position: 'absolute', insetInline: 0, insetBlockEnd: 0, display: 'flex', justifyContent: 'center', padding: 'var(--bakin-layout-space-4)', pointerEvents: 'none' }}>
              <FirstVisitCallout
                title="This is where the work lives."
                illustration={PICTURE}
                onDismiss={() => setOpen(false)}
                style={{ pointerEvents: 'auto', inlineSize: '100%', maxInlineSize: '42rem' }}
              >
                Agents pick tasks up, move them across the board, and hand them back when they need you.
              </FirstVisitCallout>
            </div>
          ) : null}
        </div>
      </StorySection>
    </StoryStage>
  )
}

export const FloatingLayer = {
  render: () => <FloatingExample />,
  play: async ({ canvas, userEvent }) => {
    const callout = canvas.getByRole('complementary', { name: 'This is where the work lives.' })
    await expect(callout).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }))
    await expect(canvas.queryByRole('complementary')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Show the welcome again' }))
    await expect(canvas.getByRole('complementary')).toBeVisible()
    // The card never makes the page scroll sideways.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story
