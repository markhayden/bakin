import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { AgentAvatar, AgentDot, type AgentIdentity } from '@makinbakin/sdk/patterns'

import { StoryCluster, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Agents/AgentAvatar',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AgentAvatar renders an agent portrait or resilient initials at semantic sizes, with optional exact presence semantics (`showStatus` + `status`) whose language never relies on color alone. AgentDot is the compact standalone presence mark; mark either one `decorative` only when adjacent visible copy already names the agent or state. Identity data is presentation-ready — registry lookups and heartbeat timing remain consumer-owned.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'non-color', 'empty', 'long-content'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const mayaPortrait = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20rx=%2232%22%20fill=%22%232e1065%22/%3E%3Ccircle%20cx=%2232%22%20cy=%2225%22%20r=%2212%22%20fill=%22%23ddd6fe%22/%3E%3Cpath%20d=%22M12%2064c2-15%209-23%2020-23s18%208%2020%2023%22%20fill=%22%238b5cf6%22/%3E%3C/svg%3E'

const agents = [
  { id: 'maya', name: 'Maya Chen', imageSrc: mayaPortrait, color: '#8b5cf6' },
  { id: 'patch', name: 'Patch', color: '#f97316' },
  { id: 'release', name: 'Release Operations With A Deliberately Long Name', color: '#14b8a6' },
] as const satisfies readonly AgentIdentity[]

const presenceLabels = {
  online: 'Online',
  working: 'Working',
  available: 'Available',
  offline: 'Offline',
  error: 'Needs attention',
} as const

interface AgentAvatarCanonicalArgs {
  /** Semantic avatar size. */
  size: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  /** Show the presence badge (requires `status`). */
  showStatus: boolean
  /** Presence state announced with the agent name. */
  status: keyof typeof presenceLabels
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    size: 'md',
    showStatus: true,
    status: 'online',
  },
  // No meta `component` (the entry also documents AgentDot), so the knobs
  // declare themselves.
  argTypes: {
    size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
    showStatus: { control: 'boolean' },
    status: { control: 'select', options: ['online', 'working', 'available', 'offline', 'error'] },
  },
  render: (args: AgentAvatarCanonicalArgs) => (
    <AgentAvatar
      agent={{ id: 'maya', name: 'Maya Chen', color: '#8b5cf6' }}
      size={args.size}
      showStatus={args.showStatus}
      status={args.status}
    />
  ),
  play: async ({ canvas, args }) => {
    const name = args.showStatus ? `Maya Chen, ${presenceLabels[args.status]}` : 'Maya Chen'
    const avatar = canvas.getByRole('img', { name })
    await expect(avatar).toBeVisible()
    if (args.showStatus) await expect(avatar).toHaveAttribute('data-status', args.status)
  },
} satisfies StoryObj<AgentAvatarCanonicalArgs>

export const SizesAndPresence = {
  render: () => (
    <StoryStage
      eyebrow="Agents / identity"
      title="Keep identity recognizable at every density"
      description="Portraits, resilient initials, semantic sizes, and exact presence semantics use one presentation contract. Color supports identity but never carries status by itself."
    >
      <StorySection
        title="Portrait and fallback sizes"
        description="A portrait renders when supplied; initials with the identity color ring stand in otherwise. An unknown agent falls back to explicit placeholder initials."
      >
        <StoryCluster>
          <AgentAvatar agent={agents[0]} size="xs" />
          <AgentAvatar agent={agents[0]} size="sm" />
          <AgentAvatar agent={agents[1]} size="md" />
          <AgentAvatar agent={agents[2]} size="lg" showStatus status="working" />
          <AgentAvatar agent={{ id: 'unknown', name: 'Unknown agent', initials: '?' }} size="xl" showStatus status="offline" />
        </StoryCluster>
      </StorySection>
      <StorySection
        title="Compact presence marks"
        description="AgentDot carries presence on its own where a full avatar is too heavy. It stays labeled unless adjacent visible copy names the state."
      >
        <StoryCluster>
          <AgentDot status="online" />
          <AgentDot status="working" />
          <AgentDot status="available" />
          <AgentDot status="offline" />
          <AgentDot status="error" />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--bakin-layout-space-2)', color: 'var(--bakin-color-text-muted)' }}>
            <AgentDot status="working" decorative />
            Working
          </span>
        </StoryCluster>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText('Release Operations With A Deliberately Long Name, Working')).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Needs attention' })).toBeVisible()
  },
} satisfies Story

export const IdentityHoverCard = {
  render: () => (
    <StoryStage
      eyebrow="Agents / identity"
      title="Every avatar is inspectable on hover"
      description="Hovering any avatar reveals a larger portrait and the agent's name — no tab stop is added, and the avatar's accessible name is unchanged. Pass tooltip={false} where the interaction would be noise (dense pickers, decorative clusters)."
    >
      <StoryCluster>
        <AgentAvatar agent={{ id: 'maya', name: 'Maya Chen', initials: 'MC', color: 'var(--bakin-color-data-series-2)' }} size="sm" />
        <AgentAvatar agent={{ id: 'rolo', name: 'Rolo', initials: 'RO' }} size="sm" tooltip={false} />
      </StoryCluster>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const withCard = canvas.getByRole('img', { name: 'Maya Chen' })
    await userEvent.hover(withCard)
    const card = await within(document.body).findByText('Maya Chen', { selector: '[data-agent-avatar-card] *' })
    await expect(card).toBeVisible()
    await userEvent.unhover(withCard)
    // Opted-out avatar has no tooltip trigger wiring.
    const plain = canvas.getByRole('img', { name: 'Rolo' })
    await expect(plain).not.toHaveAttribute('data-popup-open')
  },
} satisfies Story
