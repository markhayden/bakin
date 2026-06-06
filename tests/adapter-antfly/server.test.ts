import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-antfly-server-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, antfly: join(testDir, 'antfly') }),
}))

const fakeChild = {
  stdout: { on: mock() },
  stderr: { on: mock() },
  on: mock(),
  once: mock(),
  kill: mock(),
}
const spawnMock = mock(() => fakeChild)
mock.module('child_process', () => ({ spawn: spawnMock }))

import {
  _resetExitHookForTests,
  checkExternalAntflyStability,
  getServerHealthDetail,
  startAntflyServer,
  stopAntflyServer,
} from '../../packages/adapter-antfly/src/server'
import { parseAntflyLogLine } from '../../packages/adapter-antfly/src/server-logs'

const realFetch = globalThis.fetch
const LOCAL_DEFAULT_URL = 'http://localhost:3738'
const fakeBinary = join(testDir, 'fake-antfly')

const logger = { debug: mock(), info: mock(), warn: mock(), error: mock() }

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  writeFileSync(fakeBinary, '#!/bin/sh\n')
  process.env.ANTFLY_PATH = fakeBinary
  process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS = '0'
  spawnMock.mockClear()
  logger.debug.mockClear()
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()
})

afterEach(() => {
  stopAntflyServer()
  ;(globalThis as { fetch: typeof fetch }).fetch = realFetch
  delete process.env.ANTFLY_PATH
  delete process.env.BAKIN_ANTFLY_EXTERNAL_RECHECK_MS
  rmSync(testDir, { recursive: true, force: true })
})

