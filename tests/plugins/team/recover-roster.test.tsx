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
import { resetRosterReturnForTests } from '@bakin/team/components/roster-return'

const realFetch = globalThis.fetch
let report: unknown
let requests: Array<{ url: string; method: string; body?: unknown }>
let runStatus = 200
let removeStatus = 200
/** What the doctor read answers: the report, an HTTP failure, or a rejection. */
let doctorMode: 'ok' | 'http-error' | 'reject'
const rosterObserved = [{ checkId: 'team.agent-roster', latestExecution: { outcome: 'observed' } }]
const rosterHealthy = [{ id: 'team.agent-roster:roster', checkId: 'team.agent-roster', status: 'healthy', summary: '2 runtime agent(s) have unique stable ids.' }]
beforeEach(() => {
  for (const key of Object.keys(query)) delete query[key]
  requests = []
  removeStatus = 200
  doctorMode = 'ok'
  report = {
    checks: rosterObserved,
    observations: [
      { id: 'team.agent-roster:duplicate-relay', summary: 'Runtime agent id relay appears 2 times (roster positions 2, 3).', evidence: { kind: 'duplicate', agentId: 'relay', positions: [1, 2], names: ['Relay', 'Relay (old)'] } },
      { id: 'team.agent-roster:missing-id-3', summary: 'Runtime agent at roster position 4 has no id.', evidence: { kind: 'missing-id', rosterIndex: 3, name: 'Broken', workspace: '/home/x/.pi/agent/broken', registry: { path: '/home/x/.pi/agent/bakin-agents.json', entryKey: 'agents[3]' } } },
      { id: 'tasks.task-consistency:unknown-agent:t1', summary: 'Task t1 is assigned to an unknown agent.', evidence: { taskId: 't1' } },
    ],
  }
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/plugins/health/doctor') {
      if (doctorMode === 'http-error') return Response.json({ error: 'doctor unavailable' }, { status: 503 })
      if (doctorMode === 'reject') throw new TypeError('Failed to fetch')
      return Response.json(report)
    }
    if (url === '/api/plugins/health/doctor/run') return runStatus === 200 ? Response.json({ ok: true }) : Response.json({ error: 'doctor busy' }, { status: runStatus })
    if (url.startsWith('/api/plugins/team/') && method === 'DELETE') {
      if (removeStatus !== 200) return Response.json({ error: 'Cannot delete the main orchestrator agent' }, { status: removeStatus })
      // The agent is gone: the next report read has no duplicate left.
      report = { checks: rosterObserved, observations: (report as { observations: Array<{ id: string }> }).observations.filter((o) => !o.id.includes('duplicate-relay')) }
      return Response.json({ ok: true })
    }
    return Response.json({})
  }) as unknown as typeof fetch
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch; runStatus = 200; resetRosterReturnForTests() })

