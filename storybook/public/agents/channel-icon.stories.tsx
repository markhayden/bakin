import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChannelIcon } from '@makinbakin/sdk/patterns'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const channels = [
  { id: 'email', icon: 'Mail' },
  { id: 'discord', icon: 'MessageSquare' },
  { id: 'instagram', icon: 'Instagram' },
  { id: 'youtube', icon: 'Youtube' },
  { id: 'tiktok', icon: 'Music2' },
  { id: 'x', icon: 'Twitter' },
]

const meta = {
  title: 'Agents/ChannelIcon',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ChannelIcon renders the glyph for a notification channel (email, Discord, Instagram, …) resolved from the workflows channel registry. Pass `channels` when you already hold the definitions (or in tests); omit it to resolve from the live registry. The icon is decorative — always pair it with the channel\'s visible label. Unknown channels render an honest generic glyph, never a broken image.',
      },
    },
    bakinCoverage: ['desktop', 'non-color', 'empty'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <ChannelIcon channelId="email" channels={[{ id: 'email', icon: 'Mail' }]} />
      Email
    </span>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Email')).toBeVisible()
    const icon = canvasElement.querySelector('[data-channel-icon="email"]')
    await expect(icon).not.toBeNull()
    await expect(icon!).toHaveAttribute('aria-hidden', 'true')
  },
} satisfies Story

export const KnownAndUnknownChannels = {
  render: () => (
    <StoryStage
      eyebrow="Channel identity"
      title="ChannelIcon"
      description="One glyph per registry channel, always beside its label. Channels outside the known set fall back to the generic glyph."
    >
      <StorySection title="Registry channels">
        <StoryCluster>
          {channels.map((channel) => (
            <span key={channel.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <ChannelIcon channelId={channel.id} channels={channels} />
              {channel.id}
            </span>
          ))}
        </StoryCluster>
      </StorySection>
      <StorySection
        title="Unknown channel"
        description="A third-party channel with an unmapped icon renders the generic glyph — labeled, never empty."
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <ChannelIcon channelId="carrier-pigeon" channels={channels} />
          carrier-pigeon
        </span>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('discord')).toBeVisible()
    await expect(canvasElement.querySelectorAll('[data-channel-icon]').length).toBe(7)
    // The unknown channel still renders a glyph (the generic fallback).
    const fallback = canvasElement.querySelector('[data-channel-icon="carrier-pigeon"]')
    await expect(fallback).not.toBeNull()
    await expect(fallback!.querySelector('circle')).not.toBeNull()
  },
} satisfies Story
