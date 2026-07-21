// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'

import { AgentDot, AgentStatus } from '../../src/components/agent-status'
import '../rtl-settle'

afterEach(cleanup)

describe('agent status compatibility adapter', () => {
  it('maps current host heartbeat values to exact public presence language', () => {
    const timestamp = new Date(Date.now() - 60_000).toISOString()
    render(
      <>
        <AgentStatus name="Working agent" heartbeat={{ status: 'working', timestamp }} />
        <AgentStatus name="Idle agent" heartbeat={{ status: 'idle', timestamp }} />
        <AgentStatus name="Down agent" heartbeat={{ status: 'down', timestamp }} />
      </>,
    )

    expect(screen.getByRole('status', { name: 'Working agent status' }).textContent).toContain('Working')
    expect(screen.getByRole('status', { name: 'Idle agent status' }).textContent).toContain('Available')
    expect(screen.getByRole('status', { name: 'Down agent status' }).textContent).toContain('Needs attention')
  })

  it('maps missing, stale, and invalid timestamps to offline', () => {
    render(
      <>
        <AgentDot />
        <AgentStatus name="Stale agent" heartbeat={{ status: 'working', timestamp: new Date(Date.now() - 16 * 60_000).toISOString() }} />
        <AgentStatus name="Invalid agent" heartbeat={{ status: 'idle', timestamp: 'not-a-time' }} />
      </>,
    )

    expect(screen.getAllByRole('img', { name: 'Offline' })).toHaveLength(1)
    expect(screen.getByRole('status', { name: 'Stale agent status' }).textContent).toContain('Offline')
    expect(screen.getByRole('status', { name: 'Invalid agent status' }).textContent).toContain('Offline')
  })
})
