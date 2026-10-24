/**
 * `/team?recover=1` (self-healing PR1 slice 1.4b; rows 106–107): the roster
 * editor — one row per failing ENTRY from the report's evidence, the
 * duplicate's executable decision (remove the agent entirely, typed
 * confirmation, targeted recheck), the id-less entry's recheck, and the
 * `?agent=` / `?entry=` deep link landing on the failing row.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '../../rtl-settle'

const query: Record<string, string> = {}
mock.module('@makinbakin/sdk/navigation', () => ({
  PluginLink: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
  useQueryState: (key: string, fallback: string) => [query[key] ?? fallback, () => {}],
}))

import { RosterRecoverPanel, rosterProblemsFrom } from '../../../plugins/team/components/roster-recover-panel'

const realFetch = globalThis.fetch
let report: unknown
let requests: Array<{ url: string; method: string; body?: unknown }>
let removeStatus = 200
beforeEach(() => {
  for (const key of Object.keys(query)) delete query[key]
  requests = []
  removeStatus = 200
  report = {
    observations: [
      { id: 'team.agent-roster:duplicate-relay', summary: 'Runtime agent id relay appears 2 times (roster positions 2, 3).', evidence: { kind: 'duplicate', agentId: 'relay', positions: [1, 2], names: ['Relay', 'Relay (old)'] } },
      { id: 'team.agent-roster:missing-id-3', summary: 'Runtime agent at roster position 4 has no id.', evidence: { kind: 'missing-id', rosterIndex: 3, name: 'Broken', workspace: '/home/x/.pi/agent/broken' } },
      { id: 'tasks.task-consistency:unknown-agent:t1', summary: 'Task t1 is assigned to an unknown agent.', evidence: { taskId: 't1' } },
    ],
  }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/plugins/health/doctor') return Response.json(report)
    if (url === '/api/plugins/health/doctor/run') return Response.json({ ok: true })
    if (url.startsWith('/api/plugins/team/') && method === 'DELETE') {
      if (removeStatus !== 200) return Response.json({ error: 'Cannot delete the main orchestrator agent' }, { status: removeStatus })
      // The agent is gone: the next report read has no duplicate left.
      report = { observations: (report as { observations: Array<{ id: string }> }).observations.filter((o) => !o.id.includes('duplicate-relay')) }
      return Response.json({ ok: true })
    }
    return Response.json({})
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('rosterProblemsFrom', () => {
  it('reads the roster findings from evidence only — other checks and evidence-less rows are ignored', () => {
    const problems = rosterProblemsFrom({ observations: [
      ...(report as { observations: never[] }).observations,
      { id: 'team.agent-roster:roster', summary: 'healthy' },
    ] })
    expect(problems).toEqual([
      { kind: 'duplicate', agentId: 'relay', positions: [1, 2], names: ['Relay', 'Relay (old)'], summary: expect.stringContaining('relay') },
      { kind: 'missing-id', rosterIndex: 3, name: 'Broken', workspace: '/home/x/.pi/agent/broken', summary: expect.stringContaining('position 4') },
    ])
  })
})

describe('RosterRecoverPanel', () => {
  it('renders one entry-addressed row per roster problem with its controls, and nothing for other checks', async () => {
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByTestId('roster-recover-panel')).toBeTruthy())
    expect(screen.getByText('2 roster problems')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    const duplicate = rows.find((row) => row.getAttribute('data-roster-problem') === 'duplicate:relay')!
    expect(duplicate.textContent).toContain('Agent id relay at roster positions 2, 3')
    expect(duplicate.textContent).toContain('Named Relay / Relay (old)')
    expect((within(duplicate).getByRole('link', { name: 'Open relay' }) as HTMLAnchorElement).getAttribute('href')).toBe('/team/relay')
    expect(within(duplicate).getByRole('button', { name: 'Remove relay entirely' })).toBeTruthy()
    const missing = rows.find((row) => row.getAttribute('data-roster-problem') === 'missing-id:3')!
    expect(missing.textContent).toContain('Roster entry 4 has no id (named Broken)')
    expect(missing.textContent).toContain('/home/x/.pi/agent/broken')
    expect(within(missing).getByRole('button', { name: 'Recheck roster' })).toBeTruthy()
    expect(screen.queryByText(/unknown agent/)).toBeNull()
  })

  it('removing a duplicate goes through the typed ConfirmDialog, the team DELETE route, a targeted roster recheck, and the row disappears', async () => {
    const onChanged = mock()
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} onChanged={onChanged} />) })
    await screen.findByText('2 roster problems')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove relay entirely' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Remove agent relay?' })
    expect(dialog.textContent).toContain('positions 2, 3')
    const confirm = within(dialog).getByRole('button', { name: 'Remove agent' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true) // typed confirmation first
    await act(async () => { fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'relay' } }) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove agent' })) })
    await waitFor(() => expect(screen.getByText('1 roster problem')).toBeTruthy())
    expect(requests.find((r) => r.method === 'DELETE')).toMatchObject({ url: '/api/plugins/team/relay' })
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ method: 'POST', body: { checkIds: ['team.agent-roster'] } })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a refused removal (the main agent) keeps the dialog open with the route\'s reason and reruns nothing', async () => {
    removeStatus = 403
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await screen.findByText('2 roster problems')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove relay entirely' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Remove agent relay?' })
    await act(async () => { fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'relay' } }) })
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove agent' })) })
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('Cannot delete the main orchestrator agent'))
    expect(requests.some((r) => r.url === '/api/plugins/health/doctor/run')).toBe(false)
    expect(screen.getByText('2 roster problems')).toBeTruthy()
  })

  it('Recheck roster on an id-less entry reruns the roster check and re-reads the report', async () => {
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await screen.findByText('2 roster problems')
    report = { observations: [] }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck roster' })) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ body: { checkIds: ['team.agent-roster'] } })
  })

  it('?agent= and ?entry= land on the failing row (highlighted, focused)', async () => {
    query.entry = '3'
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await screen.findByText('2 roster problems')
    const missing = screen.getAllByRole('listitem').find((row) => row.getAttribute('data-roster-problem') === 'missing-id:3')!
    expect(missing.getAttribute('data-highlighted')).toBe('true')
    expect(document.activeElement).toBe(missing)
    cleanup()
    delete query.entry
    query.agent = 'relay'
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await screen.findByText('2 roster problems')
    const duplicate = screen.getAllByRole('listitem').find((row) => row.getAttribute('data-roster-problem') === 'duplicate:relay')!
    expect(duplicate.getAttribute('data-highlighted')).toBe('true')
  })

  it('a clean roster is a quiet success', async () => {
    report = { observations: [] }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
  })
})
