/**
 * Manage Teams (#758): the drawer is a list; create and edit happen in ONE
 * focused TeamFormDialog behind the kit's unsaved-changes guard.
 *
 * Coverage: create (ID derived, reports-to defaults to main = null); rename a
 * main-reporting team without touching reports-to; edit reports-to; a missing
 * reports-to agent must be re-picked; dirty close → stay / discard / save;
 * clean close; focus return; busy; save error stays in the dialog; edits
 * survive a roster refresh; save ok + reload fail → drawer alert; router
 * navigation is guarded while dirty.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, fireEvent, getConfig, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { actRender, settleReact } from '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-team-manager-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

// The guard registers a history blocker while dirty; capture it to drive a
// router navigation.
type Blocker = (args: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) => Promise<boolean>
let blockers: Blocker[] = []
mock.module('@tanstack/react-router', () => ({
  ...require('../../shims/tanstack-router'),
  useRouter: () => ({
    navigate: () => {},
    history: { block: ({ blockerFn }: { blockerFn: Blocker }) => { blockers.push(blockerFn); return () => { blockers = blockers.filter((b) => b !== blockerFn) } } },
    parseLocation: (location: unknown) => location,
  }),
}))

import { useAgentStore } from '@makinbakin/sdk/hooks'
import { TeamManager } from '../../../plugins/team/components/team-manager'

const AGENTS = [
  { id: 'main', name: 'Roscoe', emoji: '🐷', role: 'Orchestrator', headshot: '' },
  { id: 'chef', name: 'Chef', emoji: '🌿', role: 'Cook', headshot: '' },
]

interface Call { url: string; method: string; body?: unknown }
let calls: Call[] = []
let rawTeams: Array<{ id: string; label: string; reportsTo: string | null }> = []
let writeResponse: () => Promise<Response> = async () => Response.json({ ok: true })
const load = mock(async () => true)

function installFetch() {
  calls = []
  global.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/api/plugins/team/teams') && method === 'GET') return Response.json({ teams: rawTeams })
    if (method === 'POST' || method === 'PUT') return writeResponse()
    return Response.json({})
  }) as unknown as typeof global.fetch
}

function seedStore(teams = rawTeams) {
  useAgentStore.setState({
    agents: AGENTS,
    // The roster route maps a missing reports-to agent to null — the dialog must not trust it.
    teams: teams.map((team) => ({ ...team, reportsTo: AGENTS.some((agent) => agent.id === team.reportsTo) ? team.reportsTo : null })),
    mainAgentId: 'main',
    load,
  } as never)
}

const writes = () => calls.filter((call) => call.method === 'POST' || call.method === 'PUT')
const dialog = (name: string) => screen.findByRole('dialog', { name })

async function renderManager() {
  await actRender(() => (require('@testing-library/react') as typeof import('@testing-library/react')).render(<TeamManager />))
}

beforeEach(() => {
  cleanup()
  blockers = []
  rawTeams = [{ id: 'builders', label: 'Builders', reportsTo: null }]
  writeResponse = async () => Response.json({ ok: true })
  load.mockClear()
  load.mockImplementation(async () => true)
  installFetch()
  seedStore()
})
afterEach(async () => {
  await settleReact()
  cleanup()
})

describe('TeamManager + TeamFormDialog', () => {
  it('creates a team: ID derives from the name; reports-to defaults to main (persisted as null)', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Add team' }))
    const form = await dialog('Create a team')
    await user.type(within(form).getByLabelText(/Team name/), 'Growth Lab')
    expect((within(form).getByLabelText(/Team ID/) as HTMLInputElement).value).toBe('growth-lab')
    await user.click(within(form).getByRole('button', { name: 'Create team' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create a team' })).toBeNull())
    expect(writes()).toEqual([{ url: '/api/plugins/team/teams', method: 'POST', body: { id: 'growth-lab', label: 'Growth Lab', reportsTo: null } }])
    await waitFor(() => expect(load).toHaveBeenCalled())
  })

  it('renames a main-reporting team without touching reports-to', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    const name = await within(form).findByLabelText(/Team name/)
    await user.clear(name)
    await user.type(name, '  Makers ')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
    expect(writes()).toEqual([{ url: '/api/plugins/team/teams/builders', method: 'PUT', body: { label: 'Makers', reportsTo: null } }])
  })

  it('edits reports-to', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.click(await within(form).findByRole('combobox', { name: /Reports to/ }))
    await user.click(await screen.findByRole('option', { name: /Chef/ }))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]!.body).toEqual({ label: 'Builders', reportsTo: 'chef' })
  })

  it('a reports-to agent that no longer exists is shown as missing and must be re-picked', async () => {
    rawTeams = [{ id: 'builders', label: 'Builders', reportsTo: 'ghost' }]
    seedStore()
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    expect(await within(form).findByText(/"ghost" no longer exists/)).toBeDefined()
    expect((within(form).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(within(form).getByRole('combobox', { name: /Reports to/ }))
    await user.click(await screen.findByRole('option', { name: /Roscoe/ }))
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]!.body).toEqual({ label: 'Builders', reportsTo: null })
  })

  it('a clean close just closes and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    await renderManager()
    const trigger = screen.getByRole('button', { name: 'Edit Builders' })
    await user.click(trigger)
    await within(await dialog('Edit team')).findByLabelText(/Team name/)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('a dirty close asks first: Cancel (stay) keeps the edit and focus inside the form', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    const name = await within(form).findByLabelText(/Team name/)
    await user.type(name, ' 2')
    await user.keyboard('{Escape}')
    const decision = await dialog('Unsaved changes')
    await user.click(within(decision).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Edit team' })).toBeDefined()
    expect((name as HTMLInputElement).value).toBe('Builders 2')
    await waitFor(() => expect(document.activeElement).toBe(name))
    expect(writes()).toEqual([])
  })

  it('a dirty close → Discard exits without saving and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    await renderManager()
    const trigger = screen.getByRole('button', { name: 'Edit Builders' })
    await user.click(trigger)
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    const decision = await dialog('Unsaved changes')
    await user.click(within(decision).getByRole('button', { name: /Discard/ }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
    expect(writes()).toEqual([])
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('a dirty close → Save and exit saves, then closes', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await user.keyboard('{Escape}')
    const decision = await dialog('Unsaved changes')
    await user.click(within(decision).getByRole('button', { name: 'Save and exit' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
    expect(writes()).toEqual([{ url: '/api/plugins/team/teams/builders', method: 'PUT', body: { label: 'Builders 2', reportsTo: null } }])
  })

  it('is busy while saving: Cancel and Esc cannot close it mid-save', async () => {
    let release: (response: Response) => void = () => {}
    writeResponse = () => new Promise((resolve) => { release = resolve })
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect((within(form).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Edit team' })).toBeDefined()
    await act(async () => { release(Response.json({ ok: true })) })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
  })

  it('a save error renders inside the dialog, which stays open', async () => {
    writeResponse = async () => Response.json({ error: 'label must be a non-empty string' }, { status: 400 })
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(await within(form).findByText('label must be a non-empty string')).toBeDefined()
    expect(screen.getByRole('dialog', { name: 'Edit team' })).toBeDefined()
    expect(screen.queryByText('Team change failed')).toBeNull()
  })

  it('edits survive a roster refresh while the dialog is open', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    const name = await within(form).findByLabelText(/Team name/)
    await user.type(name, ' 2')
    await act(async () => {
      seedStore([{ id: 'builders', label: 'Renamed Elsewhere', reportsTo: 'chef' }])
    })
    await settleReact()
    expect((name as HTMLInputElement).value).toBe('Builders 2')
  })

  it('save ok + roster reload failure shows the drawer alert (the change did land)', async () => {
    load.mockImplementation(async () => false)
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
    expect(await screen.findByText(/The team was saved, but the list could not refresh/)).toBeDefined()
  })

  it('router navigation is guarded while the form is dirty', async () => {
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    expect(blockers).toHaveLength(0)
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await waitFor(() => expect(blockers).toHaveLength(1))
    // Drive the navigation the way user-event drives an interaction: through
    // RTL's async wrapper, which settles the dialog's deferred focus move.
    let blocked: Promise<boolean> = Promise.resolve(false)
    await getConfig().asyncWrapper(async () => {
      blocked = blockers[0]!({ currentLocation: { pathname: '/team' }, nextLocation: { pathname: '/tasks' } })
      await screen.findByRole('dialog', { name: 'Unsaved changes' })
    })
    const decision = await dialog('Unsaved changes')
    let stayed = false
    await act(async () => {
      await user.click(within(decision).getByRole('button', { name: 'Cancel' }))
      stayed = await blocked // true = the navigation stays blocked
    })
    expect(stayed).toBe(true)
    await settleReact()
    expect(screen.getByRole('dialog', { name: 'Edit team' })).toBeDefined()
  })

  it('fields are locked while saving — nothing typed mid-save is silently dropped', async () => {
    let release: (response: Response) => void = () => {}
    writeResponse = () => new Promise((resolve) => { release = resolve })
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    const name = await within(form).findByLabelText(/Team name/) as HTMLInputElement
    await user.type(name, ' 2')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(name.disabled).toBe(true))
    expect((within(form).getByRole('combobox', { name: /Reports to/ }) as HTMLButtonElement).disabled
      || within(form).getByRole('combobox', { name: /Reports to/ }).getAttribute('data-disabled') !== null).toBe(true)
    await act(async () => { release(Response.json({ ok: true })) })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
  })

  it('a navigation attempted mid-save is dismissed once the save lands (no dangling blocker)', async () => {
    let release: (response: Response) => void = () => {}
    writeResponse = () => new Promise((resolve) => { release = resolve })
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await user.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    let blocked: Promise<boolean> = Promise.resolve(false)
    await getConfig().asyncWrapper(async () => {
      blocked = blockers[0]!({ currentLocation: { pathname: '/team' }, nextLocation: { pathname: '/tasks' } })
      await screen.findByRole('dialog', { name: 'Unsaved changes' })
    })
    let settled = null as boolean | null
    await act(async () => {
      release(Response.json({ ok: true }))
      settled = await blocked
    })
    expect(settled).toBe(true) // resolved (the user stays) — never left pending
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit team' })).toBeNull())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull())
  })

  it('a reports-to agent removed from the roster while the dialog is open must be re-picked', async () => {
    rawTeams = [{ id: 'builders', label: 'Builders', reportsTo: 'chef' }]
    seedStore()
    const user = userEvent.setup()
    await renderManager()
    await user.click(screen.getByRole('button', { name: 'Edit Builders' }))
    const form = await dialog('Edit team')
    await user.type(await within(form).findByLabelText(/Team name/), ' 2')
    await act(async () => {
      useAgentStore.setState({ agents: AGENTS.filter((agent) => agent.id !== 'chef') } as never)
    })
    expect(await within(form).findByText(/"chef" no longer exists/)).toBeDefined()
    expect((within(form).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(form).getByLabelText(/Team name/) as HTMLInputElement).value).toBe('Builders 2')
  })

  it('the inline per-row reports-to picker is gone; Add sits at the top of Teams', async () => {
    await renderManager()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add team' }))
    expect(await dialog('Create a team')).toBeDefined()
  })
})
