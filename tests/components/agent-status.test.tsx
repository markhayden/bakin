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

  it('shimmers only the genuinely in-action presence label', () => {
    const { container } = render(
      <>
        <AgentStatus name="Working agent" status="working" />
        <AgentStatus name="Online agent" status="online" />
        <AgentStatus name="Idle agent" status="available" />
        <AgentStatus name="Gone agent" status="offline" />
        <AgentStatus name="Down agent" status="error" />
      </>,
    )

    const labels = [...container.querySelectorAll('[data-slot="shimmer-text"]')]
    expect(labels).toHaveLength(5)
    expect(labels.map((label) => label.getAttribute('data-active'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
    ])
    // The sweep never changes the words or adds semantics.
    expect(labels[0]?.textContent).toBe('Working')
    expect(labels[0]?.getAttribute('role')).toBeNull()
    expect(labels[0]?.getAttribute('aria-hidden')).toBeNull()
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
