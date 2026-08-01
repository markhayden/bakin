// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  AgentAvatar,
  AgentSelect,
  AgentStatus,
  TEAM_VALUE_PREFIX,
  isTeamValue,
  teamIdFromValue,
} from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

afterEach(cleanup)

const agents = [
  { id: 'maya', name: 'Maya Chen', color: '#8b5cf6' },
  { id: 'release', name: 'Release Operations With A Deliberately Long Name', color: '#14b8a6' },
] as const

describe('focused agent identity patterns', () => {
  it('does not render URL paint values supplied as identity colors', () => {
    const { container } = render(
      <AgentAvatar agent={{ id: 'unsafe', name: 'Unsafe color', color: 'url(https://example.test/paint.svg)' }} />,
    )

    expect(container.querySelector('circle')).toBeNull()
  })

  it('presents initials and status with exact non-color meaning', () => {
    render(
      <>
        <AgentAvatar agent={agents[0]} size="lg" showStatus status="working" />
        <AgentStatus name="Maya Chen" status="working" detail="Deploying release 42" />
      </>,
    )

    expect(screen.getByLabelText('Maya Chen, Working').textContent).toContain('MC')
    const status = screen.getByRole('status', { name: 'Maya Chen status' })
    expect(status.textContent).toContain('Maya Chen')
    expect(status.textContent).toContain('Working')
    expect(status.textContent).toContain('Deploying release 42')
  })

  it('centers fallback identity content at the shared avatar root', () => {
    render(<AgentAvatar agent={{ id: 'fallback', name: 'Fallback Agent' }} />)

    const avatar = screen.getByLabelText('Fallback Agent')
    expect(avatar.className).toContain('items-center')
    expect(avatar.className).toContain('justify-center')
    expect(avatar.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe('FA')
  })

  it('keeps every supported presence state named in visible copy', () => {
    render(
      <>
        <AgentStatus name="Online agent" status="online" />
        <AgentStatus name="Available agent" status="available" />
        <AgentStatus name="Offline agent" status="offline" />
        <AgentStatus name="Attention agent" status="error" />
      </>,
    )

    expect(screen.getByText('Online')).toBeTruthy()
    expect(screen.getByText('Available')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText('Needs attention')).toBeTruthy()
  })
})

describe('focused agent assignment pattern', () => {
  it('uses an associated field label when the consumer does not supply an aria label', () => {
    render(
      <>
        <label htmlFor="owner-agent">Owner</label>
        <AgentSelect
          id="owner-agent"
          value="maya"
          onValueChange={() => {}}
          agents={agents}
        />
      </>,
    )

    expect(screen.getByRole('combobox', { name: 'Owner' })).toBeTruthy()
  })

  it('groups teams and agents and commits an exact encoded value', async () => {
    const onValueChange = mock(() => {})
    const user = userEvent.setup()
    render(
      <AgentSelect
        ariaLabel="Assign owner"
        value="maya"
        onValueChange={onValueChange}
        agents={agents}
        teams={[{ id: 'release', label: 'Release team', color: '#f59e0b' }]}
        includeAssigned
        allowNone
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Assign owner' })
    expect(trigger.textContent).toContain('Maya Chen')
    expect(trigger.querySelector('[data-agent-choice]')?.className).toContain('items-center')
    await user.click(trigger)
    expect(await screen.findByRole('group', { name: 'Teams' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Agents' })).toBeTruthy()
    await user.click(screen.getByRole('option', { name: 'Release team' }))
    expect(onValueChange).toHaveBeenCalledWith(`${TEAM_VALUE_PREFIX}release`)
  })

  it('keeps team value encoding explicit and reversible', () => {
    expect(isTeamValue('team:release')).toBe(true)
    expect(isTeamValue('maya')).toBe(false)
    expect(teamIdFromValue('team:release')).toBe('release')
    expect(teamIdFromValue('maya')).toBe('')
  })
})
