/**
 * `bakin agents sync --check`, `bakin packages sync --check` and
 * `bakin plugins list [--check]` with NO server run in-process (PR 8 review
 * r2 #9): the same `syncAgent`/`syncPack({ check })` the routes run and the
 * engine's plugin pass over this home — report-only, nothing persisted. With
 * a live server they ride HTTP as before.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testHome = join(tmpdir(), `bakin-cli-offline-check-${Date.now()}`)
process.env.BAKIN_HOME = testHome
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), media: join(testHome, 'media') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db'), media: join(testHome, 'media') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testHome, 'openclaw'), getOpenClawPath: (...parts: string[]) => join(testHome, 'openclaw', ...parts), resetOpenClawHome: () => {} }))
afterAll(() => rmSync(testHome, { recursive: true, force: true }))

class ExitCalled extends Error { constructor(readonly code: string) { super(code) } }
let liveLock: { pid: number; port: number; cliSecret?: string } | null = null
mock.module('../../src/core/server-lock', () => ({ readLiveServerLock: () => liveLock, CLI_SECRET_HEADER: 'X-Bakin-Cli-Secret' }))
const http: Array<{ method: string; path: string; body?: unknown }> = []
mock.module('../../src/cli/http', () => ({
  apiGet: mock(async (path: string) => { http.push({ method: 'GET', path }); if (path === '/api/agent-packages') return { ok: true, agents: [] }; return { plugins: [] } }),
  apiPost: mock(async (path: string, body?: unknown) => { http.push({ method: 'POST', path, body }); return { operationId: 'op-1' } }),
  apiPostJson: mock(async () => ({ ok: true, data: {} })),
  apiDelete: mock(async () => ({})),
  cliFetch: mock(async () => new Response('{}')),
  jsonObject: (value: unknown) => (typeof value === 'object' && value !== null ? value as Record<string, unknown> : null),
}))
mock.module('../../src/cli/operation-command', () => ({
  startAndFollow: mock(async (start: () => Promise<unknown>) => { await start(); return { follow: { phase: 'finished', operation: null, children: [] }, body: { ok: true, receipt: { checkOnly: true, via: 'server' } }, httpStatus: 200, exitCode: 0 } }),
  operationBody: (operation: { body: Record<string, unknown> | null }) => operation.body ?? { ok: false },
  exitOnFailure: () => {},
}))
const printed: unknown[] = []
mock.module('../../src/cli/output', () => ({ print: (value: unknown) => { printed.push(value) }, printTable: () => {} }))
mock.module('../../src/cli/help', () => ({
  exitUsage: mock(async (_u: string, detail?: string): Promise<never> => { throw new ExitCalled(`usage:${detail ?? ''}`) }),
  exitUnknownSubcommand: mock(async (): Promise<never> => { throw new ExitCalled('unknown') }),
  exitCommandFailure: mock(async (_m: string, o?: { code?: string }): Promise<never> => { throw new ExitCalled(o?.code ?? 'COMMAND_FAILED') }),
  exitCommandIssue: mock(async (): Promise<never> => { throw new ExitCalled('ISSUE') }),
  confirmPrompt: mock(async () => false),
  promptYesNo: mock(async () => false),
}))
const inProcess: Array<{ verb: string; id?: string; opts?: unknown }> = []
mock.module('../../src/core/agent-packages/sync', () => ({
  syncAgent: mock(async (id: string, opts: unknown) => { inProcess.push({ verb: 'syncAgent', id, opts }); return { checkOnly: true, versionBefore: '1.0.0', versionAfter: '1.1.0', changed: true, verification: { status: 'ok', findings: [] } } }),
  syncPack: mock(async (id: string, opts: unknown) => { inProcess.push({ verb: 'syncPack', id, opts }); if (id === 'gone@1.0.0') throw new Error('package "gone@1.0.0" is not installed'); return { packageId: id, checkOnly: true, versionBefore: '1.0.0', versionAfter: '1.0.0', changed: false } }),
}))
mock.module('../../src/core/agent-packages/agent-state', () => ({
  listAllAgentStates: mock(async () => [{ agentId: 'pixel', state: 'managed' }, { agentId: 'orca', state: 'unmanaged' }, { agentId: 'ghost', state: 'absent' }]),
}))
mock.module('../../src/core/app-services', () => ({ maybeGetAppServices: () => ({}), createAppServices: mock(async () => ({})) }))
let pluginPassRuns = 0
mock.module('../../src/cli/commands/updates', () => ({
  checkUpdatesInProcess: mock(async (kind: string) => { pluginPassRuns += 1; inProcess.push({ verb: 'checkUpdatesInProcess', id: kind }); return { records: [{ id: 'plugin:notes', outcome: 'update-available', available: { version: '1.1.0', display: '1.1.0' }, observedAt: '2026-10-20T11:00:00.000Z' }], generatedAt: 'now', running: false } }),
}))
mock.module('@bakin/core/plugins/lockfile', () => ({
  readPluginLockfile: () => ({ version: 1, plugins: { notes: { type: 'github', version: '1.0.0', source: 'github:acme/notes', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', permissions: [], manifestSha: 'c'.repeat(64) } } }),
}))
// Captured BEFORE the mock (live namespace binding): the engine keeps the real helpers, only the file read is scripted.
import * as realUpdatesStore from '../../src/core/updates/store'
mock.module('../../src/core/updates/store', () => ({
  ...realUpdatesStore,
  readUpdatesFile: () => ({ version: 1, records: { 'plugin:notes': { id: 'plugin:notes', outcome: 'current', observedAt: '2026-10-19T11:00:00.000Z' } }, schedule: {}, conditional: {} }),
}))

import { run as runAgents } from '../../src/cli/commands/agents'
import { run as runPackages } from '../../src/cli/commands/packages'
import { run as runPlugins } from '../../src/cli/commands/plugins'

const originalExit = process.exit
process.exit = ((code?: number) => { throw new ExitCalled(`exit:${code ?? 0}`) }) as typeof process.exit
const originalIsTTY = process.stdout.isTTY
const logs: string[] = []
const errors: string[] = []
const originalLog = console.log
const originalError = console.error
beforeEach(() => {
  // The test preload points BAKIN_URL at a dead port for every test; a no-server verb must see NO env target.
  delete process.env.BAKIN_URL
  liveLock = null
  http.length = 0
  inProcess.length = 0
  printed.length = 0
  logs.length = 0
  errors.length = 0
  pluginPassRuns = 0
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
})
afterAll(() => { process.exit = originalExit; console.log = originalLog; console.error = originalError; Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true }) })
const exitCode = async (promise: Promise<unknown>): Promise<string | null> => {
  try { await promise; return null } catch (err) { if (err instanceof ExitCalled) return err.code; throw err }
}

describe('with no server, --check runs in-process', () => {
  it('agents sync <id> --check asks syncAgent({ check }) directly; without an id every present agent is checked', async () => {
    await runAgents(['agents', 'sync', 'pixel', '--check'])
    expect(inProcess).toEqual([{ verb: 'syncAgent', id: 'pixel', opts: { check: true, trigger: 'cli' } }])
    expect(printed[0]).toMatchObject({ ok: true, receipt: { checkOnly: true, changed: true } })
    expect(http).toEqual([])
    inProcess.length = 0
    await runAgents(['agents', 'sync', '--check'])
    expect(inProcess.map((c) => c.id)).toEqual(['pixel', 'orca'])
  })

  it('packages sync <key> --check asks syncPack({ check }); a refused key exits 1 with the error', async () => {
    await runPackages(['packages', 'sync', 'notes@1.0.0', '--check'])
    expect(inProcess).toEqual([{ verb: 'syncPack', id: 'notes@1.0.0', opts: { check: true } }])
    expect(printed[0]).toMatchObject({ ok: true, receipt: { checkOnly: true, changed: false } })
    expect(await exitCode(runPackages(['packages', 'sync', 'gone@1.0.0', '--check']))).toBe('exit:1')
    expect(printed[1]).toMatchObject({ ok: false, error: expect.stringContaining('not installed') })
  })

  it('plugins list --check runs the engine\'s plugin pass in-process and lists the lockfile plugins with the verdict; a plain list reads the stored records', async () => {
    await runPlugins(['plugins', 'list', '--check', '--json'])
    expect(pluginPassRuns).toBe(1)
    expect(inProcess).toEqual([{ verb: 'checkUpdatesInProcess', id: 'plugin' }])
    expect(printed[0]).toMatchObject({ plugins: [{ id: 'notes', version: '1.0.0', source: 'github', upgradeAvailable: true, updateObservedAt: '2026-10-20T11:00:00.000Z', status: 'unknown' }] })
    printed.length = 0
    await runPlugins(['plugins', 'list', '--json'])
    expect(pluginPassRuns).toBe(1)
    expect(printed[0]).toMatchObject({ plugins: [{ id: 'notes', upgradeAvailable: false, updateObservedAt: '2026-10-19T11:00:00.000Z' }] })
    expect(http).toEqual([])
  })

  it('a sync that WRITES still needs the server; with a live server every verb rides HTTP', async () => {
    expect(inProcess).toEqual([])
    liveLock = { pid: 4242, port: 3737 }
    await runAgents(['agents', 'sync', 'pixel', '--check'])
    await runPackages(['packages', 'sync', 'notes@1.0.0', '--check'])
    await runPlugins(['plugins', 'list', '--check', '--json'])
    expect(inProcess).toEqual([])
    expect(http.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/agent-packages/pixel/sync', 'POST /api/packages/notes%401.0.0/sync', 'GET /api/plugins/manifest?check=1'])
  })
})