describe('Antfly server log parsing', () => {
  it('uses the inner Antfly level instead of the child stream level', () => {
    const parsed = parseAntflyLogLine(
      'ts=22:16:17 lvl=info caller=cmd/swarm.go:203 msg="Metadata API server is ready" address=0.0.0.0:8080',
      'warn',
    )

    expect(parsed.level).toBe('info')
    expect(parsed.message).toBe('Metadata API server is ready')
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'cmd/swarm.go:203',
      address: '0.0.0.0:8080',
    })
  })

  it('demotes transient index reconciliation while a shard is initializing', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:44:56 lvl=warn caller=reconciler/executor.go:300 msg="Failed to add index" shardID=b009cb75eee1aa90 indexName=embeddings error="shard is still initializing"',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly reconciler deferred index update until shard initialization completes (indexName=embeddings, shardID=b009cb75eee1aa90)',
    )
    expect(parsed.data).toMatchObject({
      source: 'antfly',
      caller: 'reconciler/executor.go:300',
      shardID: 'b009cb75eee1aa90',
      indexName: 'embeddings',
      error: 'shard is still initializing',
    })
  })

  it('demotes transient schema reconciliation while a shard is initializing', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:44:57 lvl=warn caller=reconciler/executor.go:326 msg="Failed to update schema" shardID=b009cb75eee1aa90 error="shard is still initializing"',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly reconciler deferred schema update until shard initialization completes (shardID=b009cb75eee1aa90)',
    )
  })

  it('keeps non-transient warnings visible with useful Antfly fields', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:44:56 lvl=warn caller=reconciler/executor.go:300 msg="Failed to add index" shardID=b009cb75eee1aa90 indexName=embeddings error="invalid vector dimension"',
      'warn',
    )

    expect(parsed.level).toBe('warn')
    expect(parsed.message).toBe(
      'Failed to add index (indexName=embeddings, shardID=b009cb75eee1aa90, error=invalid vector dimension)',
    )
  })

  it('demotes stale shard scans while Antfly metadata catches up', () => {
    const parsed = parseAntflyLogLine(
      'ts=22:18:42 lvl=error caller=scanner msg="Failed to scan shard" shardID=1f50dadf5a77af69 error="shard 1f50dadf5a77af69 not found"',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly skipped stale shard scan while metadata catches up (shardID=1f50dadf5a77af69)',
    )
  })

  it('keeps shard scan errors visible when they are not exact stale-shard misses', () => {
    const parsed = parseAntflyLogLine(
      'ts=22:18:42 lvl=error caller=scanner msg="Failed to scan shard" shardID=1f50dadf5a77af69 error="permission denied"',
      'warn',
    )

    expect(parsed.level).toBe('error')
    expect(parsed.message).toBe(
      'Failed to scan shard (shardID=1f50dadf5a77af69, error=permission denied)',
    )
  })

  it('parses v0.2 zig JSON log lines with level mapping', () => {
    const parsed = parseAntflyLogLine(
      '{"ts":"+2026-06-05T23:21:37Z","level":"err","scope":"default","msg":"public table query parse failed table=bakin_tasks err=error.UnexpectedToken"}',
      'warn',
    )

    expect(parsed.level).toBe('error')
    expect(parsed.message).toBe('public table query parse failed table=bakin_tasks err=error.UnexpectedToken')
    expect(parsed.data).toMatchObject({ source: 'antfly', scope: 'default' })
  })

  it('annotates known upstream enrichment defects instead of raw errors', () => {
    // The raw "UnsupportedEmbeddingProvider" line sent an operator debugging
    // a provider config that was fine — the real cause is upstream image
    // enrichment (bakin#456 findings 8/9). The line must explain itself and
    // drop to warn; the health page carries the red index state.
    const provider = parseAntflyLogLine(
      '{"ts":"+2026-06-06T14:47:44Z","level":"err","scope":"default","msg":"enrichment worker failed: UnsupportedEmbeddingProvider"}',
      'warn',
    )
    expect(provider.level).toBe('warn')
    expect(provider.message).toContain('UnsupportedEmbeddingProvider')
    expect(provider.message).toContain('bakin#456 finding 8')
    expect(provider.message).toContain('NOT the problem')

    const arity = parseAntflyLogLine(
      '{"ts":"+2026-06-06T14:47:44Z","level":"err","scope":"default","msg":"enrichment worker failed: InputArityMismatch"}',
      'warn',
    )
    expect(arity.level).toBe('warn')
    expect(arity.message).toContain('bakin#456 finding 9')
  })

  it('demotes expected empty-table text-merge noise from JSON logs', () => {
    const worker = parseAntflyLogLine(
      '{"ts":"+2026-06-05T23:21:37Z","level":"err","scope":"default","msg":"text merge worker failed: EmptySegment"}',
      'warn',
    )
    expect(worker.level).toBe('debug')

    const scheduled = parseAntflyLogLine(
      '{"ts":"+2026-06-05T23:22:07Z","level":"err","scope":"default","msg":"scheduled text merge file-backed build failed index=full_text_index_v0: EmptySegment"}',
      'warn',
    )
    expect(scheduled.level).toBe('debug')

    // Non-EmptySegment merge failures stay visible.
    const real = parseAntflyLogLine(
      '{"ts":"+2026-06-05T23:22:07Z","level":"err","scope":"default","msg":"text merge worker failed: DiskFull"}',
      'warn',
    )
    expect(real.level).toBe('error')
  })

  it('demotes optional model registry directory warnings', () => {
    const parsed = parseAntflyLogLine(
      'ts=19:54:17 lvl=warn caller=inference/registry.zig:178 msg="Chunker models directory does not exist" dir=/Users/roscoe/.antfly/inference/models/chunkers',
      'warn',
    )

    expect(parsed.level).toBe('debug')
    expect(parsed.message).toBe(
      'Antfly skipped optional chunker model registry with no local models (dir=/Users/roscoe/.antfly/inference/models/chunkers)',
    )
  })
})

