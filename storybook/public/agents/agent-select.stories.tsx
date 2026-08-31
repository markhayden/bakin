import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import {
  AgentAvatar,
  AgentFilter,
  AgentSelect,
  type AgentIdentity,
} from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Agents/AgentSelect',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AgentSelect is the controlled owner-assignment selector: it receives exact agent and team options and reports the chosen string value, with optional Unassigned and Assigned-agent entries. AgentFilter is the companion single-agent radio-group filter for narrowing work to one owner. Both accept presentation-ready data — team fetching, assignment encoding, URL state, and persistence remain consumer-owned.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'empty', 'non-color', 'long-content'],
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

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <AgentSelect
      ariaLabel="Owner"
      value="maya"
      onValueChange={() => {}}
      agents={[
        { id: 'maya', name: 'Maya Chen', color: '#8b5cf6' },
        { id: 'patch', name: 'Patch', color: '#f97316' },
      ]}
    />
  ),
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Owner' })
    await expect(trigger).toBeVisible()
    await expect(trigger).toHaveTextContent('Maya Chen')
  },
} satisfies Story

function AssignmentExample() {
  const [owner, setOwner] = useState('maya')
  const [filter, setFilter] = useState('all')
  const ownerLabel = owner.startsWith('team:')
    ? 'Release team'
    : agents.find((agent) => agent.id === owner)?.name ?? (owner || 'Unassigned')

  return (
    <StoryStage
      eyebrow="Agents / controlled choice"
      title="Choose owners without coupling to the registry"
      description="The public selector receives exact agent and team options. The host keeps team fetching, assignment encoding, and persistence outside the visual contract."
    >
      <StorySection title="Assignment and filtering">
        <div style={{ display: 'grid', width: 'min(100%, 28rem)', gap: 'var(--bakin-layout-space-2)' }}>
          <label
            htmlFor="agent-pattern-owner"
            style={{ fontSize: 'var(--bakin-typography-size-body)', fontWeight: 'var(--bakin-typography-weight-semibold)' }}
          >
            Owner
          </label>
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
        <p role="status" style={{ margin: 0, color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
          Selected owner: {ownerLabel}. Active filter: {filter}.
        </p>
      </StorySection>
      <StorySection title="Empty and disabled constraints">
        <div style={{ display: 'flex', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', gap: 'var(--bakin-layout-gap-item)' }}>
          <AgentSelect ariaLabel="No available agents" value="" onValueChange={() => {}} agents={[]} placeholder="No agents available" />
          <AgentSelect ariaLabel="Locked owner" value="release" onValueChange={() => {}} agents={agents} disabled />
        </div>
      </StorySection>
    </StoryStage>
  )
}

const filterAgents = [
  { id: 'patch', name: 'Patch', color: '#f97316' },
  { id: 'pixel', name: 'Pixel', color: '#8b5cf6' },
  { id: 'rolo', name: 'Rolo', color: '#14b8a6' },
] as const satisfies readonly AgentIdentity[]

function AgentFilteringExample() {
  const [agent, setAgent] = useState('all')
  const label = agent === 'all' ? 'all agents' : filterAgents.find((option) => option.id === agent)?.name

  return (
    <StoryStage
      eyebrow="Agents / one owner"
      title="Filter by an agent without losing names"
      description="The public pattern accepts presentation-ready options. Official surfaces can keep using the app-aware compatibility adapter for registered agent metadata and avatars."
    >
      <StorySection
        title="Assigned agent"
        description="Arrow keys move and select within one horizontal radio group."
      >
        <AgentFilter
          options={filterAgents.map((option) => ({
            value: option.id,
            label: option.name,
            visual: <AgentAvatar agent={option} size="xs" decorative />,
          }))}
          value={agent}
          onValueChange={setAgent}
          compact
        />
        <p role="status" style={{ margin: 0, color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
          Showing work for {label}
        </p>
      </StorySection>
    </StoryStage>
  )
}

export const AgentFiltering = {
  render: () => <AgentFilteringExample />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement)
    const all = canvas.getByRole('radio', { name: 'All' })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Patch' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('status')).toHaveTextContent('Patch')
    await userEvent.keyboard('{Home}')
    await expect(all).toHaveAttribute('aria-checked', 'true')
  },
} satisfies Story

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
    // An agent-less select has nothing to offer and must not open an empty popup.
    await expect(canvas.getByRole('combobox', { name: 'No available agents' })).toBeDisabled()
  },
} satisfies Story
