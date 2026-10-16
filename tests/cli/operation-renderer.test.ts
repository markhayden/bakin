/**
 * CLI operation renderer + followOperation (#895 D11): frames and transition
 * lines from scripted views, results and exit codes, JSON mode, the SSE
 * follow against a real local stub (terminal event, restarted, expired,
 * reconnect with Last-Event-ID, rev guard), and Ctrl-C cancel-then-detach.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-cli-operation-renderer-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }) })
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import type { OperationView } from '@makinbakin/sdk/types'
import { followOperation } from '../../src/cli/http'
import {
  createOperationRenderer,
  describeResult,
  describeTransitions,
  followAndRender,
  operationExitCode,
  renderOperationFrame,
} from '../../src/cli/operation-renderer'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const ago = (s: number) => new Date(NOW - s * 1000).toISOString()

function view(over: Partial<OperationView> = {}): OperationView {
  return {
    id: 'op-1',
    children: [],
    rev: 1,
    bootId: 'boot-a',
    kind: 'repair',
    owner: 'core',
    origin: 'cli',
    title: 'Install the media store',
    fingerprint: 'f',
    resources: ['media-store'],
    status: 'running',
    plan: { stages: [{ id: 'dl', kind: 'downloading', label: 'Download sharp' }, { id: 'commit', kind: 'committing', label: 'Commit' }], pointOfNoReturn: 'commit' },
    stages: [
      { id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'active', startedAt: ago(20), bytes: { received: 12_400_000, total: 40_000_000 } },
      { id: 'commit', kind: 'committing', label: 'Commit', status: 'pending' },
    ],
    cancellable: true,
    startedAt: ago(65),
    lastProgressAt: ago(1),
    lastLivenessAt: ago(1),
    log: [],
    ...over,
  }
}

describe('renderOperationFrame', () => {
  it('draws the plan, the active bar with its measure, and the clock', () => {
    expect(renderOperationFrame(view(), [], NOW)).toEqual([
      'Install the media store · running · 1m 05s',
      '  ▸ Download sharp (20s)',
      '      [██████░░░░░░░░░░░░░░] 12.4 MB of 40.0 MB',
      '  · Commit',
    ])
  })

  it('says quiet, then stuck, from progress alone while output keeps arriving', () => {
    const quiet = renderOperationFrame(view({ lastProgressAt: ago(14), lastLivenessAt: ago(2), lastOutput: 'GET sharp-0.34.tgz' }), [], NOW)
    expect(quiet).toContain('      No measurable progress for 14s — still working')
    expect(quiet).toContain('      > GET sharp-0.34.tgz (2s ago)')
    const stuck = renderOperationFrame(view({ lastProgressAt: ago(190), lastLivenessAt: ago(1), lastOutput: 'retrying' }), [], NOW)
    expect(stuck).toContain('      ⚠ No progress for 3m 10s — this step may be stuck; nothing has been stopped')
  })

  it('shows attempts, waiting, unknown sizes, items, children under the first stage, and cancel limits', () => {
    const frame = renderOperationFrame(view({
      cancellable: false,
      waitingFor: { holderTitle: 'Install Copywriter', since: ago(40) },
      stages: [
        {
          id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'active', startedAt: ago(20),
          bytes: { received: 7_300_000, total: null },
          attempt: { n: 2, of: 3, reason: 'stalled', detail: 'no bytes for 30s' },
          items: [{ id: 'a', label: 'sharp.tgz', status: 'done' }, { id: 'b', label: 'libvips.tgz', status: 'active', bytes: { received: 1_000, total: 2_000 } }],
        },
        { id: 'commit', kind: 'committing', label: 'Commit', status: 'pending' },
      ],
    }), [view({ id: 'c1', parentId: 'op-1', title: 'Child repair', status: 'failed', outcome: { code: 'x', message: 'Checksum mismatch' } })], NOW)
    expect(frame).toContain('  … Waiting for Install Copywriter (40s); this starts when it finishes')
    expect(frame).toContain('      [░░░░░░░░░░░░░░░░░░░░] 7.3 MB · size unknown')
    expect(frame).toContain('      ↻ Attempt 2 of 3 — the transfer stalled (no bytes for 30s)')
    expect(frame).toContain('      ✓ sharp.tgz')
    expect(frame).toContain('      ▸ libvips.tgz 1.0 KB of 2.0 KB')
    expect(frame).toContain('      ✗ Child repair · failed')
    expect(frame).toContain('          Checksum mismatch')
    expect(frame.at(-1)).toBe('  Past the point of no return — it will finish')
    expect(renderOperationFrame(view({ cancellable: false, plan: { stages: [], pointOfNoReturn: 'start' } }), [], NOW).at(-1)).toBe("  Can't be cancelled")
  })
})

describe('describeTransitions (plain mode)', () => {
  it('prints one line per transition and byte quarters, never a flood', () => {
    const steps: OperationView[] = [
      view({ rev: 1, stages: [{ id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'active', startedAt: ago(20) }, { id: 'commit', kind: 'committing', label: 'Commit', status: 'pending' }] }),
      view({ rev: 2, stages: [{ id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'active', startedAt: ago(20), bytes: { received: 5, total: 100 } }, { id: 'commit', kind: 'committing', label: 'Commit', status: 'pending' }] }),
      view({ rev: 3, stages: [{ id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'active', startedAt: ago(20), bytes: { received: 30, total: 100 } }, { id: 'commit', kind: 'committing', label: 'Commit', status: 'pending' }] }),
      view({ rev: 4, stages: [{ id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'active', startedAt: ago(20), bytes: { received: 31, total: 100 }, attempt: { n: 2, of: 3, reason: 'network' } }, { id: 'commit', kind: 'committing', label: 'Commit', status: 'pending' }] }),
      view({ rev: 5, stages: [{ id: 'dl', kind: 'downloading', label: 'Download sharp', status: 'done', startedAt: ago(20), endedAt: ago(8), bytes: { received: 100, total: 100 } }, { id: 'commit', kind: 'committing', label: 'Commit', status: 'active' }] }),
    ]
    const lines: string[] = []
    let prev: { view: OperationView; children: OperationView[] } | null = null
    for (const step of steps) {
      lines.push(...describeTransitions(prev, { view: step, children: [] }))
      prev = { view: step, children: [] }
    }
    expect(lines).toEqual([
      'Install the media store',
      '  ▸ Download sharp',
      '    30 B of 100 B',
      '    ↻ Attempt 2 of 3 — the connection failed',
      '  ✓ Download sharp (12s)',
      '  ▸ Commit',
    ])
  })

  it('reports children, waiting, and cancelling', () => {
    const base = { view: view(), children: [] as OperationView[] }
    expect(describeTransitions(base, { view: view({ waitingFor: { holderTitle: 'Reindex', since: ago(1) } }), children: [] })).toEqual(['  … Waiting for Reindex'])
    expect(describeTransitions(base, { view: view({ status: 'cancelling' }), children: [] })).toEqual(['  Cancelling…'])
    const kid = view({ id: 'c', parentId: 'op-1', title: 'Sync agents' })
    expect(describeTransitions(base, { view: view(), children: [kid] })).toEqual(['  ▸ Sync agents'])
    expect(describeTransitions({ view: view(), children: [kid] }, { view: view(), children: [{ ...kid, status: 'succeeded', outcome: { code: 'ok' } }] })).toEqual(['  ✓ Sync agents: succeeded'])
  })
})

describe('results', () => {
  it('describes every phase and maps exit codes', () => {
    const done = (status: OperationView['status'], code = 'ok', message?: string) => ({ phase: 'finished' as const, operation: view({ status, outcome: { code, ...(message ? { message } : {}) } }), children: [] })
    expect(describeResult(done('succeeded', 'ok', 'Installed.'))).toBe('✓ Install the media store finished — Installed.')
    expect(describeResult(done('failed', 'partially_applied'))).toBe('✗ Install the media store partially applied')
    expect(describeResult(done('cancelled', 'cancelled'))).toBe('– Install the media store was cancelled before anything changed')
    expect(describeResult({ phase: 'restarted', operation: view(), children: [] })).toContain('outcome is unknown')
    expect(describeResult({ phase: 'detached', operation: view(), children: [] })).toContain('keeps running')
    expect(operationExitCode(done('succeeded'))).toBe(0)
    expect(operationExitCode(done('failed', 'apply_failed'))).toBe(1)
    expect(operationExitCode(done('cancelled', 'cancelled'))).toBe(130)
    expect(operationExitCode({ phase: 'detached', operation: view(), children: [] })).toBe(130)
    expect(operationExitCode({ phase: 'restarted', operation: view(), children: [] })).toBe(1)
  })

  it('JSON mode is silent while running and prints one document at the end', () => {
    const written: string[] = []
    const r = createOperationRenderer({ mode: 'json', write: (t) => written.push(t), tickMs: 0 })
    r.update(view(), [])
    r.note('ignored')
    expect(written).toEqual([])
    r.finish({ phase: 'finished', operation: view({ status: 'succeeded' }), children: [] })
    expect(JSON.parse(written.join(''))).toMatchObject({ phase: 'finished', operation: { id: 'op-1', status: 'succeeded' }, children: [] })
  })
})

// ---------------------------------------------------------------------------
// followOperation against a real local SSE stub
// ---------------------------------------------------------------------------

interface Stub {
  url: string
  push(view: OperationView, id?: number): void
  dropStreams(): void
  snapshot: { status: number; body: unknown }
  lastEventIds: Array<string | null>
  cancels: string[]
  cancelAnswer: { status: number; body: unknown }
  stop(): void
}

// Real sockets need Bun's native classes (the DOM preload replaces Response).
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
const bunServe = (Bun as unknown as {
  serve: (opts: { port: number; fetch: (req: Request) => Response | Promise<Response> }) => { port: number; stop: (force?: boolean) => void }
}).serve
const json = (body: unknown, status = 200) => new NativeResponse(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubServer(): Stub {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const stub = {
    snapshot: { status: 200, body: { bootId: 'boot-a', operation: view(), children: [] } as unknown },
    lastEventIds: [] as Array<string | null>,
    cancels: [] as string[],
    cancelAnswer: { status: 202, body: { bootId: 'boot-a', status: 'cancelling' } as unknown },
  } as Stub
  const server = bunServe({
    port: 0,
    fetch(req: Request) {
      const url = new URL(req.url)
      if (url.pathname === '/api/events') {
        stub.lastEventIds.push(req.headers.get('last-event-id'))
        let me: ReadableStreamDefaultController<Uint8Array>
        return new NativeResponse(new ReadableStream<Uint8Array>({
          start(controller) { me = controller; streams.add(controller); controller.enqueue(encoder.encode(': hi\n\n')) },
          cancel() { streams.delete(me) },
        }), { headers: { 'content-type': 'text/event-stream' } })
      }
      if (url.pathname.endsWith('/cancel')) {
        stub.cancels.push(url.pathname)
        return json(stub.cancelAnswer.body, stub.cancelAnswer.status)
      }
      if (url.pathname.startsWith('/api/operations/')) return json(stub.snapshot.body, stub.snapshot.status)
      return new NativeResponse('nope', { status: 404 })
    },
  })
  stub.url = `http://127.0.0.1:${server.port}`
  stub.push = (v, id) => {
    const frame = `${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify({ type: 'plugin-event', event: 'operation.updated', view: v })}\n\n`
    for (const c of streams) c.enqueue(encoder.encode(frame))
  }
  stub.dropStreams = () => {
    for (const c of [...streams]) { c.close(); streams.delete(c) }
  }
  stub.stop = () => server.stop(true)
  return stub
}

describe('followOperation', () => {
  const originalFetch = globalThis.fetch
  let stub: Stub
  beforeAll(() => { globalThis.fetch = nativeFetch })
  afterAll(() => { globalThis.fetch = originalFetch })
  afterEach(() => stub?.stop())

  const waitFor = async (cond: () => boolean, label: string) => {
    const deadline = Date.now() + 5_000
    while (!cond()) {
      if (Date.now() > deadline) throw new Error(`timed out: ${label}`)
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  it('applies events under the rev guard and settles on the terminal view', async () => {
    stub = stubServer()
    const seen: number[] = []
    const following = followOperation({ operationId: 'op-1', bootId: 'boot-a' }, { baseUrl: stub.url, reconcileMs: 60_000, onUpdate: ({ operation }) => seen.push(operation.rev) })
    await waitFor(() => stub.lastEventIds.length === 1 && seen.length > 0, 'connected + snapshot')
    stub.push(view({ rev: 3 }), 1)
    stub.push(view({ rev: 2 }), 2)
    stub.push(view({ id: 'other', rev: 9 }), 3)
    stub.push(view({ id: 'c1', parentId: 'op-1', rev: 1, children: [] }), 4)
    stub.push(view({ rev: 4, children: ['c1'] }), 5)
    stub.push(view({ rev: 5, status: 'succeeded', children: ['c1'], outcome: { code: 'ok' } }), 6)
    const result = await following
    expect(result.phase).toBe('finished')
    expect(result.operation?.rev).toBe(5)
    expect(result.children.map((c) => c.id)).toEqual(['c1'])
    expect(seen).toEqual([1, 3, 3, 4, 5])
  })

  it('reconnects with Last-Event-ID and reconciles a milestone missed while down', async () => {
    stub = stubServer()
    const following = followOperation({ operationId: 'op-1', bootId: 'boot-a' }, { baseUrl: stub.url, reconcileMs: 60_000, reconnectMs: { initial: 10, max: 10 } })
    await waitFor(() => stub.lastEventIds.length === 1, 'connected')
    stub.push(view({ rev: 2 }), 41)
    await new Promise((r) => setTimeout(r, 20))
    stub.snapshot = { status: 200, body: { bootId: 'boot-a', operation: view({ rev: 7, status: 'failed', outcome: { code: 'download_failed' } }), children: [] } }
    stub.dropStreams()
    const result = await following
    expect(stub.lastEventIds).toEqual([null, '41'])
    expect(result.operation?.outcome?.code).toBe('download_failed')
  })

  it('is restarted when the snapshot comes from another boot and expired on a same-boot 404', async () => {
    stub = stubServer()
    stub.snapshot = { status: 404, body: { bootId: 'boot-b', error: 'not_found' } }
    expect((await followOperation({ operationId: 'op-1', bootId: 'boot-a' }, { baseUrl: stub.url, reconcileMs: 60_000 })).phase).toBe('restarted')
    stub.snapshot = { status: 404, body: { bootId: 'boot-a', error: 'not_found' } }
    expect((await followOperation({ operationId: 'op-1', bootId: 'boot-a' }, { baseUrl: stub.url, reconcileMs: 60_000 })).phase).toBe('expired')
  })

  it('Ctrl-C once cancels, twice detaches', async () => {
    stub = stubServer()
    const signals = new EventEmitter()
    const out: string[] = []
    const following = followAndRender({ operationId: 'op-1', bootId: 'boot-a' }, { mode: 'plain', write: (t) => out.push(t), signals: signals as never, baseUrl: stub.url })
    await waitFor(() => out.length > 0, 'first render')
    signals.emit('SIGINT')
    await waitFor(() => stub.cancels.length === 1, 'cancel posted')
    expect(out.join('')).toContain('Cancelling… press Ctrl-C again to stop watching')
    signals.emit('SIGINT')
    const result = await following
    expect(result.phase).toBe('detached')
    expect(operationExitCode(result)).toBe(130)
    expect(signals.listenerCount('SIGINT')).toBe(0)
  })

  it('Ctrl-C on a non-cancellable operation explains and never posts cancel', async () => {
    stub = stubServer()
    stub.snapshot = { status: 200, body: { bootId: 'boot-a', operation: view({ cancellable: false, plan: { stages: [], pointOfNoReturn: 'start' } }), children: [] } }
    const signals = new EventEmitter()
    const out: string[] = []
    const following = followAndRender({ operationId: 'op-1', bootId: 'boot-a' }, { mode: 'plain', write: (t) => out.push(t), signals: signals as never, baseUrl: stub.url })
    await waitFor(() => out.length > 0, 'first render')
    signals.emit('SIGINT')
    expect(out.join('')).toContain("This can't be cancelled — press Ctrl-C again to stop watching (it keeps running)")
    signals.emit('SIGINT')
    expect((await following).phase).toBe('detached')
    expect(stub.cancels).toEqual([])
  })
})