describe('Antfly server supervision', () => {
  it('checks readiness via /readyz', async () => {
    const urls: string[] = []
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async (input: string | URL | Request) => {
      urls.push(String(input))
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    await checkExternalAntflyStability(LOCAL_DEFAULT_URL, {
      initialTimeoutMs: 50,
      stableChecks: 1,
      recheckDelayMs: 0,
    })

    expect(urls.length).toBeGreaterThan(0)
    expect(urls.every(u => u === 'http://localhost:3738/readyz')).toBe(true)
  })

  it('does not trust an external Antfly endpoint that disappears during startup recheck', async () => {
    let calls = 0
    const fetchMock = mock(async () => {
      calls++
      if (calls === 1) {
        return new Response('ok', { status: 200 })
      }
      throw new Error('connection refused')
    })
    ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

    const stability = await checkExternalAntflyStability('http://localhost:9999', {
      initialTimeoutMs: 50,
      stableChecks: 1,
      recheckDelayMs: 1,
    })

    expect(stability).toBe('disappeared')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('spawns the private instance with v0.2 swarm flags and a Bakin-owned data dir', async () => {
    let readyzCalls = 0
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async () => {
      readyzCalls++
      // First probe: not running yet -> spawn path. After spawn: ready.
      if (readyzCalls === 1) throw new Error('connection refused')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const started = await startAntflyServer({ enabled: true, url: LOCAL_DEFAULT_URL }, logger)

    expect(started).toBe(true)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [binary, args, opts] = (spawnMock.mock.calls as unknown as Array<[string, string[], { env?: Record<string, string> }]>)[0]
    expect(binary).toBe(fakeBinary)
    // CPU inference pin — the Metal backend crashes at this RC (bakin#456).
    expect(opts.env?.TERMITE_PREFERRED_BACKEND).toBe('onnx')
    expect(args).toEqual([
      'swarm',
      '--host', '127.0.0.1',
      '--port', '3738',
      '--health-port', '3739',
      '--data-dir', join(testDir, 'antfly'),
      '--models-dir', expect.stringContaining(join('inference', 'models')),
    ])
  })

  it('registers a sync exit hook that kills the spawned child (orphan net)', async () => {
    // process.exit paths that bypass the async lifecycle shutdown (dev.ts
    // signal handlers, uncaught EADDRINUSE at listen time) must still take
    // the antfly child down — orphans keep 3738 bound across generations.
    _resetExitHookForTests()
    const before = process.listeners('exit')

    let readyzCalls = 0
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async () => {
      readyzCalls++
      if (readyzCalls === 1) throw new Error('connection refused')
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const started = await startAntflyServer({ enabled: true, url: LOCAL_DEFAULT_URL }, logger)
    expect(started).toBe(true)

    const added = process.listeners('exit').filter((l) => !before.includes(l))
    expect(added).toHaveLength(1)

    fakeChild.kill.mockClear()
    ;(added[0] as () => void)()
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM')
    _resetExitHookForTests()
  })

  it('refuses to adopt a listener that 200s readyz but serves garbage on the status endpoint', async () => {
    // The orphaned-server case: a wedged process holding our port answers
    // readyz with 200 but serves non-JSON on /db/v1/* — adopting it hands
    // the client a broken server while our own spawn can't bind behind it.
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/readyz')) return new Response('ok', { status: 200 })
      if (url.endsWith('/db/v1/status')) return new Response('<html>wedged</html>', { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    const started = await startAntflyServer({ enabled: true, url: LOCAL_DEFAULT_URL }, logger)

    expect(started).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('orphaned or wedged antfly'),
      expect.anything(),
    )
  })

  it('normalizes the localhost spelling of the private-instance URL to 127.0.0.1', async () => {
    const { mergeSettings } = await import('../../packages/adapter-antfly/src/defaults')
    const { isLocalDefaultUrl } = await import('../../packages/adapter-antfly/src/server')

    // Settings written before the dial-what-we-bind fix carry localhost;
    // every consumer must dial what the server binds (IPv4 127.0.0.1).
    expect(mergeSettings({ url: 'http://localhost:3738' }).url).toBe('http://127.0.0.1:3738')
    expect(isLocalDefaultUrl('http://localhost:3738')).toBe(true)
    expect(isLocalDefaultUrl('http://127.0.0.1:3738')).toBe(true)
    expect(isLocalDefaultUrl('http://search.internal:8080')).toBe(false)
  })

  it('never spawns for a non-default URL (guest mode)', async () => {
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch

    const started = await startAntflyServer({ enabled: true, url: 'http://search.internal:8080' }, logger)

    expect(started).toBe(false)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('External antfly server is not reachable'),
      expect.anything(),
    )
  })

  it('detects a pre-0.2 server via the legacy status signature', async () => {
    ;(globalThis as { fetch: typeof fetch }).fetch = mock(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/readyz')) return new Response('not found', { status: 404 })
      if (url.endsWith('/api/v1/status')) return new Response('{}', { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    }) as unknown as typeof fetch

    expect(await getServerHealthDetail('http://localhost:8080')).toEqual({
      reachable: false,
      legacyServer: true,
    })
  })
})
