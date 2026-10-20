/** Self-update as an operation (#1007 D7.11): staging keyed by the operation, the restart proven before the swap and armed after it, the process ends the operation. */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-self-update-op-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { createOperationRegistry, type OperationView } from '@bakin/core/operations'
import { selfUpdate as realSelfUpdate, type SelfUpdateOptions } from '../../src/core/self-update'
import type { PreparedRestart } from '../../src/core/server-restart'
import { SELF_UPDATE_PLAN, selfUpdateOperation, type SelfUpdateOperationDeps } from '../../src/core/updates/self-update-operation'
import { waitUntil } from '../helpers/wait'

const registry = createOperationRegistry({ bootId: () => 'boot-test', publish: () => {}, audit: () => {} })
afterEach(() => { /* operations finish on their own */ })

/** A fake selfUpdate that walks the real stages and honours the pre-swap hook. */
function fakeSelfUpdate(opts: { failAt?: 'download' | 'verify'; onSuffix?: (suffix: string) => void } = {}): SelfUpdateOperationDeps['selfUpdate'] {
  return async (reporter, options: SelfUpdateOptions) => {
    opts.onSuffix?.(options.stagingSuffix ?? 'new')
    options.onStage?.('download')
    reporter.log('Downloading bakin-darwin-arm64.tar.gz (v0.2.0)...')
    if (opts.failAt === 'download') { reporter.error('Download failed: HTTP 500'); return 1 }
    options.onStage?.('verify')
    if (opts.failAt === 'verify') { reporter.error('Checksum mismatch for bakin-darwin-arm64.tar.gz'); return 1 }
    options.onStage?.('extract')
    if (options.beforeReplace) {
      try {
        await options.beforeReplace({ release: { tag_name: 'v0.2.0', assets: [] }, newPath: `${options.execPath}.${options.stagingSuffix}` })
      } catch (err) {
        reporter.error(`Not replacing the binary: ${err instanceof Error ? err.message : String(err)}`)
        return 1
      }
    }
    options.onStage?.('replace')
    reporter.log('Updated to v0.2.0. Restart to run the new version.')
    return 0
  }
}

/** The "process exit" the operation waits on last: never in production, resolved by the test that reached it (it holds install-state until then). */
function deps(overrides: Partial<SelfUpdateOperationDeps> = {}): SelfUpdateOperationDeps & { calls: string[]; exit: () => void } {
  const calls: string[] = []
  let exit!: () => void
  const exited = new Promise<void>((resolve) => { exit = resolve })
  const prepared: PreparedRestart = { ok: true, strategy: 'standalone-child', delayMs: 10, execPath: '/opt/bakin', contentDir: testDir }
  return {
    calls,
    exit,
    currentVersion: () => '0.1.0',
    execPath: () => '/opt/bakin',
    selfUpdate: fakeSelfUpdate(),
    prepareRestart: () => { calls.push('prepare'); return prepared },
    activateRestart: (p) => { calls.push(`activate:${p.ok ? p.strategy : 'invalid'}`); return { ok: true, strategy: 'standalone-child', restartDelayMs: 10, childPid: 4242 } },
    awaitProcessExit: () => exited,
    ...overrides,
  }
}
async function view(id: string, until: (v: OperationView) => boolean): Promise<OperationView> {
  let latest: OperationView | null = null
  await waitUntil(() => { latest = registry.get(id); return latest !== null && until(latest) }, { label: 'operation reached the expected state' })
  return latest!
}

