import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { Banner, Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Feedback/Banner',
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
  render: () => (
    <Banner
      tone="success"
      title="Runtime reconnected"
      description="Queued workflows will resume automatically."
      announce="polite"
    />
  ),
  play: async ({ canvas }) => {
    const banner = canvas.getByRole('status', { name: 'Runtime reconnected' })
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('aria-live', 'polite')
    await expect(banner).toHaveAttribute('data-tone', 'success')
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
