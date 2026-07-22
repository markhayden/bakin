import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import {
  AgentAvatar,
  AgentFilter,
  AgentSelect,
  AgentStatus,
  type AgentIdentity,
  type AgentPresenceStatus,
} from '@makinbakin/sdk/patterns'

import './agent-identity-assignment.stories.css'

const meta = {
  title: 'Agents/Identity and assignment',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Agent identity patterns accept presentation-ready data. Stores, registry lookups, team loading, heartbeat timing, URL state, and persistence remain consumer-owned.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'non-color', 'disabled', 'empty', 'long-content', 'reduced-motion'],
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

const statuses: Array<{ status: AgentPresenceStatus; detail: string }> = [
  { status: 'online', detail: 'Connected and ready for work' },
  { status: 'working', detail: 'Validating the release candidate' },
  { status: 'available', detail: 'Idle and available for assignment' },
  { status: 'offline', detail: 'No recent heartbeat' },
  { status: 'error', detail: 'Heartbeat reports an operational problem' },
]

function StoryHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="bakin-agent-pattern-story__intro">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

export const IdentityAndPresence = {
  render: () => (
    <main className="bakin-agent-pattern-story">
      <PageShell width="content">
        <Stack gap="section">
          <StoryHeader
            eyebrow="Agents / identity"
            title="Keep identity recognizable at every density"
            description="Portraits, resilient initials, semantic sizes, and exact status language use one presentation contract. Color supports identity but never carries status by itself."
          />
          <section aria-labelledby="avatar-sizes" className="bakin-agent-pattern-story__surface">
            <h2 id="avatar-sizes">Portrait and fallback sizes</h2>
            <div className="bakin-agent-pattern-story__avatars">
              <AgentAvatar agent={agents[0]} size="xs" />
              <AgentAvatar agent={agents[0]} size="sm" />
              <AgentAvatar agent={agents[1]} size="md" />
              <AgentAvatar agent={agents[2]} size="lg" showStatus status="working" />
              <AgentAvatar agent={{ id: 'unknown', name: 'Unknown agent', initials: '?' }} size="xl" showStatus status="offline" />
            </div>
          </section>
          <section aria-labelledby="presence-language" className="bakin-agent-pattern-story__surface">
            <h2 id="presence-language">Presence language</h2>
            <div className="bakin-agent-pattern-story__statuses">
              {statuses.map(({ status, detail }) => (
                <AgentStatus key={status} name={status === 'working' ? agents[2].name : 'Maya Chen'} status={status} detail={detail} />
              ))}
            </div>
          </section>
        </Stack>
      </PageShell>
    </main>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByLabelText('Release Operations With A Deliberately Long Name, Working')).toBeVisible()
    await expect(canvas.getByRole('status', { name: 'Release Operations With A Deliberately Long Name status' })).toHaveTextContent('Working')
    await expect(canvas.getAllByRole('status', { name: 'Maya Chen status' })[0]).toBeVisible()
  },
} satisfies Story

function AssignmentExample() {
  const [owner, setOwner] = useState('maya')
  const [filter, setFilter] = useState('all')
  const ownerLabel = owner.startsWith('team:')
    ? 'Release team'
    : agents.find((agent) => agent.id === owner)?.name ?? (owner || 'Unassigned')

  return (
    <main className="bakin-agent-pattern-story">
      <PageShell width="content">
        <Stack gap="section">
          <StoryHeader
            eyebrow="Agents / controlled choice"
            title="Choose owners without coupling to the registry"
            description="The public selector receives exact agent and team options. The host keeps team fetching, assignment encoding, and persistence outside the visual contract."
          />
          <section aria-labelledby="assignment-controls" className="bakin-agent-pattern-story__surface">
            <h2 id="assignment-controls">Assignment and filtering</h2>
            <div className="bakin-agent-pattern-story__field">
              <label htmlFor="agent-pattern-owner">Owner</label>
              <AgentSelect
                id="agent-pattern-owner"
                ariaLabel="Owner"
                value={owner}
                onValueChange={setOwner}
                agents={agents}
                teams={[{ id: 'release', label: 'Release team', color: '#f59e0b' }]}
                includeAssigned
                allowNone
              />
            </div>
            <AgentFilter
              options={agents.map((agent) => ({
                value: agent.id,
                label: agent.name,
                visual: <AgentAvatar agent={agent} size="xs" decorative />,
              }))}
              value={filter}
              onValueChange={setFilter}
            />
            <p role="status" className="bakin-agent-pattern-story__result">Selected owner: {ownerLabel}. Active filter: {filter}.</p>
          </section>
          <section aria-labelledby="assignment-constraints" className="bakin-agent-pattern-story__surface">
            <h2 id="assignment-constraints">Empty and disabled constraints</h2>
            <div className="bakin-agent-pattern-story__constraints">
              <AgentSelect ariaLabel="No available agents" value="" onValueChange={() => {}} agents={[]} placeholder="No agents available" />
              <AgentSelect ariaLabel="Locked owner" value="release" onValueChange={() => {}} agents={agents} disabled />
            </div>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const AssignmentAndFiltering = {
  render: () => <AssignmentExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const owner = canvas.getByRole('combobox', { name: 'Owner' })
    owner.focus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('listbox')).toBeVisible())
    await userEvent.click(page.getByRole('option', { name: 'Release team' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Selected owner: Release team')
    const all = canvas.getByRole('radio', { name: 'All' })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Maya Chen' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('combobox', { name: 'Locked owner' })).toBeDisabled()
  },
} satisfies Story