describe('selfUpdateOperation', () => {
  it('declares install-state, the five stages with the swap as the point of no return', () => {
    const input = selfUpdateOperation('web', deps())
    expect(input.resources).toEqual(['install-state'])
    expect(input.plan).toBe(SELF_UPDATE_PLAN)
    expect(SELF_UPDATE_PLAN.stages.map((s) => s.id)).toEqual(['download', 'verify', 'prepare-restart', 'swap', 'restarting'])
    expect(SELF_UPDATE_PLAN.pointOfNoReturn).toBe('swap')
  })

  it('stages in order, keys the staging by its own id, prepares BEFORE the swap and activates AFTER it, and ends only with the process', async () => {
    const suffixes: string[] = []
    const d = deps({ selfUpdate: fakeSelfUpdate({ onSuffix: (s) => suffixes.push(s) }) })
    const started = await registry.start(selfUpdateOperation('cli', d))
    const restarting = await view(started.operationId, (v) => v.stages.some((s) => s.id === 'restarting' && s.status === 'active'))
    expect(restarting.status).toBe('running')
    expect(restarting.stages.map((s) => [s.id, s.status])).toEqual([['download', 'done'], ['verify', 'done'], ['prepare-restart', 'done'], ['swap', 'done'], ['restarting', 'active']])
    expect(d.calls).toEqual(['prepare', 'activate:standalone-child'])
    expect(suffixes).toEqual([`${started.operationId}.new`])
    // Still running: the operation is boot-scoped and ends with the old process.
    await new Promise((r) => setTimeout(r, 30))
    expect(registry.get(started.operationId)?.status).toBe('running')
    d.exit() // let it finish so install-state is released for the next test
    await view(started.operationId, (v) => v.status === 'succeeded')
  })

  it('a restart that cannot be prepared fails the update BEFORE the swap: no activation, no handoff, the binary untouched', async () => {
    const d = deps({ prepareRestart: () => ({ ok: false, strategy: 'standalone-child', error: 'the server executable is not runnable' }) })
    const started = await registry.start(selfUpdateOperation('web', d))
    const finished = await view(started.operationId, (v) => v.status === 'failed')
    expect(finished.outcome?.code).toBe('update_failed')
    expect(finished.outcome?.message).toMatch(/restart cannot be scheduled.*left untouched/)
    expect(finished.stages.find((s) => s.id === 'swap')?.status).not.toBe('done')
    expect(finished.stages.find((s) => s.id === 'restarting')?.status).toBe('pending')
    expect(d.calls).toEqual([])
  })

  it('a download or checksum failure fails with the error named and nothing prepared', async () => {
    for (const failAt of ['download', 'verify'] as const) {
      const d = deps({ selfUpdate: fakeSelfUpdate({ failAt }) })
      const started = await registry.start(selfUpdateOperation('web', d))
      const finished = await view(started.operationId, (v) => v.status === 'failed')
      expect(finished.outcome?.code).toBe('update_failed')
      expect(finished.outcome?.message).toMatch(failAt === 'download' ? /Download failed/ : /Checksum mismatch/)
      expect(d.calls).toEqual([])
    }
  })

  it('a restart activation that fails after the swap is restart_failed with the manual-restart message', async () => {
    const d = deps({ activateRestart: () => ({ ok: false, strategy: 'standalone-child', restartDelayMs: 10, error: 'spawn EACCES' }) })
    const started = await registry.start(selfUpdateOperation('web', d))
    const finished = await view(started.operationId, (v) => v.status === 'failed')
    expect(finished.outcome?.code).toBe('restart_failed')
    expect(finished.outcome?.message).toMatch(/Updated to v0\.2\.0, but the restart could not be scheduled \(spawn EACCES\)\. Restart Bakin by hand/)
  })
})

describe('review round 1 — the approved release', () => {
  it('the operation hands the approved version to the updater, which refuses anything else (#2)', async () => {
    const seen: Array<string | undefined> = []
    const d = deps({ expectedVersion: '0.2.0', selfUpdate: async (_reporter, options) => { seen.push(options.expectedVersion); return 0 }, restart: 'none' })
    const { operationId } = await registry.start(selfUpdateOperation('web', d))
    await view(operationId, (v) => v.status === 'succeeded')
    expect(seen).toEqual(['0.2.0'])
  })
})

describe('review round 2 — the restart milestone', () => {
  it('a restart activation that fails never shows the restarting stage active: the failure is terminal, not a handoff (#7)', async () => {
    const d = deps({ activateRestart: () => ({ ok: false, strategy: 'standalone-child', restartDelayMs: 10, error: 'spawn EACCES' }) })
    const started = await registry.start(selfUpdateOperation('web', d))
    const finished = await view(started.operationId, (v) => v.status === 'failed')
    expect(finished.outcome?.code).toBe('restart_failed')
    expect(finished.stages.find((s) => s.id === 'restarting')?.status).not.toBe('active')
    expect(finished.stages.some((s) => s.status === 'active')).toBe(false)
  })

  it('the operation fingerprint carries the approved release, so another version never attaches (#1)', () => {
    expect(selfUpdateOperation('web', deps({ expectedVersion: '0.2.0' })).fingerprint).toBe('updates:self-update:0.2.0')
    expect(selfUpdateOperation('web', deps({ expectedVersion: '0.3.0' })).fingerprint).toBe('updates:self-update:0.3.0')
    expect(selfUpdateOperation('cli', deps()).fingerprint).toBe('updates:self-update:latest')
  })
})