describe('rosterProblemsFrom', () => {
  it('reads the roster findings from evidence only — other checks and evidence-less rows are ignored', () => {
    const problems = rosterProblemsFrom({ observations: [
      ...(report as { observations: never[] }).observations,
      { id: 'team.agent-roster:roster', summary: 'healthy' },
    ] })
    expect(problems).toEqual([
      { kind: 'duplicate', agentId: 'relay', positions: [1, 2], names: ['Relay', 'Relay (old)'], removable: true, summary: expect.stringContaining('relay') },
      { kind: 'missing-id', rosterIndex: 3, name: 'Broken', workspace: '/home/x/.pi/agent/broken', registry: { path: '/home/x/.pi/agent/bakin-agents.json', entryKey: 'agents[3]' }, summary: expect.stringContaining('position 4') },
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
    // Row 106 (Codex r2 #7): the id-less entry's control is the registry file + entry key as a HandoffCard, never a sentence.
    const handoff = within(missing).getByRole('region', { name: 'Give roster entry 4 an id' })
    expect(handoff.textContent).toContain('agents[3]')
    expect(within(handoff).getByText('"${EDITOR:-nano}" "/home/x/.pi/agent/bakin-agents.json"')).toBeTruthy()
    expect(within(handoff).getByRole('button', { name: /copy/i })).toBeTruthy()
    expect(screen.queryByText(/unknown agent/)).toBeNull()
  })

  it('an id-less entry whose runtime names no registry location keeps the honest sentence and no command', async () => {
    report = { observations: [{ id: 'team.agent-roster:missing-id-0', summary: 'Runtime agent at roster position 1 has no id.', evidence: { kind: 'missing-id', rosterIndex: 0 } }] }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByTestId('roster-recover-panel')).toBeTruthy())
    expect(screen.queryByRole('region', { name: /an id/ })).toBeNull()
    expect(screen.getByText(/No runtime surface names an entry by position/)).toBeTruthy()
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
    report = { checks: rosterObserved, observations: rosterHealthy }
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

  it('a clean roster is a quiet success — ONLY when the roster check has observed in this report', async () => {
    report = { checks: rosterObserved, observations: rosterHealthy }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
    expect(screen.getByTestId('roster-recover-panel').getAttribute('data-evidence')).toBe('verified-empty')
  })

  it('no roster check evidence in the report is UNVERIFIED, never "consistent"; Recheck roster runs the check and re-reads (Codex r2 #10)', async () => {
    report = { checks: [], observations: [] }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health has not verified the roster yet')).toBeTruthy())
    expect(screen.getByTestId('roster-recover-panel').getAttribute('data-evidence')).toBe('unverified')
    expect(screen.queryByText('The roster is consistent')).toBeNull()
    report = { checks: rosterObserved, observations: rosterHealthy }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck roster' })) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
    expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ method: 'POST', body: { checkIds: ['team.agent-roster'] } })
  })

  it('a failed report read (HTTP error, then a rejection) is an honest unavailable state with Try again — never an empty, consistent roster (Codex r2 #10)', async () => {
    doctorMode = 'http-error'
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health could not be read')).toBeTruthy())
    expect(screen.getByTestId('roster-recover-panel').getAttribute('data-evidence')).toBe('unavailable')
    expect(screen.getByTestId('roster-recover-panel').textContent).toContain('(503)')
    expect(screen.queryByText('The roster is consistent')).toBeNull()
    doctorMode = 'ok'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await waitFor(() => expect(screen.getByText('2 roster problems')).toBeTruthy())
    cleanup()
    doctorMode = 'reject'
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health could not be read')).toBeTruthy())
    expect(screen.getByTestId('roster-recover-panel').textContent).toContain('Failed to fetch')
  })

  it('an observed roster check whose inspection FAILED (an unknown row — row 105) is never "consistent": the gap is named and Recheck stays (Codex r3 #2)', async () => {
    report = { checks: rosterObserved, observations: [{ id: 'team.agent-roster:roster-read', checkId: 'team.agent-roster', status: 'unknown', summary: 'The runtime agent roster could not be read.' }] }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health could not inspect the roster')).toBeTruthy())
    const panel = screen.getByTestId('roster-recover-panel')
    expect(panel.getAttribute('data-evidence')).toBe('unverified')
    expect(panel.getAttribute('data-gap')).toBe('could-not-inspect')
    expect(screen.queryByText('The roster is consistent')).toBeNull()
    // Stale evidence (a last-known row) is not a current verification either.
    cleanup()
    report = { checks: rosterObserved, observations: [{ ...rosterHealthy[0]!, snapshot: 'last_known' }] }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('Health has only stale roster evidence')).toBeTruthy())
    expect(screen.getByTestId('roster-recover-panel').getAttribute('data-gap')).toBe('stale')
    expect(screen.queryByText('The roster is consistent')).toBeNull()
  })

  it('a failed refresh AFTER a clean result shows the failure, not "consistent" (Codex r3 #2)', async () => {
    report = { checks: rosterObserved, observations: rosterHealthy }
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
    doctorMode = 'http-error'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck roster' })) })
    await waitFor(() => expect(screen.getByText('The latest refresh failed')).toBeTruthy())
    const panel = screen.getByTestId('roster-recover-panel')
    expect(panel.getAttribute('data-evidence')).toBe('stale')
    expect(panel.textContent).toContain('were none')
    expect(screen.queryByText('The roster is consistent')).toBeNull()
  })

  it('copying a registry handoff ARMS one targeted roster recheck that fires when the window regains focus — the id-less entry and the duplicated MAIN agent alike (Codex r3 #5/#6)', async () => {
    const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true })
    try {
      report = {
        checks: rosterObserved,
        observations: [
          { id: 'team.agent-roster:duplicate-main', summary: 'Runtime agent id main appears 2 times (roster positions 1, 2).', evidence: { kind: 'duplicate', agentId: 'main', positions: [0, 1], names: ['main'], removable: false, registry: { path: '/home/x/.pi/agent/bakin-agents.json', entryKeys: ['agents[0]', 'agents[1]'] } } },
          { id: 'team.agent-roster:missing-id-3', summary: 'Runtime agent at roster position 4 has no id.', evidence: { kind: 'missing-id', rosterIndex: 3, registry: { path: '/home/x/.pi/agent/bakin-agents.json', entryKey: 'agents[3]' } } },
        ],
      }
      await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
      await screen.findByText('2 roster problems')
      const rows = screen.getAllByRole('listitem')
      const main = rows.find((row) => row.getAttribute('data-roster-problem') === 'duplicate:main')!
      // The main agent cannot be removed: no Remove button, the registry edit is the control, Recheck beside it.
      expect(within(main).queryByRole('button', { name: /Remove main/ })).toBeNull()
      expect(main.textContent).toContain('main is the main agent, so it cannot be removed')
      const handoff = within(main).getByRole('region', { name: 'Edit the roster entries for main' })
      expect(handoff.textContent).toContain('agents[0] / agents[1]')
      expect(within(handoff).getByText('"${EDITOR:-nano}" "/home/x/.pi/agent/bakin-agents.json"')).toBeTruthy()
      expect(within(main).getByRole('button', { name: 'Recheck roster' })).toBeTruthy()

      // Unarmed focus reruns nothing.
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(0)

      // Copy → the handoff is taken → the next focus reruns the roster check and re-reads.
      await act(async () => { fireEvent.click(within(handoff).getByRole('button', { name: /copy/i })) })
      report = { checks: rosterObserved, observations: rosterHealthy }
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      await waitFor(() => expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(1))
      expect(requests.find((r) => r.url === '/api/plugins/health/doctor/run')).toMatchObject({ method: 'POST', body: { checkIds: ['team.agent-roster'] } })
      await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
      // One-shot.
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(1)

      // The id-less entry's card arms the same return.
      cleanup()
      requests = []
      report = { checks: rosterObserved, observations: [{ id: 'team.agent-roster:missing-id-3', summary: 'Runtime agent at roster position 4 has no id.', evidence: { kind: 'missing-id', rosterIndex: 3, registry: { path: '/home/x/.pi/agent/bakin-agents.json', entryKey: 'agents[3]' } } }] }
      await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
      const idless = await screen.findByRole('region', { name: 'Give roster entry 4 an id' })
      await act(async () => { fireEvent.click(within(idless).getByRole('button', { name: /copy/i })) })
      await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
      await waitFor(() => expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(1))

      // Codex r4 R4-2: the arming survives the Terminal round trip — copy, unmount, remount ⇒ exactly one targeted run on mount.
      cleanup()
      requests = []
      await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
      const again = await screen.findByRole('region', { name: 'Give roster entry 4 an id' })
      await act(async () => { fireEvent.click(within(again).getByRole('button', { name: /copy/i })) })
      cleanup()
      expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(0)
      await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
      await waitFor(() => expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(1))
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(requests.filter((r) => r.url === '/api/plugins/health/doctor/run')).toHaveLength(1)
    } finally {
      if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore)
      else delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  it('a recheck that Health refuses is shown even when the cached read that follows is clean — never "consistent" (Codex r4 R4-3)', async () => {
    report = { checks: rosterObserved, observations: rosterHealthy }
    runStatus = 503
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await screen.findByText('The roster is consistent')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck roster' })) })
    await waitFor(() => expect(screen.getByTestId('roster-recover-panel').getAttribute('data-evidence')).toBe('recheck-failed'))
    expect(screen.getByText('Health could not be asked to recheck the roster')).toBeTruthy()
    expect(screen.queryByText('The roster is consistent')).toBeNull()
    runStatus = 200
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck roster' })) })
    await waitFor(() => expect(screen.getByText('The roster is consistent')).toBeTruthy())
  })

  it('a failed REFRESH keeps the last known rows and says the read failed (Codex r2 #10)', async () => {
    await act(async () => { render(<RosterRecoverPanel onDismiss={() => {}} />) })
    await waitFor(() => expect(screen.getByText('2 roster problems')).toBeTruthy())
    doctorMode = 'http-error'
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Recheck roster' })) })
    await waitFor(() => expect(screen.getByText('The latest refresh failed')).toBeTruthy())
    expect(screen.getByTestId('roster-recover-panel').getAttribute('data-evidence')).toBe('stale')
    expect(screen.getByText('2 roster problems')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText('The roster is consistent')).toBeNull()
  })
})
