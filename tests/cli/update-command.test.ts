/**
 * `bakin update` routes (#1007 D7.11 R3′/R3″): through a live server (follow +
 * verify), waiting out a server that is alive but not listening, never
 * replacing the binary beside one; in-process only with no server at all.
 */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-update-command-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

import type { ServerLock } from '../../src/core/server-lock'
import { runUpdateCommand } from '../../src/core/updates/self-update-cli'

const LOCK: ServerLock = { pid: process.pid, port: 3799, startedAt: Date.now(), bootId: 'boot-old', cliSecret: 'secret-1' }
const BASE = 'http://localhost:3799'
const record = (outcome: 'current' | 'update-available' | 'unsupported') => ({
  id: 'bakin:bakin', group: 'available', subject: { kind: 'bakin', id: 'bakin', label: 'Bakin' }, outcome,
  installed: { version: '0.1.0', display: 'v0.1.0' }, ...(outcome === 'update-available' ? { available: { version: '0.1.1', display: 'v0.1.1' }, action: { kind: 'operation', start: { route: '/api/updates/bakin%3Abakin/apply' }, impact: ['download', 'server-restart'] } } : {}),
  ...(outcome === 'unsupported' ? { blockedReason: 'self-update is not available on a source/dev runtime' } : {}),
  source: { kind: 'github-release', endpoint: 'x' }, fingerprint: 'f',
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A scripted server: version answers (in order, last repeats), the record, the apply start, and the operation reads. */
function server(opts: { versions: Array<{ version: string; bootId: string; state: string } | 'down'>; outcome?: 'current' | 'update-available' | 'unsupported'; operationReads?: Array<{ bootId: string; view?: unknown; status?: number }>; applyStatus?: number; applyBody?: unknown }) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = []
  let versionIndex = 0
  let readIndex = 0
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    // happy-dom's Headers keeps the caller's casing; normalize so assertions read lowercase names.
    const headers = Object.fromEntries([...new Headers(init?.headers as HeadersInit | undefined).entries()].map(([k, v]) => [k.toLowerCase(), v]))
    calls.push({ url, method: init?.method ?? 'GET', headers, ...(typeof init?.body === 'string' ? { body: init.body } : {}) })
    if (url === `${BASE}/api/version`) {
      const answer = opts.versions[Math.min(versionIndex, opts.versions.length - 1)]!
      versionIndex += 1
      if (answer === 'down') throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
      return json(answer)
    }
    if (url === `${BASE}/api/updates`) return json({ bootId: 'boot-old', records: [record(opts.outcome ?? 'update-available')], generatedAt: '', running: false })
    if (url === `${BASE}/api/updates/bakin%3Abakin/apply`) return json(opts.applyBody ?? { operationId: 'op-1', bootId: 'boot-old' }, opts.applyStatus ?? 202)
    if (url.startsWith(`${BASE}/api/operations/op-1`)) {
      const read = opts.operationReads?.[Math.min(readIndex, (opts.operationReads?.length ?? 1) - 1)]
      readIndex += 1
      if (!read) return json({ bootId: 'boot-old', error: 'not_found' }, 404)
      if (read.status === 404) return json({ bootId: read.bootId, error: 'not_found' }, 404)
      return json({ bootId: read.bootId, operation: read.view })
    }
    return json({ error: `unscripted ${url}` }, 599)
  }
  return { fetch, calls }
}
const runningView = (stage: 'download' | 'restarting') => ({
  id: 'op-1', bootId: 'boot-old', rev: 2, status: 'running', kind: 'updates:self-update', owner: 'core', origin: 'cli', title: 'Update Bakin', href: '/health', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  stages: [{ id: 'download', kind: 'downloading', label: 'Download', status: stage === 'download' ? 'active' : 'done' }, { id: 'restarting', kind: 'verifying', label: 'Restart', status: stage === 'restarting' ? 'active' : 'pending' }],
  children: [], log: [], waitingFor: undefined,
})

const lines: string[] = []
afterEach(() => { lines.length = 0 })
const echo = (line: string) => lines.push(line)