describe('review round 3 — the deferred restart command', () => {
  it('a restart whose deferred command fails after activation ends restart_failed and releases install-state instead of waiting forever (#3)', async () => {
    const d = deps({ activateRestart: (p) => ({ ok: true, strategy: p.ok ? p.strategy : 'standalone-child', restartDelayMs: 10, settled: new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'launchctl kickstart exited 1' }), 20)) }) })
    const started = await registry.start(selfUpdateOperation('web', d))
    const finished = await view(started.operationId, (v) => v.status === 'failed')
    expect(finished.outcome?.code).toBe('restart_failed')
    expect(finished.outcome?.message).toMatch(/the restart failed \(launchctl kickstart exited 1\)/)
    // install-state is free again: another operation that needs it can start.
    const next = await registry.start(selfUpdateOperation('web', deps({ restart: 'none' })))
    await view(next.operationId, (v) => v.status === 'succeeded')
  })
})

describe('review round 4 — cancellation while the update is still reversible', () => {
  /** A release server whose archive body stalls forever after its headers (the margo 2026-09-21 transfer shape). */
  function stalledReleaseServer(): { url: string; requests: string[]; stop: () => void } {
    const requests: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname
        requests.push(path)
        if (path === '/archive') {
          return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([0x1f, 0x8b])) /* then nothing, ever */ } }), { headers: { 'Content-Type': 'application/gzip' } })
        }
        return new Response('not found', { status: 404 })
      },
    })
    return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) }
  }

  it('a stalled archive download is cancellable: the transfer aborts, staging is cleaned, the binary is untouched, the operation ends cancelled and install-state is free (#4)', async () => {
    const dir = join(testDir, `cancel-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    const execPath = join(dir, 'bakin')
    writeFileSync(execPath, 'old-binary')
    const release = stalledReleaseServer()
    try {
      const d = deps({
        execPath: () => execPath,
        selfUpdate: (reporter, options) => realSelfUpdate(reporter, {
          ...options,
          platform: 'linux', arch: 'x64',
          fetchRelease: async () => ({ tag_name: 'v0.2.0', draft: false, prerelease: false, assets: [
            { name: 'bakin-linux-x64.tar.gz', browser_download_url: `${release.url}/archive` },
            { name: 'checksums.txt', browser_download_url: `${release.url}/checksums` },
          ] }),
        }),
      })
      const started = await registry.start(selfUpdateOperation('web', d))
      await waitUntil(() => release.requests.includes('/archive'), { label: 'the archive transfer started' })
      await waitUntil(() => readdirSync(dir).length > 1, { label: 'a staging file exists' })
      expect(registry.cancel(started.operationId)).toBe('cancelling')
      const finished = await view(started.operationId, (v) => v.status === 'cancelled' || v.status === 'failed' || v.status === 'succeeded')
      expect(finished.status).toBe('cancelled')
      expect(finished.stages.find((s) => s.id === 'swap')?.status).not.toBe('done')
      expect(readFileSync(execPath, 'utf-8')).toBe('old-binary')
      expect(readdirSync(dir)).toEqual(['bakin'])
      expect(d.calls).toEqual([])
      // The lease is released: the next install-state operation runs at once.
      const next = await registry.start(selfUpdateOperation('web', deps({ restart: 'none' })))
      await view(next.operationId, (v) => v.status === 'succeeded')
    } finally {
      release.stop()
    }
  })

  it('a cancel during the release fetch aborts it the same way, before anything is downloaded', async () => {
    const dir = join(testDir, `cancel-fetch-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    const execPath = join(dir, 'bakin')
    writeFileSync(execPath, 'old-binary')
    let fetching = false
    const downloads: string[] = []
    const d = deps({
      execPath: () => execPath,
      selfUpdate: (reporter, options) => realSelfUpdate(reporter, {
        ...options,
        platform: 'linux', arch: 'x64',
        fetchRelease: (_reporter, signal) => new Promise((_resolve, reject) => {
          fetching = true
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
        }),
        downloadTo: async (url) => { downloads.push(url) },
      }),
    })
    const started = await registry.start(selfUpdateOperation('cli', d))
    await waitUntil(() => fetching, { label: 'the release fetch is in flight' })
    registry.cancel(started.operationId)
    const finished = await view(started.operationId, (v) => v.status === 'cancelled' || v.status === 'failed')
    expect(finished.status).toBe('cancelled')
    expect(downloads).toEqual([])
    expect(readdirSync(dir)).toEqual(['bakin'])
  })
})
