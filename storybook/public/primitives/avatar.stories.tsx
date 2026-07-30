import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Avatar',
  component: Avatar,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Avatar for compact identity. Provide meaningful adjacent text; initials are the reliable fallback, not a substitute for an accessible name.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'fallback-missing'],
  },
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Avatar>
      <AvatarImage src="/avatars/mark-baker.png" alt="" />
      <AvatarFallback>MB</AvatarFallback>
    </Avatar>
  ),
  play: async ({ canvas }) => {
    // The image never resolves here, so the initials fallback must take over.
    const fallback = await canvas.findByText('MB')
    await expect(fallback).toBeVisible()
  },
} satisfies Story

export const SizesAndFallbacks = {
  render: () => (
    <StoryStage
      eyebrow="Identity"
      title="Avatar"
      description="Five token-backed sizes preserve hierarchy from dense metadata through prominent identity."
    >
      <StorySection title="Initial fallbacks">
        <StoryCluster>
          {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
            <div key={size} style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)', justifyItems: 'center' }}>
              <Avatar size={size}><AvatarFallback>MB</AvatarFallback></Avatar>
              <span style={{ fontSize: 'var(--bakin-typography-size-meta)' }}>{size}</span>
            </div>
          ))}
        </StoryCluster>
      </StorySection>
      <StorySection title="Assigned agents" description="Group overlap is compact but every identity remains named in surrounding content.">
        <AvatarGroup role="group" aria-label="Assigned to Alex, Jordan, Sam, and three more agents">
          <Avatar><AvatarFallback>AM</AvatarFallback><AvatarBadge role="img" aria-label="Available" /></Avatar>
          <Avatar><AvatarFallback>JL</AvatarFallback></Avatar>
          <Avatar><AvatarFallback>SK</AvatarFallback></Avatar>
          <AvatarGroupCount aria-hidden="true">+3</AvatarGroupCount>
        </AvatarGroup>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    // Overlapped identities stay named: the group and its status cue carry accessible names.
    const group = canvas.getByRole('group', { name: 'Assigned to Alex, Jordan, Sam, and three more agents' })
    await expect(group).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Available' })).toBeInTheDocument()
    // Every size renders its initials fallback.
    await expect(canvas.getAllByText('MB')).toHaveLength(5)
  },
} satisfies Story