describe('runUpdateCommand with a live server', () => {
  it('a current Bakin is reported as current — nothing started, nothing replaced', async () => {
    const s = server({ versions: [{ version: '0.1.0', bootId: 'boot-old', state: 'serving' }], outcome: 'current' })
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false } })
    expect(result).toEqual({ kind: 'current', message: 'Bakin v0.1.0 is current.' })
    expect(s.calls.some((c) => c.url.endsWith('/apply'))).toBe(false)
  })

  it('an available release goes THROUGH the server: declared-operator apply, follow to the restart, then the explicit verification', async () => {
    const s = server({
      versions: [{ version: '0.1.0', bootId: 'boot-old', state: 'serving' }, { version: '0.1.0', bootId: 'boot-old', state: 'stopping' }, 'down', { version: '0.1.1', bootId: 'boot-new', state: 'serving' }],
    })
    // The follow ends `restarted`: the server's boot changed under the running operation (its honest terminal state).
    const follow = async (start: () => Promise<unknown>) => {
      await start()
      return { follow: { phase: 'restarted' as const, operation: runningView('restarting') as never, children: [] }, body: null, httpStatus: null, exitCode: 130 as const }
    }
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false }, startAndFollow: follow, identityHeaders: async () => ({ 'X-Bakin-Operator': 'declared' }) })
    expect(result).toEqual({ kind: 'verified', message: 'Updated to 0.1.1 and verified.' })
    const apply = s.calls.find((c) => c.url.endsWith('/apply'))!
    expect(apply.method).toBe('POST')
    expect(apply.headers['x-bakin-operator']).toBe('declared')
    expect(apply.headers['x-bakin-origin']).toBe('cli')
    expect(apply.headers['x-bakin-cli-secret']).toBe('secret-1')
    expect(lines).toContain('Updating Bakin v0.1.0 → v0.1.1')
    expect(lines.at(-1)).toBe('verified 0.1.1')
  })

  it('an operation that fails before the restart is reported with its outcome, and nothing is verified', async () => {
    const s = server({ versions: [{ version: '0.1.0', bootId: 'boot-old', state: 'serving' }] })
    const failedView = { ...runningView('download'), status: 'failed', outcome: { code: 'update_failed', message: 'Checksum mismatch for bakin-darwin-arm64.tar.gz' } }
    const follow = async (start: () => Promise<unknown>) => { await start(); return { follow: { phase: 'finished' as const, operation: failedView as never, children: [] }, body: null, httpStatus: 200, exitCode: 1 as const } }
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false }, startAndFollow: follow })
    expect(result).toMatchObject({ kind: 'failed', code: 'UPDATE_FAILED', message: 'Checksum mismatch for bakin-darwin-arm64.tar.gz', detail: 'update_failed' })
    expect(s.calls.filter((c) => c.url.endsWith('/api/version')).length).toBe(1) // the listen probe only — no verification
  })

  it('without an operator declaration the server refuses the apply (#898), and the CLI says how to declare', async () => {
    const s = server({ versions: [{ version: '0.1.0', bootId: 'boot-old', state: 'serving' }], applyStatus: 403, applyBody: { error: 'approval_decision', message: 'an approval decision needs a declared operator', refusalCode: 'undeclared' } })
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false }, identityHeaders: async () => ({}) })
    expect(result).toEqual({ kind: 'failed', code: 'OPERATOR_REQUIRED', message: 'Updating Bakin is an operator action.', detail: 'Run it as the operator: bakin update --as human' })
    const apply = s.calls.find((c) => c.url.endsWith('/apply'))!
    expect(apply.headers['x-bakin-operator']).toBeUndefined()
    expect(s.calls.filter((c) => c.url.endsWith('/api/version')).length).toBe(1)
  })

  it('an unsupported runtime is refused with the record\'s reason', async () => {
    const s = server({ versions: [{ version: '0.0.0-dev', bootId: 'b', state: 'serving' }], outcome: 'unsupported' })
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false } })
    expect(result).toMatchObject({ kind: 'failed', code: 'UPDATE_UNAVAILABLE', detail: 'self-update is not available on a source/dev runtime' })
  })

  it('a server that holds the lock but is not listening is waited for, then refused with "Bakin is starting" — never replaced beside', async () => {
    const s = server({ versions: ['down'] })
    const local = mock(async () => ({ kind: 'verified' as const, message: 'local' }))
    const startedAt = Date.now()
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, listenWaitMs: 120, pollMs: 10, runLocal: local, stdout: { isTTY: false } })
    expect(result).toMatchObject({ kind: 'failed', code: 'SERVER_STARTING', message: 'Bakin is starting — retry.' })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100)
    expect(local).not.toHaveBeenCalled()
    expect(s.calls.every((c) => c.url.endsWith('/api/version'))).toBe(true)
  })

  it('a server that starts listening within the wait is used', async () => {
    const s = server({ versions: ['down', 'down', { version: '0.1.0', bootId: 'boot-old', state: 'serving' }], outcome: 'current' })
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, listenWaitMs: 5_000, pollMs: 5, stdout: { isTTY: false } })
    expect(result.kind).toBe('current')
  })
})

