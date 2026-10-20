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
  checkAgent: mock(async (id: string, opts: unknown) => {
    inProcess.push({ verb: 'checkAgent', id, opts })
    // orca's upstream question went unanswered: the receipt names it (r5 #1).
    const pkg = id === 'orca' ? { id: 'orca', versionBefore: '1.0.0', versionAfter: '1.0.0', changed: false, fetched: true, checkError: 'ls-remote: offline' } : { id, versionBefore: '1.0.0', versionAfter: '1.1.0', changed: true, fetched: true }
    return { agentId: id, checkOnly: true, package: pkg, verification: { status: 'ok', findings: [] } }
  }),
  checkPack: mock(async (id: string) => { inProcess.push({ verb: 'checkPack', id }); if (id === 'gone@1.0.0') throw new Error('package "gone@1.0.0" is not installed'); return { packageId: id, checkOnly: true, versionBefore: '1.0.0', versionAfter: '1.0.0', changed: false } }),
}))
mock.module('../../src/core/agent-packages/agent-state', () => ({
  listAllAgentStates: mock(async () => [{ agentId: 'pixel', state: 'managed' }, { agentId: 'orca', state: 'unmanaged' }, { agentId: 'ghost', state: 'absent' }]),
}))
const createAppServices = mock(async () => ({}))
const createReadOnlyAppServices = mock(async () => ({}))
let services: object | null = {}
mock.module('../../src/core/app-services', () => ({ maybeGetAppServices: () => services, createAppServices, createReadOnlyAppServices }))
let pluginPassRuns = 0
mock.module('../../src/cli/commands/updates', () => ({
  checkUpdatesInProcess: mock(async (kind: string) => { pluginPassRuns += 1; inProcess.push({ verb: 'checkUpdatesInProcess', id: kind }); return { records: [{ id: 'plugin:notes', outcome: 'update-available', installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, observedAt: '2026-10-20T11:00:00.000Z' }], generatedAt: 'now', running: false } }),
}))
const lockRow = (version: string) => ({ type: 'github', version, source: 'github:acme/notes', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', permissions: [], manifestSha: 'c'.repeat(64) })
mock.module('@bakin/core/plugins/lockfile', () => ({
  // `upgraded` was upgraded offline to 1.1.0 since the server last observed it at 1.0.0 (review r3 #2);
  // `local` was REBUILT offline — same version, empty sha, a new tree digest (review r4 #4).
  readPluginLockfile: () => ({ version: 1, plugins: {
    notes: lockRow('1.0.0'),
    upgraded: lockRow('1.1.0'),
    local: { type: 'local', version: '0.3.0', source: '/src/local', ref: '', commitSha: '', sourceTreeSha: 'f'.repeat(64), sourceTreeShaAlgo: 3, installedAt: '2026-10-01T00:00:00.000Z', permissions: [], manifestSha: 'c'.repeat(64) },
  } }),
}))
const silenced: string[] = []
import * as realLogger from '../../src/core/logger'
mock.module('../../src/core/logger', () => ({
  ...realLogger,
  withSilentConsoleLogs: async <T,>(fn: () => Promise<T>): Promise<T> => { silenced.push('on'); return fn() },
}))
// Captured BEFORE the mock (live namespace binding): the engine keeps the real helpers, only the file read is scripted.
import * as realUpdatesStore from '../../src/core/updates/store'
mock.module('../../src/core/updates/store', () => ({
  ...realUpdatesStore,
  readUpdatesFile: () => ({ version: 1, records: {
    'plugin:notes': { id: 'plugin:notes', outcome: 'current', observedAt: '2026-10-19T11:00:00.000Z' },
    'plugin:upgraded': { id: 'plugin:upgraded', outcome: 'update-available', installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', display: '1.1.0' }, observedAt: '2026-10-19T11:00:00.000Z' },
    'plugin:local': { id: 'plugin:local', outcome: 'update-available', installed: { version: '0.3.0', digest: 'e'.repeat(64), display: '0.3.0' }, available: { digest: 'f'.repeat(64), display: 'local changes' }, observedAt: '2026-10-19T11:00:00.000Z' },
  }, schedule: {}, conditional: {} }),
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
  silenced.length = 0
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
  it('agents sync <id> --check asks the read-only checkAgent directly; without an id every present agent is checked; services come up READ-ONLY (r3 #1)', async () => {
    services = null
    await runAgents(['agents', 'sync', 'pixel', '--check'])
    expect(createReadOnlyAppServices).toHaveBeenCalledTimes(1)
    expect(createAppServices).not.toHaveBeenCalled()
    expect(silenced).toEqual([])
    expect(inProcess).toEqual([{ verb: 'checkAgent', id: 'pixel', opts: { trigger: 'cli' } }])
    expect(printed[0]).toMatchObject({ ok: true, receipt: { checkOnly: true, package: { changed: true } } })
    expect(http).toEqual([])
    services = {}
    // `--json` runs the in-process work under the silenced console transport (r4 #6).
    inProcess.length = 0
    printed.length = 0
    await runAgents(['agents', 'sync', 'pixel', '--check', '--json'])
    expect(silenced).toEqual(['on'])
    expect(printed[0]).toMatchObject({ ok: true, receipt: { checkOnly: true } })
    silenced.length = 0
    inProcess.length = 0
    printed.length = 0
    // The roster: orca's check failed → the command fails (exit 1) and says why; --json is ONE aggregate document (r5 #1, #3).
    expect(await exitCode(runAgents(['agents', 'sync', '--check', '--json']))).toBe('exit:1')
    expect(inProcess.map((c) => c.id)).toEqual(['pixel', 'orca'])
    expect(printed).toHaveLength(1)
    expect(printed[0]).toMatchObject({ ok: false, agents: [
      { agentId: 'pixel', ok: true, receipt: { package: { changed: true } } },
      { agentId: 'orca', ok: false, error: 'ls-remote: offline', receipt: { package: { checkError: 'ls-remote: offline' } } },
    ] })
  })

  it('packages sync <key> --check asks the read-only checkPack; a refused key exits 1 with the error; --json silences runtime logs', async () => {
    await runPackages(['packages', 'sync', 'notes@1.0.0', '--check', '--json'])
    expect(silenced).toEqual(['on'])
    silenced.length = 0
    inProcess.length = 0
    printed.length = 0
    await runPackages(['packages', 'sync', 'notes@1.0.0', '--check'])
    expect(silenced).toEqual([])
    expect(inProcess).toEqual([{ verb: 'checkPack', id: 'notes@1.0.0' }])
    expect(printed[0]).toMatchObject({ ok: true, receipt: { checkOnly: true, changed: false } })
    expect(await exitCode(runPackages(['packages', 'sync', 'gone@1.0.0', '--check']))).toBe('exit:1')
    expect(printed[1]).toMatchObject({ ok: false, error: expect.stringContaining('not installed') })
  })

  it('plugins list --check runs the engine\'s plugin pass in-process and lists the lockfile plugins with the verdict; a plain list reads the stored records', async () => {
    await runPlugins(['plugins', 'list', '--check', '--json'])
    expect(pluginPassRuns).toBe(1)
    expect(inProcess).toEqual([{ verb: 'checkUpdatesInProcess', id: 'plugin' }])
    expect(printed[0]).toMatchObject({ plugins: [
      { id: 'notes', version: '1.0.0', source: 'github', upgradeAvailable: true, updateObservedAt: '2026-10-20T11:00:00.000Z', status: 'unknown' },
      // The pass produced no record for it: unknown, never "up to date".
      { id: 'upgraded', version: '1.1.0', upgradeAvailable: false, updateObservedAt: null, status: 'unknown' },
      { id: 'local', version: '0.3.0', upgradeAvailable: false, updateObservedAt: null, status: 'unknown' },
    ] })
    // `--json` is one document: the in-process work ran under the silenced console transport (r4 #6).
    expect(silenced).toEqual(['on'])
    printed.length = 0
    silenced.length = 0
    await runPlugins(['plugins', 'list', '--json'])
    expect(pluginPassRuns).toBe(1)
    expect(printed[0]).toMatchObject({ plugins: [
      { id: 'notes', upgradeAvailable: false, updateObservedAt: '2026-10-19T11:00:00.000Z' },
      // The stored record offers the version the lockfile now holds: no answer — never "update available", never fresh.
      { id: 'upgraded', version: '1.1.0', upgradeAvailable: false, updateObservedAt: null },
      // The stored offer was observed for the PREVIOUS tree digest: the rebuild installed exactly those changes — no answer.
      { id: 'local', version: '0.3.0', upgradeAvailable: false, updateObservedAt: null },
    ] })
    expect(http).toEqual([])
    // Without --json the console transport stays as it is.
    silenced.length = 0
    await runPlugins(['plugins', 'list'])
    expect(silenced).toEqual([])
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
