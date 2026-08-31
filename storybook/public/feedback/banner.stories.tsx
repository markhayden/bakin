import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { Banner, Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Feedback/Banner',
  component: Banner,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Banner carries persistent page- or section-level context that stays with the affected surface — maintenance windows, paused dispatch, connection problems — until the underlying condition changes. Tone is semantic and always paired with visible language and a leading signal, never color alone. Announcements are opt-in via `announce` because severity and urgency are different concerns; a banner that appears mid-session can announce politely or assertively, while one rendered with the page stays silent.',
      },
    },
    bakinCoverage: ['desktop', 'non-color'],
  },
} satisfies Meta<typeof Banner>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    tone: 'success',
    title: 'Runtime reconnected',
    description: 'Queued workflows will resume automatically.',
    announce: 'polite',
  },
  argTypes: {
    tone: { control: 'select', options: ['info', 'success', 'attention', 'danger'] },
    announce: { control: 'select', options: ['off', 'polite', 'assertive'] },
    title: { control: 'text' },
    description: { control: 'text' },
    headingLevel: { control: 'select', options: [2, 3, 4] },
    // Recovery actions are composed elements, not knobs.
    action: { control: false },
  },
  // Width frame: Banner's container-type zeroes its intrinsic width, so the
  // centered (shrink-to-fit) canvas would collapse it. In the app it sits in
  // block flow where width is inherited; the frame reproduces that.
  render: (args) => (
    <div style={{ inlineSize: '40rem', maxInlineSize: '100%' }}>
      <Banner {...args} />
    </div>
  ),
  play: async ({ canvas, args }) => {
    const banner = args.announce === 'off'
      ? canvas.getByText(String(args.title)).closest('[data-slot="banner"]')! as HTMLElement
      : canvas.getByRole(args.announce === 'assertive' ? 'alert' : 'status', { name: String(args.title) })
    await expect(banner).toBeVisible()
    if (args.announce !== 'off') await expect(banner).toHaveAttribute('aria-live', args.announce)
    await expect(banner).toHaveAttribute('data-tone', args.tone ?? 'info')
    // The width frame must hold: a collapsed banner renders the copy column
    // at min-content (~46px total observed) — assert real prose width.
    await expect(banner.getBoundingClientRect().width).toBeGreaterThan(300)
    const title = banner.querySelector<HTMLElement>('[data-slot="banner-title"]')
    await expect(title).toBeTruthy()
    await expect(title!.getBoundingClientRect().width).toBeGreaterThan(120)
  },
} satisfies Story

export const TonesAndActions = {
  render: () => (
    <StoryStage
      eyebrow="Feedback / persistent context"
      title="Context that stays with the surface"
      description="Banners stay with the affected surface until the condition changes. Recovery actions live inside the banner, next to the language that explains them."
    >
      <StorySection title="Tones" description="Every tone leads with a signal and visible language; urgency is opt-in, not inferred from color.">
        <Banner
          headingLevel={3}
          tone="info"
          title="Scheduled maintenance"
          description="New runs remain available during the provider update."
        />
        <Banner
          headingLevel={3}
          tone="success"
          title="Runtime reconnected"
          description="Queued workflows will resume automatically."
          announce="polite"
        />
        <Banner
          headingLevel={3}
          tone="attention"
          title="Dispatch is paused"
          description="Queued work remains visible until an operator resumes dispatch."
          action={<Button variant="outline">Resume</Button>}
        />
        <Banner
          headingLevel={3}
          tone="danger"
          title="Connection needs attention"
          description="Reconnect before starting more work."
          action={<Button variant="outline">Open runtime</Button>}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'Runtime reconnected' })).toHaveAttribute('aria-live', 'polite')
    const paused = canvas.getByText('Dispatch is paused').closest('[data-slot="banner"]')
    await expect(paused).toHaveAttribute('data-tone', 'attention')
    await expect(paused).not.toHaveAttribute('role')
    await expect(canvas.getByRole('button', { name: 'Resume' })).toBeVisible()
  },
} satisfies Story