describe('runUpdateCommand with no server', () => {
  it('runs the in-process operation and never touches the network', async () => {
    const s = server({ versions: ['down'] })
    const local = mock(async () => ({ kind: 'verified' as const, message: 'Updated to v0.1.1. Start Bakin to run it.' }))
    const result = await runUpdateCommand({ echo, liveLock: () => null, fetch: s.fetch, runLocal: local, stdout: { isTTY: false } })
    expect(result).toEqual({ kind: 'verified', message: 'Updated to v0.1.1. Start Bakin to run it.' })
    expect(local).toHaveBeenCalledTimes(1)
    expect(s.calls).toEqual([])
  })
})

describe('review round 1 — the restart milestone is the handoff (#4)', () => {
  it('the follow stops the moment the restarting stage goes active and verification starts, without waiting for a terminal outcome', async () => {
    const s = server({ versions: [{ version: '0.1.0', bootId: 'boot-old', state: 'serving' }, { version: '0.1.1', bootId: 'boot-new', state: 'serving' }] })
    const seen: boolean[] = []
    const follow: NonNullable<Parameters<typeof runUpdateCommand>[0]['startAndFollow']> = async (start, opts) => {
      await start()
      seen.push(opts.onUpdate(runningView('download') as never))
      seen.push(opts.onUpdate(runningView('restarting') as never))
      // The follower detached at the milestone: no terminal view, the operation is still "running".
      return { follow: { phase: 'detached' as const, operation: runningView('restarting') as never, children: [] }, body: null, httpStatus: null, exitCode: 130 as const }
    }
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false }, startAndFollow: follow, identityHeaders: async () => ({ 'X-Bakin-Operator': 'declared' }) })
    expect(seen).toEqual([false, true])
    expect(result).toEqual({ kind: 'verified', message: 'Updated to 0.1.1 and verified.' })
  })
})

describe('review round 2 — terminal failures beat the handoff (#7); the reviewed target rides the apply (#1)', () => {
  it('a restart_failed terminal view is reported as the failure it is — no verification, no 90 s wait', async () => {
    const s = server({ versions: [{ version: '0.1.0', bootId: 'boot-old', state: 'serving' }] })
    const failed = { ...runningView('restarting'), status: 'failed', outcome: { code: 'restart_failed', message: 'Updated to v0.1.1, but the restart could not be scheduled (spawn EACCES). Restart Bakin by hand to run it.' }, stages: [{ id: 'download', kind: 'downloading', label: 'Download', status: 'done' }, { id: 'swap', kind: 'committing', label: 'Swap', status: 'done' }, { id: 'restarting', kind: 'verifying', label: 'Restart', status: 'failed' }] }
    const seen: boolean[] = []
    const follow: NonNullable<Parameters<typeof runUpdateCommand>[0]['startAndFollow']> = async (start, opts) => {
      await start()
      seen.push(opts.onUpdate(failed as never))
      return { follow: { phase: 'finished' as const, operation: failed as never, children: [] }, body: null, httpStatus: 200, exitCode: 1 as const }
    }
    const result = await runUpdateCommand({ echo, liveLock: () => LOCK, fetch: s.fetch, pollMs: 1, stdout: { isTTY: false }, startAndFollow: follow, identityHeaders: async () => ({ 'X-Bakin-Operator': 'declared' }) })
    expect(seen).toEqual([false])
    expect(result).toMatchObject({ kind: 'failed', code: 'UPDATE_FAILED', message: expect.stringMatching(/restart could not be scheduled/), detail: 'restart_failed' })
    expect(s.calls.filter((c) => c.url.endsWith('/api/version')).length).toBe(1)
    const apply = s.calls.find((c) => c.url.endsWith('/apply'))!
    expect(JSON.parse(apply.body ?? '{}')).toEqual({ target: { version: '0.1.1' } })
  })
})
