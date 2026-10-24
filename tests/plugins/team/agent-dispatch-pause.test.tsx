/**
 * "Pause dispatch for this agent" (self-healing PR1 slice 1.4b; row 50): the
 * Diagnostics tab's containment control reads and writes
 * `dispatch.pausedAgents` through /api/settings and reruns the burn check.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'

import { AgentDispatchPausePanel } from '../../../plugins/team/components/agent-dispatch-pause'

let pausedAgents: string[]
let requests: Array<{ url: string; method: string; body?: unknown }>
const realFetch = globalThis.fetch
beforeEach(() => {
  pausedAgents = ['relay']
  requests = []
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as { dispatch?: { pausedAgents?: string[] } } : undefined
    requests.push({ url, method, body })
    if (url === '/api/settings' && method === 'GET') return Response.json({ dispatch: { paused: false, pausedAgents } })
    if (url === '/api/settings' && method === 'POST') { pausedAgents = body?.dispatch?.pausedAgents ?? pausedAgents; return Response.json({ dispatch: { pausedAgents } }) }
    return Response.json({})
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('AgentDispatchPausePanel', () => {
  it('pauses ONE agent after confirmation (others untouched) and reruns the burn check', async () => {
    await act(async () => { render(<AgentDispatchPausePanel agentId="pixel" />) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause dispatch for this agent' })).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause dispatch for this agent' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Pause dispatch for pixel?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Pause dispatch' })) })
    await waitFor(() => expect(requests.find((r) => r.url === '/api/settings' && r.method === 'POST')).toMatchObject({ body: { dispatch: { pausedAgents: ['relay', 'pixel'] } } }))
    await waitFor(() => expect(screen.getByText('Dispatch is paused for this agent')).toBeTruthy())
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['health.usage.agent-burn'] } })
  })
  it('a paused agent shows the state and Resume removes only it', async () => {
    await act(async () => { render(<AgentDispatchPausePanel agentId="relay" />) })
    await waitFor(() => expect(screen.getByText('Dispatch is paused for this agent')).toBeTruthy())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume dispatch' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Resume dispatch for relay?' })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Resume dispatch' })) })
    await waitFor(() => expect(requests.find((r) => r.method === 'POST')).toMatchObject({ body: { dispatch: { pausedAgents: [] } } }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause dispatch for this agent' })).toBeTruthy())
  })
})
