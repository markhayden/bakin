/**
 * `bakin updates [--check] | updates skip | updates apply` (#1007 D7.15):
 * request shapes, output, the consent loop and the operator refusal — with
 * the HTTP client, the operation follow and the exits mocked.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UpdateRecord } from '@makinbakin/sdk/types'

const testHome = join(tmpdir(), `bakin-cli-updates-${Date.now()}`)
process.env.BAKIN_HOME = testHome
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), media: join(testHome, 'media') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), media: join(testHome, 'media') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testHome, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testHome, 'openclaw', ...parts), resetOpenClawHome: () => {} }))
afterAll(() => rmSync(testHome, { recursive: true, force: true }))

function record(over: Partial<UpdateRecord> & Pick<UpdateRecord, 'id' | 'subject'>): UpdateRecord {
  return {
    group: 'available', outcome: 'update-available', source: { kind: 'test', endpoint: 'x' }, fingerprint: 'fp', observedAt: '2026-10-20T11:00:00.000Z',
    installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, reason: 'newer-version',
    action: { kind: 'operation', start: { route: `/api/updates/${encodeURIComponent(over.id)}/apply` }, impact: ['download'] },
    ...over,
  }
}
const PLUGIN = record({ id: 'plugin:notes', subject: { kind: 'plugin', id: 'notes', label: 'notes' } })
const ENGINE = record({ id: 'search-engine:antfly', group: 'required', subject: { kind: 'search-engine', id: 'antfly', label: 'Search engine' }, reason: 'pin-mismatch', action: { kind: 'operation', start: { route: '/api/updates/search-engine%3Aantfly/apply' }, impact: ['download', 'search-interruption', 'reindex'] } })
const SKIPPED = record({ id: 'plugin:terminal', subject: { kind: 'plugin', id: 'terminal', label: 'terminal' }, skipped: { version: '1.1.0' } })
const MANUAL = record({ id: 'gateway:openclaw', group: 'required', subject: { kind: 'gateway', id: 'openclaw', label: 'OpenClaw gateway' }, action: { kind: 'manual', pointer: 'Upgrade the runtime.' } })
const CURRENT = record({ id: 'plugin:assets', subject: { kind: 'plugin', id: 'assets', label: 'assets' }, outcome: 'current', available: undefined, action: undefined })

let records: UpdateRecord[] = []
let serverRunning = true
let preview: Record<string, unknown> = {}
let applyAnswers: Array<{ status: number; body: Record<string, unknown> }> = []
let followBodies: Array<Record<string, unknown>> = []
const calls: Array<{ method: string; path: string; body?: unknown }> = []
const printed: unknown[] = []
const tables: unknown[] = []
const logs: string[] = []
class ExitCalled extends Error { constructor(readonly code: string) { super(code) } }

class NotRunning extends Error { constructor() { super('not running'); this.name = 'BakinNotRunningError' } }
mock.module('../../src/cli/http', () => ({
  BakinNotRunningError: NotRunning,
  isServerConnectionError: (err: unknown) => err instanceof NotRunning,
  jsonObject: (value: unknown) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null),
  apiGet: mock(async (path: string) => {
    if (!serverRunning) throw new NotRunning()
    calls.push({ method: 'GET', path })
    if (path === '/api/updates') return { records, generatedAt: '2026-10-20T11:05:00.000Z', running: false }
    if (path.endsWith('/apply-preview')) return { preview }
    throw new Error(`unexpected GET ${path}`)
  }),
  apiPost: mock(async (path: string, body?: unknown) => {
    if (!serverRunning) throw new NotRunning()
    calls.push({ method: 'POST', path, body })
    if (path.startsWith('/api/updates/check')) return { ids: records.map((r) => r.id), coalesced: false }
    if (path.endsWith('/skip')) return { record: { ...PLUGIN, skipped: { version: '1.1.0' } } }
    throw new Error(`unexpected POST ${path}`)
  }),
  cliFetch: mock(async (path: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const answer = applyAnswers.shift() ?? { status: 202, body: { operationId: 'op-1', bootId: 'boot-1' } }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } })
  }),
}))
mock.module('../../src/cli/operation-command', () => ({
  startAndFollow: mock(async (start: () => Promise<unknown>) => {
    await start()
    // Like the real follow: the exit code is the OPERATION's outcome (a preview that
    // stops for consent succeeded), never the body's `ok`.
    const body = followBodies.shift() ?? { ok: true, message: 'notes was updated and reactivated.' }
    return { follow: { phase: 'finished', operation: null, children: [] }, body, httpStatus: 200, exitCode: body.failed === true ? 1 : 0 }
  }),
  operationBody: (operation: { body: Record<string, unknown> | null }) => operation.body ?? { ok: false, error: 'no result' },
}))
mock.module('../../src/cli/output', () => ({ print: (value: unknown) => { printed.push(value) }, printTable: (rows: unknown) => { tables.push(rows) } }))
mock.module('../../src/cli/help', () => ({
  exitUsage: mock(async (_usage: string, detail?: string): Promise<never> => { throw new ExitCalled(`usage:${detail ?? ''}`) }),
  exitUnknownSubcommand: mock(async (): Promise<never> => { throw new ExitCalled('unknown') }),
  exitCommandFailure: mock(async (_message: string, options?: { code?: string }): Promise<never> => { throw new ExitCalled(options?.code ?? 'COMMAND_FAILED') }),
  confirmPrompt: mock(async () => false),
}))
let inProcessChecks: Array<Record<string, unknown>> = []
mock.module('../../src/core/updates/sources', () => ({ registerCoreUpdateSources: () => {} }))
mock.module('../../src/core/runtime-adapter-factory', () => ({ createRuntimeAdapter: () => ({ name: 'mock' }) }))
mock.module('../../packages/core/src/settings', () => ({ readRuntimeAdapterStrict: () => 'pi' }))
mock.module('../../src/core/updates/service', () => ({
  startUpdates: () => ({ ready: Promise.resolve(), snapshot: async () => ({ records: [ENGINE], generatedAt: 'x', running: false }) }),
  stopUpdates: () => {},
  getUpdatesTimer: () => ({ check: async (request: Record<string, unknown>) => { inProcessChecks.push(request); return { ids: [], coalesced: false } } }),
}))
let selfUpdateResult: Record<string, unknown> = { kind: 'verified', message: 'Updated to 0.3.6 and verified.' }
mock.module('../../src/core/updates/self-update-cli', () => ({ runUpdateCommand: mock(async () => selfUpdateResult) }))

import { run } from '../../src/cli/commands/updates'

const originalLog = console.log
const originalExit = process.exit
// A stray `process.exit` would kill the runner silently; surface it as a failure instead.
process.exit = ((code?: number) => { throw new ExitCalled(`exit:${code ?? 0}`) }) as typeof process.exit
beforeEach(() => {
  records = [PLUGIN, ENGINE, SKIPPED, MANUAL, CURRENT]
  serverRunning = true
  preview = { id: PLUGIN.id, record: PLUGIN, action: PLUGIN.action }
  applyAnswers = []
  followBodies = []
  inProcessChecks = []
  calls.length = 0
  printed.length = 0
  tables.length = 0
  logs.length = 0
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
})
afterAll(() => { console.log = originalLog; process.exit = originalExit })

const exitCode = async (promise: Promise<unknown>): Promise<string | null> => {
  try {
    await promise
    return null
  } catch (error) {
    if (error instanceof ExitCalled) return error.code
    throw error
  }
}

describe('bakin updates', () => {
  it('lists every subject with its state in words, required first; --json prints the raw snapshot', async () => {
    await run(['updates'])
    expect(calls).toEqual([{ method: 'GET', path: '/api/updates' }])
    expect(logs[0]).toBe('5 subjects — 2 required, 1 available')
    const rows = tables[0] as Array<Record<string, string>>
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ['gateway:openclaw', 'REQUIRED'],
      ['search-engine:antfly', 'REQUIRED'],
      ['plugin:assets', 'current'],
      ['plugin:notes', 'available'],
      ['plugin:terminal', 'skipped'],
    ])
    expect(rows.find((r) => r.id === 'gateway:openclaw')?.detail).toBe('Upgrade the runtime.')
    expect(rows.find((r) => r.id === 'plugin:notes')?.versions).toBe('1.0.0 → 1.1.0')
    expect(logs.at(-1)).toBe('\nApply one with: bakin updates apply <id> --as human')

    calls.length = 0
    await run(['updates', '--json'])
    expect(printed[0]).toMatchObject({ records, running: false })
  })

  it('--check runs a waited pass first (optionally one --source kind), then lists', async () => {
    await run(['updates', '--check'])
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/updates/check?wait=1', 'GET /api/updates'])
    calls.length = 0
    await run(['updates', '--check', '--source', 'plugin'])
    expect(calls[0]?.path).toBe('/api/updates/check?wait=1&source=plugin')
    expect(await exitCode(run(['updates', '--check', '--source', 'nope']))).toBe('usage:--source must be one of bakin, plugin, package, hub-skill, search-engine, search-models, gateway')
  })

  it('with no server, --check runs the engine in-process over this home; a plain list says to start Bakin', async () => {
    serverRunning = false
    expect(await exitCode(run(['updates']))).toBe('SERVER_UNAVAILABLE')
    await run(['updates', '--check', '--source', 'search-engine'])
    expect(inProcessChecks).toEqual([{ kind: 'search-engine' }])
    expect(logs[0]).toBe('1 subject — 1 required, 0 available')
  })

  it('skip posts to the engine and says what stays hidden', async () => {
    await run(['updates', 'skip', 'plugin:notes'])
    expect(calls).toEqual([{ method: 'POST', path: '/api/updates/plugin%3Anotes/skip', body: undefined }])
    expect(logs[0]).toBe('notes 1.1.0 stays hidden until something newer appears.')
    expect(await exitCode(run(['updates', 'skip']))).toBe('usage:skip needs an update id (see `bakin updates`)')
  })
})

describe('bakin updates apply', () => {
  it('previews, asks (or takes --yes), posts the apply with the identity plumbing, and follows the operation', async () => {
    expect(await exitCode(run(['updates', 'apply', 'plugin:notes']))).toBe('NOT_CONFIRMED')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/updates/plugin%3Anotes/apply-preview'])
    calls.length = 0
    logs.length = 0

    await run(['updates', 'apply', 'plugin:notes', '--yes'])
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/updates/plugin%3Anotes/apply-preview', 'POST /api/updates/plugin%3Anotes/apply'])
    expect(calls[1]?.body).toEqual({})
    expect(logs[0]).toBe('Update notes: 1.0.0 → 1.1.0')
    expect(logs[1]).toBe('  - Downloads an artifact from its pinned source and verifies it.')
    expect(logs.at(-1)).toBe('notes was updated and reactivated.')
  })

  it('a covering Health approval is shown in full and sent as the apply scope', async () => {
    preview = { id: ENGINE.id, record: ENGINE, action: ENGINE.action, approval: { approvalId: 'apr-1', title: 'Repair the search engine', scopeHash: 'hash-1', items: [{ changes: [{ description: 'Install antfly v0.2.5.' }] }] } }
    followBodies = [{ ok: true, result: { message: 'installed' } }]
    await run(['updates', 'apply', 'search-engine:antfly', '--yes'])
    expect(calls[1]?.body).toEqual({ approvalId: 'apr-1', scopeHash: 'hash-1' })
    expect(logs).toContain('  Applying approves the pending Health repair "Repair the search engine" in full:')
    expect(logs).toContain('    - Install antfly v0.2.5.')
    expect(logs.at(-1)).toBe('Search engine was updated.')
    // A failed operation exits non-zero after its outcome line.
    followBodies = [{ ok: false, failed: true, error: 'reindex_failed' }]
    expect(await exitCode(run(['updates', 'apply', 'search-engine:antfly', '--yes']))).toBe('exit:1')
  })

  it('a plugin preview that asks for consent is answered by --yes with its token; a ready preview commits at once', async () => {
    followBodies = [
      { ok: false, awaitingConsent: true, consentToken: 'tok-1', declaredPermissions: ['storage.write'], declaredBins: [{ name: 'rg', version: '14.1.0' }] },
      { ok: true, message: 'notes was updated and reactivated.' },
    ]
    await run(['updates', 'apply', 'plugin:notes', '--yes'])
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{}, { consentToken: 'tok-1' }])
    expect(logs).toContain('  permissions: storage.write')
    expect(logs).toContain('  binaries: rg 14.1.0')

    calls.length = 0
    followBodies = [{ ok: true, ready: true, consentToken: 'tok-ready' }, { ok: true, message: 'done' }]
    await run(['updates', 'apply', 'plugin:notes', '--yes'])
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([{}, { consentToken: 'tok-ready' }])
  })

  it('an undeclared operator is refused by the server; the CLI says to pass --as human', async () => {
    applyAnswers = [{ status: 403, body: { error: 'approval_decision', message: 'needs a declared operator', refusalCode: 'undeclared' } }]
    expect(await exitCode(run(['updates', 'apply', 'plugin:notes', '--yes']))).toBe('OPERATOR_REQUIRED')
  })

  it('a current, blocked or manual subject is refused before anything starts', async () => {
    preview = { id: CURRENT.id, record: CURRENT }
    expect(await exitCode(run(['updates', 'apply', 'plugin:assets', '--yes']))).toBe('NOTHING_TO_APPLY')
    preview = { id: MANUAL.id, record: MANUAL, action: MANUAL.action }
    expect(await exitCode(run(['updates', 'apply', 'gateway:openclaw', '--yes']))).toBe('MANUAL_ACTION')
    expect(calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('the Bakin binary rides `bakin update`\'s own path', async () => {
    await run(['updates', 'apply', 'bakin:bakin'])
    expect(calls).toEqual([])
    expect(logs).toEqual(['Updated to 0.3.6 and verified.'])
    selfUpdateResult = { kind: 'failed', code: 'OPERATOR_REQUIRED', message: 'Updating Bakin is an operator action.', detail: 'Run it as the operator: bakin update --as human' }
    expect(await exitCode(run(['updates', 'apply', 'bakin:bakin']))).toBe('OPERATOR_REQUIRED')
  })
})

describe('review round 1 — JSON output still exits non-zero on failure (#12)', () => {
  it('bakin:bakin under --json prints the result document AND fails the command', async () => {
    selfUpdateResult = { kind: 'failed', code: 'UPDATE_FAILED', message: 'Checksum mismatch', detail: 'update_failed' }
    expect(await exitCode(run(['updates', 'apply', 'bakin:bakin', '--json']))).toBe('UPDATE_FAILED')
    expect(printed).toEqual([selfUpdateResult])
    printed.length = 0
    selfUpdateResult = { kind: 'verified', message: 'Updated to 0.3.6 and verified.' }
    expect(await exitCode(run(['updates', 'apply', 'bakin:bakin', '--json']))).toBeNull()
    expect(printed).toEqual([selfUpdateResult])
  })
})
