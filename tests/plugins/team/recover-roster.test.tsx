/**
 * `/team?recover=1` (self-healing PR1 slice 1.4b; rows 106–107): the roster
 * problems Health found, named on the page with where the roster lives.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

import { RosterRecoverBanner } from '../../../plugins/team/components/roster-recover-banner'

const realFetch = globalThis.fetch
let report: unknown
beforeEach(() => {
  report = {
    observations: [
      { id: 'team.agent-roster:duplicate-relay', summary: 'Runtime agent id relay appears more than once.' },
      { id: 'team.agent-roster:missing-id-3', summary: 'Runtime agent at roster position 4 has no id.' },
      { id: 'tasks.task-consistency:unknown-agent:t1', summary: 'Task t1 is assigned to an unknown agent.' },
    ],
    incidents: [
      { id: 'a', title: 'Agent id relay is duplicated', observationIds: ['team.agent-roster:duplicate-relay'], resources: [{ kind: 'agent', id: 'relay', label: 'relay' }] },
      { id: 'b', title: 'A runtime agent has no stable id', observationIds: ['team.agent-roster:missing-id-3'], resources: [{ kind: 'runtime', id: 'agent-index-3', label: 'Roster entry 4' }] },
      { id: 'c', title: 'Unknown agent', observationIds: ['tasks.task-consistency:unknown-agent:t1'], resources: [{ kind: 'task', id: 't1', label: 't1' }] },
    ],
  }
  globalThis.fetch = mock(async () => Response.json(report)) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('RosterRecoverBanner', () => {
  it('lists only the roster problems, links a duplicated agent, and says where the roster lives', async () => {
    await act(async () => { render(<RosterRecoverBanner onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByTestId('roster-recover-banner')).toBeTruthy())
    expect(screen.getByText('2 roster problems')).toBeTruthy()
    expect(screen.getByText(/relay appears more than once/)).toBeTruthy()
    expect(screen.getByText(/position 4 has no id/)).toBeTruthy()
    expect(screen.queryByText(/unknown agent/)).toBeNull()
    expect((screen.getByRole('link', { name: 'Open relay' }) as HTMLAnchorElement).getAttribute('href')).toBe('/team/relay')
    expect(screen.getByText(/agent registry/)).toBeTruthy()
  })
  it('a clean roster is a quiet success', async () => {
    report = { observations: [], incidents: [] }
    await act(async () => { render(<RosterRecoverBanner onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
  })
})
