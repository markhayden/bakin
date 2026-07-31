// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'

import { AgentDot, AgentStatus } from '@makinbakin/sdk/patterns'
import '../rtl-settle'

afterEach(cleanup)

describe('agent presence patterns', () => {
  it('renders exact public presence language for each status', () => {
    render(
      <>
        <AgentStatus name="Working agent" status="working" />
        <AgentStatus name="Idle agent" status="available" />
        <AgentStatus name="Down agent" status="error" />
        <AgentStatus name="Gone agent" status="offline" />
      </>,
    )

    expect(screen.getByRole('status', { name: 'Working agent status' }).textContent).toContain('Working')
    expect(screen.getByRole('status', { name: 'Idle agent status' }).textContent).toContain('Available')
    expect(screen.getByRole('status', { name: 'Down agent status' }).textContent).toContain('Needs attention')
    expect(screen.getByRole('status', { name: 'Gone agent status' }).textContent).toContain('Offline')
  })

  it('AgentDot exposes the presence label to assistive tech unless decorative', () => {
    render(
      <>
        <AgentDot status="offline" />
        <AgentStatus name="Detail agent" status="working" detail="Enriching assets" />
      </>,
    )

    expect(screen.getAllByRole('img', { name: 'Offline' })).toHaveLength(1)
    expect(screen.getByRole('status', { name: 'Detail agent status' }).textContent).toContain('Enriching assets')
  })
})
