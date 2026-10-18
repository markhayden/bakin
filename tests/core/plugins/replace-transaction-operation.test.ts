/**
 * The replace transaction inside an operation (#895, PLAN 4.1): it reports on
 * REPLACE_STAGES with `replace` (the journal-first rename) as the point of no
 * return, Whiskit steps become build items named BEFORE they run, and a hung
 * build is visible as stuck, then fails through the Whiskit timeout with the
 * existing rollback. The crash/recovery matrix stays in
 * replace-transaction.test.ts, untouched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-replace-op-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const paths = () => ({ root: testDir, home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))

import {
  createMemoryResourceAcquirer,
  createOperationRegistry,
  type OperationContext,
  type OperationPlan,
  type OperationView,
} from '../../../packages/core/src/operations'
import { operationQuietState } from '../../../packages/sdk/src/types/operations'
import {
  REPLACE_STAGES,
  replacePlanStages,
  replacePluginDir,
  type ReplaceBuildHooks,
  type ReplacePluginDirArgs,
} from '../../../src/core/plugins/replace-transaction'
import { commandFailure, runSystemBun } from '../../../src/core/whiskit/command'
import { addPlugin, readPluginLockfile, writePluginLockfile, type PluginLockEntry } from '../../../packages/core/src/plugins/lockfile'

const ID = 'opplug'
const SCRIPT = '#!/bin/sh\necho one\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const pluginDir = () => join(testDir, 'plugins', ID)
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }

const entry = (version: string): PluginLockEntry => ({
  source: '/src', type: 'local', ref: '', commitSha: '', installedAt: '2026-09-01T00:00:00.000Z',
  version, permissions: [], manifestSha: 'a'.repeat(64),
})

function seedPrevious(): void {
  mkdirSync(join(pluginDir(), 'dist'), { recursive: true })
  writeFileSync(join(pluginDir(), 'index.ts'), 'export default 1\n')
  writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('1.0.0')))
}

const PLAN: OperationPlan = {
  stages: [{ id: 'prepare', kind: 'preparing', label: 'Prepare' }, ...replacePlanStages()],
  pointOfNoReturn: REPLACE_STAGES.replace,
}

/**
 * Run the transaction inside a real registry operation; `views` collects every
 * published view, so a test can look at the operation mid-flight.
 */
async function runInOperation(
  args: Partial<ReplacePluginDirArgs>,
  opts: { plan?: OperationPlan; beforeReplace?: (op: OperationContext, cancel: () => void) => Promise<void> } = {},
): Promise<{ view: OperationView; views: OperationView[]; error?: unknown }> {
  const views: OperationView[] = []
  const registry = createOperationRegistry({
    bootId: () => 'test-boot',
    publish: (view) => { views.push(structuredClone(view)) },
    quietCheckIntervalMs: 0,
    acquireResources: createMemoryResourceAcquirer(1),
  })
  let error: unknown
  let cancel = () => {}
  try {
    const { operationId } = await registry.start({
      kind: 'test:upgrade', owner: 'core', origin: 'system', title: 'Upgrade opplug',
      fingerprint: `test:${randomUUID()}`, resources: ['install-state'], plan: opts.plan ?? PLAN,
      run: async (op) => {
        op.stage('prepare')
        await opts.beforeReplace?.(op, cancel)
        try {
          await replacePluginDir({
            id: ID,
            op: 'upgrade',
            place: (dir) => { writeFileSync(join(dir, 'index.ts'), 'export default 2\n') },
            bins: [],
            binIdentity: { pluginId: ID, version: '2.0.0', ref: '', commitSha: '' },
            ledger: () => { writePluginLockfile(addPlugin(readPluginLockfile(), ID, entry('2.0.0'))) },
            operation: op,
            ...args,
          })
        } catch (err) {
          error = err
          throw err
        }
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: null }
      },
    })
    cancel = () => { void registry.cancel(operationId) }
    return { view: await registry.await(operationId), views, ...(error === undefined ? {} : { error }) }
  } finally {
    registry.dispose()
  }
}

beforeAll(async () => {
  const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({
    port: 0,
    fetch: () => new NativeResponse(SCRIPT),
  })
})
afterAll(() => {
  server.stop(true)
  rmSync(testDir, { recursive: true, force: true })
})
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

