// @vitest-environment jsdom

import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import '../../rtl-settle'

// Browser-only component under test; the isolation mocks keep any transitive
// server import away from the real home.
const testDir = join(tmpdir(), `bakin-test-updates-tab-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts), resetOpenClawHome: () => {} }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))
import { UpdatesTabView, groupHeading, presentUpdateRecord, visibleUpdateRecords } from '../../../plugins/health/components/updates-tab'
import type { UseHealthResourceResult } from '../../../plugins/health/hooks/use-health-resource'
import { useUpdatesActions } from '../../../plugins/health/hooks/use-updates'
import type { UpdatesData } from '../../../plugins/health/lib/updates-route-schema'
import { finishedOperation, operationResponse, operationStarted } from '../../helpers/operation-fetch'

const originalFetch = globalThis.fetch
const NOW = Date.parse('2026-10-20T12:00:00.000Z')
const CHECKED_AT = '2026-10-20T11:53:00.000Z'

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function record(over: Partial<UpdateRecord> & Pick<UpdateRecord, 'id' | 'subject'>): UpdateRecord {
  return {
    group: 'available', outcome: 'update-available', source: { kind: 'test', endpoint: 'x' }, fingerprint: 'fp', observedAt: CHECKED_AT, attempt: { at: CHECKED_AT },
    installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, reason: 'newer-version',
    action: { kind: 'operation', start: { route: `/api/updates/${encodeURIComponent(over.id)}/apply` }, impact: ['download'] },
    ...over,
  }
}

const PLUGIN = record({ id: 'plugin:notes', subject: { kind: 'plugin', id: 'notes', label: 'notes' } })
const ENGINE = record({ id: 'search-engine:antfly', group: 'required', subject: { kind: 'search-engine', id: 'antfly', label: 'Search engine' }, reason: 'pin-mismatch',
  action: { kind: 'operation', start: { route: '/api/updates/search-engine%3Aantfly/apply' }, impact: ['download', 'search-interruption', 'reindex'], downloadBytes: 48_300_000 } })
const BAKIN = record({ id: 'bakin:bakin', subject: { kind: 'bakin', id: 'bakin', label: 'Bakin' }, notesUrl: 'https://example.test/notes',
  installed: { version: '0.3.5', display: 'v0.3.5' }, available: { version: '0.3.6', display: 'v0.3.6' }, action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] } })
const SKIPPED = record({ id: 'plugin:terminal', subject: { kind: 'plugin', id: 'terminal', label: 'terminal' }, skipped: { version: '1.1.0' } })
const MANUAL = record({ id: 'gateway:openclaw', group: 'required', subject: { kind: 'gateway', id: 'openclaw', label: 'OpenClaw gateway' }, reason: 'below-floor', action: { kind: 'manual', pointer: 'Upgrade the runtime, then restart it.' } })
const UNKNOWN = record({ id: 'hub-skill:x', subject: { kind: 'hub-skill', id: 'x', label: 'x' }, outcome: 'unknown', observedAt: undefined, available: undefined, reason: undefined, action: undefined, attempt: { at: CHECKED_AT, error: 'hub: 503' } })
const CURRENT = record({ id: 'plugin:assets', subject: { kind: 'plugin', id: 'assets', label: 'assets' }, outcome: 'current', available: undefined, reason: undefined, action: undefined })

function resource(records: UpdateRecord[] | null, over: Partial<UseHealthResourceResult<UpdatesData>> = {}): UseHealthResourceResult<UpdatesData> {
  return {
    data: records ? { records, generatedAt: CHECKED_AT, running: false } : null,
    error: null, backgroundError: null, loading: records === null, refreshing: false,
    refresh: mock(async () => null),
    ...over,
  }
}

/** The tab with its real actions over a scripted fetch; `onShowSkippedChange` is wired to state. */
function Harness({ updates, showSkipped: initial = false, focusId }: { updates: UseHealthResourceResult<UpdatesData>; showSkipped?: boolean; focusId?: string }) {
  const actions = useUpdatesActions(updates)
  return <UpdatesTabView updates={updates} actions={actions} showSkipped={initial} onShowSkippedChange={() => {}} focusId={focusId ?? null} now={NOW} />
}

describe('UpdatesTabView — rows and groups (#1007 D7.14)', () => {
  it('groups required before available, labels every outcome in words, and hides skipped rows by default', () => {
    render(<Harness updates={resource([PLUGIN, ENGINE, BAKIN, SKIPPED, MANUAL, UNKNOWN, CURRENT])} />)
    const required = screen.getByTestId('updates-required')
    const available = screen.getByTestId('updates-available')
    expect(within(required).getAllByRole('listitem').map((row) => row.getAttribute('data-update-id'))).toEqual(['gateway:openclaw', 'search-engine:antfly'])
    expect(within(available).getAllByRole('listitem').map((row) => row.getAttribute('data-update-id'))).toEqual(['bakin:bakin', 'notes', 'hub-skill:x'].map((id) => id === 'notes' ? 'plugin:notes' : id))
    // Current subjects are not rows; the skipped one is behind the toggle.
    expect(screen.queryByText('assets')).toBeNull()
    expect(document.querySelector('[data-update-id="plugin:terminal"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show 1 skipped' }).getAttribute('aria-pressed')).toBe('false')
    // Badges carry the state in words.
    expect(within(required).getAllByText('Required')).toHaveLength(2)
    expect(within(available).getByText('Could not check')).toBeDefined()
    expect(within(available).getByText(/The last check failed: hub: 503/)).toBeDefined()
    // A manual action has no Update button; its pointer is the row's detail.
    expect(within(required).queryByRole('button', { name: 'Update OpenClaw gateway' })).toBeNull()
    expect(within(required).getByText(/Upgrade the runtime, then restart it\./)).toBeDefined()
    expect(within(required).getByRole('button', { name: 'Update Search engine' })).toBeDefined()
    // Required updates cannot be skipped; optional ones can.
    expect(within(required).queryByRole('button', { name: /^Skip/ })).toBeNull()
    expect(within(available).getByRole('button', { name: 'Skip notes 1.1.0' })).toBeDefined()
    expect(within(available).getByRole('button', { name: 'Update notes' })).toBeDefined()
    expect(within(available).getByRole('link', { name: 'Release notes for Bakin' }).getAttribute('href')).toBe('https://example.test/notes')
    expect(within(available).getByText('v0.3.5 → v0.3.6')).toBeDefined()
    expect(within(available).getAllByText(/Checked 7m ago/).length).toBeGreaterThan(0)
  })

  it('shows skipped rows on request, labelled Skipped and without Skip', () => {
    render(<Harness updates={resource([PLUGIN, SKIPPED])} showSkipped />)
    const row = document.querySelector('[data-update-id="plugin:terminal"]') as HTMLElement
    expect(within(row).getByText('Skipped')).toBeDefined()
    expect(within(row).queryByRole('button', { name: /^Skip/ })).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Update terminal' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hide skipped' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('renders loading, unavailable (with retry) and all-current states honestly', async () => {
    const loading = resource(null)
    render(<Harness updates={loading} />)
    expect(screen.getByText('Reading update records')).toBeDefined()
    cleanup()

    const failed = resource(null, { loading: false, error: 'The updates engine has not started on this server.' })
    render(<Harness updates={failed} />)
    expect(screen.getByText('Updates are unavailable')).toBeDefined()
    expect(screen.getByText('The updates engine has not started on this server.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(failed.refresh).toHaveBeenCalledWith('explicit')
    cleanup()

    render(<Harness updates={resource([CURRENT, SKIPPED])} />)
    expect(screen.getByText('Everything is current')).toBeDefined()
    expect(screen.getByText('2 subjects checked, last 7m ago. 1 skipped update is hidden.')).toBeDefined()
  })

  it('a deep link moves focus to the row\'s first control (rows themselves stay out of the tab order)', async () => {
    render(<Harness updates={resource([PLUGIN, BAKIN])} focusId="plugin:notes" />)
    await waitFor(() => expect(document.activeElement?.closest('[data-update-id]')?.getAttribute('data-update-id')).toBe('plugin:notes'))
    expect(document.activeElement?.tagName).toBe('BUTTON')
    expect(document.querySelectorAll('[data-update-id][tabindex]')).toHaveLength(0)
  })

  it('a standing observation with a LATER failed attempt says so on the row', () => {
    const stale = record({ ...PLUGIN, observedAt: CHECKED_AT, attempt: { at: '2026-10-20T11:58:00.000Z', error: 'inventory check failed: lockfile unreadable' } })
    render(<Harness updates={resource([stale])} />)
    expect(screen.getByText(/Checked 7m ago · the last check failed: inventory check failed: lockfile unreadable/)).toBeDefined()
    expect(screen.getByRole('button', { name: 'Update notes' })).toBeDefined()
  })

  it('a CURRENT subject whose latest check failed is still shown with the failure — never folded into "Everything is current" (review r7 #4)', () => {
    const current = record({ ...CURRENT, observedAt: CHECKED_AT, attempt: { at: '2026-10-20T11:58:00.000Z', error: 'check timed out after 20s' } })
    render(<Harness updates={resource([current])} />)
    expect(screen.queryByText('Everything is current')).toBeNull()
    expect(screen.getByText('Current')).toBeDefined()
    expect(screen.getByText(/Checked 7m ago · the last check failed: check timed out after 20s/)).toBeDefined()
    expect(screen.getByText(/Nothing newer was published as of the last successful check; the latest check failed./)).toBeDefined()
    expect(screen.queryByRole('button', { name: /^Update / })).toBeNull()
    expect(visibleUpdateRecords([current, CURRENT], 'available', false).map((r) => r.id)).toEqual([current.id])
    // The heading counts UPDATES (none) and names the failed check; the tone is neutral (review r8 #3).
    expect(screen.getByRole('heading', { level: 2, name: 'Available (0 updates, 1 check failed)' })).toBeDefined()
  })

  it('group headings count updates, never the rows kept visible for a failed check or a block (review r8 #3)', () => {
    const failedRequired = record({ ...ENGINE, outcome: 'current', available: undefined, reason: undefined, action: undefined, observedAt: CHECKED_AT, attempt: { at: '2026-10-20T11:58:00.000Z', error: 'probe timed out' } })
    const blocked = record({ ...PLUGIN, id: 'plugin:blocked', subject: { kind: 'plugin', id: 'blocked', label: 'blocked' }, outcome: 'blocked', available: undefined, action: undefined, blockedReason: 'no release runs here' })
    render(<Harness updates={resource([failedRequired, PLUGIN, blocked])} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Required (0 updates, 1 check failed)' })).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Available (1 update, 1 blocked)' })).toBeDefined()
    expect(groupHeading('Required', [ENGINE]).label).toBe('Required (1)')
    expect(groupHeading('Required', [ENGINE]).tone).toBe('danger')
    expect(groupHeading('Required', [failedRequired]).tone).toBe('neutral')
    expect(groupHeading('Available', [PLUGIN, blocked]).tone).toBe('accent')
    // A subject nobody has looked at yet is "not checked yet", never a failed check (review r9 #4).
    const unchecked = record({ ...PLUGIN, id: 'plugin:fresh', subject: { kind: 'plugin', id: 'fresh', label: 'fresh' }, outcome: 'unknown', available: undefined, reason: undefined, action: undefined, observedAt: undefined, attempt: undefined })
    const failedUnknown = record({ ...unchecked, id: 'plugin:failing', subject: { kind: 'plugin', id: 'failing', label: 'failing' }, attempt: { at: '2026-10-20T11:58:00.000Z', error: 'ls-remote failed' } })
    expect(groupHeading('Available', [unchecked]).label).toBe('Available (0 updates, 1 not checked yet)')
    expect(groupHeading('Available', [unchecked, failedUnknown, PLUGIN]).label).toBe('Available (1 update, 1 check failed, 1 not checked yet)')
  })

  it('presentation + visibility helpers are pure and total', () => {
    expect(presentUpdateRecord(CURRENT).label).toBe('Current')
    expect(presentUpdateRecord(record({ ...PLUGIN, outcome: 'unsupported', blockedReason: 'source checkout' })).label).toBe('Not supported here')
    expect(presentUpdateRecord(record({ ...PLUGIN, outcome: 'blocked', blockedReason: 'no release runs here' })).detail).toBe('no release runs here')
    expect(visibleUpdateRecords([PLUGIN, SKIPPED, CURRENT, ENGINE], 'available', false).map((r) => r.id)).toEqual(['plugin:notes'])
    expect(visibleUpdateRecords([PLUGIN, SKIPPED, CURRENT, ENGINE], 'available', true).map((r) => r.id)).toEqual(['plugin:notes', 'plugin:terminal'])
  })
})

describe('UpdatesTabView — check and skip', () => {
  it('"Check for updates" runs a waited pass, re-reads the records, and reports a failed check', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let fail = false
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === '/api/updates/check?wait=1') return fail ? json({ error: 'updates_unavailable', message: 'engine down' }, 503) : json({ bootId: 'b', ids: ['plugin:notes'], coalesced: false, records: [] })
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const updates = resource([PLUGIN])
    render(<Harness updates={updates} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check for updates' })) })
    await waitFor(() => expect(updates.refresh).toHaveBeenCalledWith('background'))
    expect(calls[0]?.init?.method).toBe('POST')
    expect(screen.queryByTestId('updates-feedback')).toBeNull()

    fail = true
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check for updates' })) })
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('Could not check for updates: engine down'))
  })

  it('Skip hides the available identity and says so', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/updates/plugin%3Anotes/skip' && init?.method === 'POST') return json({ bootId: 'b', record: { ...PLUGIN, skipped: { version: '1.1.0' } } })
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const updates = resource([PLUGIN])
    render(<Harness updates={updates} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Skip notes 1.1.0' })) })
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('notes 1.1.0 stays hidden until something newer appears.'))
    expect(updates.refresh).toHaveBeenCalledWith('background')
  })
})

describe('UpdatesTabView — apply, the whole flow inside the dialog', () => {
  it('previews impact + a covering approval, applies with that approval scope, follows the operation to done', async () => {
    const operations = new Map([['op-1', finishedOperation('op-1', { httpStatus: 200, body: { ok: true } }, { title: 'Reinstall the search engine', outcome: { code: 'ok' } })]])
    const bodies: unknown[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const op = operationResponse(url, operations)
      if (op) return op
      if (url === '/api/updates/search-engine%3Aantfly/apply-preview') {
        return json({ bootId: 'b', preview: { id: ENGINE.id, record: ENGINE, action: ENGINE.action, approval: {
          approvalId: 'apr-1', taskId: 'task-1', title: 'Repair the search engine', incidentIds: ['inc-1'], observationIds: ['obs-1'], subjectIds: [ENGINE.id], scopeHash: 'hash-1',
          items: [{ actionId: 'install-search', itemId: 'install-search', safety: 'manual', changes: [{ kind: 'file', target: 'antfly', action: 'install', description: 'Install antfly v0.2.5 into ~/.bakin/antfly.' }] }],
        } } })
      }
      if (url === '/api/updates/search-engine%3Aantfly/apply' && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)))
        expect(new Headers(init.headers).get('X-Bakin-Operator')).toBe('declared')
        return operationStarted('op-1')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const updates = resource([ENGINE])
    render(<Harness updates={updates} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Search engine' })) })
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Update Search engine?')).toBeDefined()
    await waitFor(() => expect(within(dialog).getByTestId('update-apply-approval')).toBeDefined())
    expect(within(dialog).getByText(/Applying approves the pending Health repair “Repair the search engine” in full/)).toBeDefined()
    expect(within(dialog).getByText('Install antfly v0.2.5 into ~/.bakin/antfly.')).toBeDefined()
    const impacts = within(dialog).getByRole('list', { name: 'What this update does' })
    expect(within(impacts).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Downloads an artifact from its pinned source and verifies it.',
      'Search is unavailable while the engine is replaced.',
      'Search indexes are rebuilt afterwards; results may be partial until that converges.',
      'Download size: 48.3 MB.',
    ])

    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    // The identity on screen (the preview's record) is what the apply must install (R2 #1).
    expect(bodies).toEqual([{ approvalId: 'apr-1', scopeHash: 'hash-1', target: { version: '1.1.0' } }])
    // Resolving the covering approval ran the REPAIR, so the outcome is the repair's — never decoded as the subject's own flow.
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('Applied the Health repair “Repair the search engine”.'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(updates.refresh).toHaveBeenCalledWith('background')
  })

  it('a plugin upgrade that widens permissions asks for consent inside the dialog, then commits with its token', async () => {
    const operations = new Map([
      ['op-preview', finishedOperation('op-preview', { httpStatus: 200, body: { ok: false, awaitingConsent: true, noop: false, declaredPermissions: ['storage.write'], declaredBins: [], consentToken: 'tok-1' } })],
      ['op-commit', finishedOperation('op-commit', { httpStatus: 200, body: { ok: true, noop: false, awaitingConsent: false, declaredPermissions: ['storage.write'] } })],
    ])
    const bodies: Array<Record<string, unknown>> = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const op = operationResponse(url, operations)
      if (op) return op
      if (url === '/api/updates/plugin%3Anotes/apply-preview') return json({ bootId: 'b', preview: { id: PLUGIN.id, record: PLUGIN, action: PLUGIN.action } })
      if (url === '/api/updates/plugin%3Anotes/apply' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        bodies.push(body)
        return operationStarted(body.consentToken ? 'op-commit' : 'op-preview')
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    render(<Harness updates={resource([PLUGIN])} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update notes' })) })
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByTestId('update-apply-confirm').textContent).toBe('Update'))
    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(within(dialog).getByTestId('update-apply-consent')).toBeDefined())
    expect(within(dialog).getByText('This update requests permissions.')).toBeDefined()
    expect(within(dialog).getByText('Permissions: storage.write.')).toBeDefined()
    expect(screen.getByTestId('update-apply-confirm').textContent).toBe('Approve and update')

    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('notes was updated and reactivated.'))
    expect(bodies).toEqual([{ target: { version: '1.1.0' } }, { consentToken: 'tok-1', target: { version: '1.1.0' } }])
  })

  it('a refused start keeps the dialog open with the server\'s reason; closing it returns to the list', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/updates/plugin%3Anotes/apply-preview') return json({ bootId: 'b', preview: { id: PLUGIN.id, record: PLUGIN, action: PLUGIN.action } })
      if (url === '/api/updates/plugin%3Anotes/apply' && init?.method === 'POST') return json({ bootId: 'b', error: 'scope_changed', message: 'The approval scope changed since the preview — review it again.' }, 409)
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    render(<Harness updates={resource([PLUGIN])} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update notes' })) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByTestId('update-apply-confirm').textContent).toBe('Update'))
    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('scope_changed'))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByTestId('updates-feedback')).toBeNull()
  })

  it('a Bakin update hands off at the restart and reports the explicit verification', async () => {
    let versionReads = 0
    const restarting = finishedOperation('op-b', { httpStatus: 200, body: {} }, {
      status: 'running', endedAt: undefined, outcome: undefined, result: undefined, title: 'Update Bakin',
      plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download' }, { id: 'restarting', kind: 'verifying', label: 'Restarting' }], pointOfNoReturn: 'restarting' },
      stages: [{ id: 'download', kind: 'downloading', label: 'Download', status: 'done' }, { id: 'restarting', kind: 'verifying', label: 'Restarting', status: 'active' }],
    })
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/operations/op-b')) return json({ bootId: 'boot-test', operation: restarting, children: [] })
      if (url === '/api/updates/bakin%3Abakin/apply-preview') return json({ bootId: 'b', preview: { id: BAKIN.id, record: BAKIN, action: BAKIN.action } })
      if (url === '/api/updates/bakin%3Abakin/apply' && init?.method === 'POST') return operationStarted('op-b')
      if (url === '/api/version') {
        versionReads += 1
        return json(versionReads < 2 ? { version: '0.3.5', bootId: 'boot-test', state: 'stopping' } : { version: '0.3.6', bootId: 'boot-new', state: 'serving' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    render(<Harness updates={resource([BAKIN])} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Bakin' })) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByTestId('update-apply-confirm').textContent).toBe('Update'))
    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('Bakin was updated to v0.3.6 and verified. Reload to use the new version.'), { timeout: 10_000 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('UpdatesTabView — review round 2 (#8, #9 of round 1 pinned)', () => {
  const REPAIR_OK = { httpStatus: 200, body: { ok: true, applied: 1, items: [{ id: 'upgrade-plugin-artifact', status: 'applied' }] } }

  it('a plugin apply that resolved a covering approval settles on the REPAIR: a repair-shaped success is done, a failed repair is the failure — never decoded as the upgrader\'s consent/noop fields', async () => {
    const operations = new Map([
      ['op-repair', finishedOperation('op-repair', REPAIR_OK, { title: 'Apply 1 Health repair', outcome: { code: 'ok' } })],
      ['op-broken', finishedOperation('op-broken', { httpStatus: 200, body: { ok: false, items: [] } }, { title: 'Apply 1 Health repair', status: 'failed', outcome: { code: 'repair_failed', message: 'The artifact failed verification after download.' } })],
    ])
    let next = 'op-repair'
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const op = operationResponse(url, operations)
      if (op) return op
      if (url === '/api/updates/plugin%3Anotes/apply-preview') {
        return json({ bootId: 'b', preview: { id: PLUGIN.id, record: PLUGIN, action: PLUGIN.action, approval: { approvalId: 'apr-2', taskId: 'task-2', title: 'Upgrade notes to a release this Bakin can run', incidentIds: ['inc-2'], observationIds: ['obs-2'], subjectIds: [PLUGIN.id], scopeHash: 'hash-2', items: [{ actionId: 'upgrade-plugin-artifact', itemId: 'upgrade-plugin-artifact', safety: 'manual', changes: [{ kind: 'file', target: 'notes', action: 'update', description: 'Upgrade notes 1.0.0 → 1.1.0.' }] }] } } })
      }
      if (url === '/api/updates/plugin%3Anotes/apply' && init?.method === 'POST') return operationStarted(next)
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    render(<Harness updates={resource([PLUGIN])} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update notes' })) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByTestId('update-apply-approval')).toBeDefined())
    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('Applied the Health repair “Upgrade notes to a release this Bakin can run”.'))
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    next = 'op-broken'
    render(<Harness updates={resource([PLUGIN])} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update notes' })) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByTestId('update-apply-approval')).toBeDefined())
    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('The artifact failed verification after download.'))
    expect(screen.queryByTestId('updates-feedback')).toBeNull()
  })

  it('the Bakin verification settles the apply through a parent-owned refresh without a render-phase update (#9)', async () => {
    const warnings: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); originalError(...args) }
    let versionReads = 0
    const restarting = finishedOperation('op-b', { httpStatus: 200, body: {} }, {
      status: 'running', endedAt: undefined, outcome: undefined, result: undefined, title: 'Update Bakin',
      plan: { stages: [{ id: 'download', kind: 'downloading', label: 'Download' }, { id: 'restarting', kind: 'verifying', label: 'Restarting' }], pointOfNoReturn: 'restarting' },
      stages: [{ id: 'download', kind: 'downloading', label: 'Download', status: 'done' }, { id: 'restarting', kind: 'verifying', label: 'Restarting', status: 'active' }],
    })
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/operations/op-b')) return json({ bootId: 'boot-test', operation: restarting, children: [] })
      if (url === '/api/updates/bakin%3Abakin/apply-preview') return json({ bootId: 'b', preview: { id: BAKIN.id, record: BAKIN, action: BAKIN.action } })
      if (url === '/api/updates/bakin%3Abakin/apply' && init?.method === 'POST') return operationStarted('op-b')
      if (url === '/api/version') { versionReads += 1; return json(versionReads < 2 ? { version: '0.3.5', bootId: 'boot-test', state: 'stopping' } : { version: '0.3.6', bootId: 'boot-new', state: 'serving' }) }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    // A parent that owns the records and re-renders on every refresh — what the Health page does.
    function Page() {
      const [refreshes, setRefreshes] = useState(0)
      const updates = { ...resource([BAKIN]), refresh: mock(async () => { setRefreshes((n) => n + 1); return null }) }
      return <div><span data-testid="refreshes">{refreshes}</span><Harness updates={updates} /></div>
    }
    try {
      render(<Page />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Bakin' })) })
      await screen.findByRole('dialog')
      await waitFor(() => expect(screen.getByTestId('update-apply-confirm').textContent).toBe('Update'))
      await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
      await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('Bakin was updated to v0.3.6 and verified. Reload to use the new version.'), { timeout: 10_000 })
      await waitFor(() => expect(screen.getByTestId('refreshes').textContent).toBe('1'))
      expect(warnings.filter((w) => w.includes('Cannot update a component'))).toEqual([])
    } finally {
      console.error = originalError
    }
  })
})

describe('UpdatesTabView — review round 3 (#6)', () => {
  it('verifies the version the PREVIEW offered (what was applied), not the row the list showed', async () => {
    const previewed = { ...BAKIN, available: { version: '0.3.7', display: 'v0.3.7' } }
    let versionReads = 0
    const restarting = finishedOperation('op-b', { httpStatus: 200, body: {} }, {
      status: 'running', endedAt: undefined, outcome: undefined, result: undefined, title: 'Update Bakin',
      plan: { stages: [{ id: 'restarting', kind: 'verifying', label: 'Restarting' }], pointOfNoReturn: 'restarting' },
      stages: [{ id: 'restarting', kind: 'verifying', label: 'Restarting', status: 'active' }],
    })
    const bodies: unknown[] = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/operations/op-b')) return json({ bootId: 'boot-test', operation: restarting, children: [] })
      if (url === '/api/updates/bakin%3Abakin/apply-preview') return json({ bootId: 'b', preview: { id: BAKIN.id, record: previewed, action: BAKIN.action } })
      if (url === '/api/updates/bakin%3Abakin/apply' && init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return operationStarted('op-b') }
      if (url === '/api/version') { versionReads += 1; return json(versionReads < 2 ? { version: '0.3.5', bootId: 'boot-test', state: 'stopping' } : { version: '0.3.7', bootId: 'boot-new', state: 'serving' }) }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    render(<Harness updates={resource([BAKIN])} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update Bakin' })) })
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByTestId('update-apply-confirm').textContent).toBe('Update'))
    await act(async () => { fireEvent.click(screen.getByTestId('update-apply-confirm')) })
    await waitFor(() => expect(screen.getByTestId('updates-feedback').textContent).toBe('Bakin was updated to v0.3.7 and verified. Reload to use the new version.'), { timeout: 10_000 })
    expect(bodies).toEqual([{ target: { version: '0.3.7' } }])
  })
})
