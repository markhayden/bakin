import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { AgentStatus, type AgentPresenceStatus } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Agents/AgentStatus',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AgentStatus renders an agent name, exact visible presence language (Online, Working, Available, Offline, Needs attention), and optional current-activity detail as one `role="status"` unit. The presence dot is decorative — the words carry the state, never color alone. Heartbeat timing and status derivation remain consumer-owned.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'non-color', 'long-content'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const statuses: Array<{ status: AgentPresenceStatus; detail: string }> = [
  { status: 'online', detail: 'Connected and ready for work' },
  { status: 'working', detail: 'Validating the release candidate' },
  { status: 'available', detail: 'Idle and available for assignment' },
  { status: 'offline', detail: 'No recent heartbeat' },
  { status: 'error', detail: 'Heartbeat reports an operational problem' },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <AgentStatus name="Maya Chen" status="working" detail="Validating the release candidate" />
  ),
  play: async ({ canvas }) => {
    const status = canvas.getByRole('status', { name: 'Maya Chen status' })
    await expect(status).toBeVisible()
    await expect(status).toHaveTextContent('Working')
    await expect(status).toHaveTextContent('Validating the release candidate')
  },
} satisfies Story

export const PresenceLanguage = {
  render: () => (
    <StoryStage
      eyebrow="Agents / presence"
      title="Say the state in words, not color"
      description="Every presence value has exact visible language. Long names truncate inside the row without hiding the state, and detail copy wraps beneath the name."
    >
      <StorySection title="Presence language">
        <div
          style={{
            display: 'grid',
            minWidth: 0,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 16rem), 1fr))',
            gap: 'var(--bakin-layout-gap-item)',
          }}
        >
          {statuses.map(({ status, detail }) => (
            <div
              key={status}
              style={{
                minWidth: 0,
                padding: 'var(--bakin-layout-space-3)',
                borderRadius: 'var(--bakin-radius-control)',
                background: 'var(--bakin-color-canvas-default)',
              }}
            >
              <AgentStatus
                name={status === 'working' ? 'Release Operations With A Deliberately Long Name' : 'Maya Chen'}
                status={status}
                detail={detail}
              />
            </div>
          ))}
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'Release Operations With A Deliberately Long Name status' })).toHaveTextContent('Working')
    await expect(canvas.getAllByRole('status', { name: 'Maya Chen status' })[0]).toBeVisible()
  },
} satisfies Story