describe('replacePluginDir inside an operation', () => {
  it('reports replace → place → build (Whiskit steps as items) → bins → record, and latches non-cancellable at replace', async () => {
    seedPrevious()
    const build = async (_dir: string, hooks: ReplaceBuildHooks) => {
      hooks.onStage?.({ stage: 'server-build', status: 'start' })
      hooks.onOutput?.('bundled index.js')
      hooks.onStage?.({ stage: 'server-build', status: 'ok', durationMs: 1 })
    }
    const bins = [{ name: 'one', version: '1.0.0', install: { [platform]: { url: `http://127.0.0.1:${server.port}/one`, sha256: sha256(SCRIPT) } } }]
    const { view, views } = await runInOperation({ build, bins })
    expect(view.status).toBe('succeeded')
    expect(view.stages.map((s) => [s.id, s.status])).toEqual([
      ['prepare', 'done'], ['replace', 'done'], ['place', 'done'], ['build', 'done'], ['bins', 'done'], ['record', 'done'],
    ])
    expect(view.stages.find((s) => s.id === 'build')!.items).toEqual([{ id: 'server-build', label: 'Build the server bundle', status: 'done' }])
    expect(view.stages.find((s) => s.id === 'bins')!.items?.[0]).toMatchObject({ id: 'bin:one', status: 'done' })
    expect(view.lastOutput).toBe('bundled index.js')
    const firstAtReplace = views.find((v) => v.stages.find((s) => s.id === 'replace')?.status === 'active')!
    expect(firstAtReplace.cancellable).toBe(false)
    expect(views.find((v) => v.stages[0]!.status === 'active')!.cancellable).toBe(true)
    expect(readFileSync(join(pluginDir(), 'index.ts'), 'utf-8')).toBe('export default 2\n')
  })

  it('an artifact lane skips build; no declared binaries skips bins', async () => {
    seedPrevious()
    const { view } = await runInOperation({})
    expect(view.stages.find((s) => s.id === 'build')).toMatchObject({ status: 'skipped', skippedReason: 'prebuilt artifact' })
    expect(view.stages.find((s) => s.id === 'bins')).toMatchObject({ status: 'skipped', skippedReason: 'no binaries declared' })
  })

  it('a cancel before the replace stage leaves the live plugin untouched', async () => {
    seedPrevious()
    const { view } = await runInOperation({}, {
      // Cancelled while still in the cancellable prepare stage.
      beforeReplace: async (_op, cancel) => { cancel() },
    })
    expect(view.status).toBe('cancelled')
    expect(readFileSync(join(pluginDir(), 'index.ts'), 'utf-8')).toBe('export default 1\n')
    expect(readPluginLockfile().plugins[ID]?.version).toBe('1.0.0')
  })

  it('a hung build names its step, goes stuck, then fails through the Whiskit timeout and rolls back', async () => {
    seedPrevious()
    const plan: OperationPlan = {
      stages: PLAN.stages.map((s) => (s.id === 'build' ? { ...s, quiet: { quietMs: 40, stuckMs: 80 } } : s)),
      pointOfNoReturn: REPLACE_STAGES.replace,
    }
    let failedAt = 0
    const build = async (dir: string, hooks: ReplaceBuildHooks) => {
      hooks.onStage?.({ stage: 'server-build', status: 'start' })
      // A real hung subprocess, bounded the way every Whiskit step is
      // (DEFAULT_BUILD_TIMEOUT_MS in production): the timeout kills it.
      const result = await runSystemBun(['-e', 'setInterval(() => {}, 1000)'], { cwd: dir, timeoutMs: 600, onLine: hooks.onOutput })
      failedAt = Date.now()
      hooks.onStage?.({ stage: 'server-build', status: 'error', durationMs: result.durationMs })
      throw commandFailure('server-build', 'Server build for "opplug"', result)
    }
    const { view, views, error } = await runInOperation({ build }, { plan })
    // The last view published while the step hung: it names the step, and by
    // the time the timeout fired nothing had progressed for longer than stuck.
    const hung = views.filter((v) => v.stages.find((s) => s.id === 'build')?.items?.[0]?.status === 'active').at(-1)!
    expect(hung.stages.find((s) => s.id === 'build')!.items).toEqual([{ id: 'server-build', label: 'Build the server bundle', status: 'active' }])
    expect(operationQuietState(hung, failedAt)).toMatchObject({ state: 'stuck', stageId: 'build' })
    expect(String(error)).toMatch(/timed out/i)
    expect(view.status).toBe('failed')
    expect(view.stages.find((s) => s.id === 'build')!.items?.[0]?.status).toBe('failed')
    expect(readFileSync(join(pluginDir(), 'index.ts'), 'utf-8')).toBe('export default 1\n')
    expect(readPluginLockfile().plugins[ID]?.version).toBe('1.0.0')
    expect(existsSync(join(testDir, 'plugins', `.bakin-backup-${ID}`))).toBe(false)
  }, 10_000)
})
