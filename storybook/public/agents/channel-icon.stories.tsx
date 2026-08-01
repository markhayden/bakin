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
        component: 'ChannelIcon renders the glyph for a notification channel (email, Discord, Instagram, …) resolved from the workflows channel registry. Pass `channels` when you already hold the definitions (or in tests); omit it to resolve from the live registry. The icon is decorative — always pair it with the channel\'s visible label, and size it to its context: `sm` (12px) beside meta text, `md` (16px, default) beside body text, `lg` (24px) standalone or in legends. Unknown channels render an honest generic glyph, never a broken image.',
      },
    },
    bakinCoverage: ['desktop', 'non-color', 'empty'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface ChannelIconCanonicalArgs {
  /** Contextual size: `sm` beside meta text, `md` beside body text, `lg` standalone. */
  size: 'sm' | 'md' | 'lg'
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    size: 'md',
  },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
  },
  render: (args: ChannelIconCanonicalArgs) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <ChannelIcon channelId="email" size={args.size} channels={[{ id: 'email', icon: 'Mail' }]} />
      Email
    </span>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Email')).toBeVisible()
    const icon = canvasElement.querySelector('[data-channel-icon="email"]')
    await expect(icon).not.toBeNull()
    await expect(icon!).toHaveAttribute('aria-hidden', 'true')
  },
} satisfies StoryObj<ChannelIconCanonicalArgs>

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

export const Sizes = {
  render: () => (
    <StoryStage
      eyebrow="Channel identity"
      title="Size to the context"
      description="sm rides beside meta text, md is the body-text default, lg stands alone in legends and pickers."
    >
      <StorySection title="The ladder">
        <StoryCluster>
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <span key={size} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <ChannelIcon channelId="discord" size={size} channels={[{ id: 'discord', icon: 'MessageSquare' }]} />
              {size}
            </span>
          ))}
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvasElement }) => {
    const icons = canvasElement.querySelectorAll('[data-channel-icon="discord"]')
    await expect(icons.length).toBe(3)
    await expect(icons[0]).toHaveAttribute('data-size', 'sm')
    await expect(icons[1]).toHaveAttribute('data-size', 'md')
    await expect(icons[2]).toHaveAttribute('data-size', 'lg')
    const widths = Array.from(icons).map((icon) => icon.getBoundingClientRect().width)
    await expect(widths[0]).toBeLessThan(widths[1])
    await expect(widths[1]).toBeLessThan(widths[2])
    await expect(Math.round(widths[1])).toBe(16)
  },
} satisfies Story
