/**
 * Core run-workspace module (same-agent-concurrency D2/D5): collision-proof
 * encoding, sidecar-with-mkdir allocation, tolerant reads (torn == missing),
 * settle stamping with one-time size, eager removal.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-run-ws-test-'))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  allocateRunWorkspace,
  dirSizeBytes,
  encodeRunId,
  readRunSidecar,
  removeRunWorkspace,
  resetRunWorkspaceStats,
  runWorkspacePathFor,
  settleRunWorkspace,
  sweepRunWorkspaces,
  type RunWorkspaceSweepDeps,
} from '../../src/core/run-workspace'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('encodeRunId', () => {
  it('flattens unsafe chars and stays filesystem-safe', () => {
    expect(encodeRunId('task:abc:d1')).toMatch(/^task-abc-d1-[0-9a-f]{8}$/)
  })

  it('ids whose flattened forms collide still get distinct dirs (hash disambiguation)', () => {
    // Naive `:`→`-` flattening maps BOTH of these to 'task-a-d1-d2'.
    const a = encodeRunId('task:a:d1:d2')
    const b = encodeRunId('task:a-d1:d2')
    expect(a).not.toBe(b)
  })
})

describe('allocate + sidecar', () => {
  it('allocation writes the sidecar in the same synchronous block as mkdir', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t1:d1', taskId: 't1', agentId: 'jessica' })
    expect(existsSync(dir)).toBe(true)
    const sidecar = readRunSidecar(dir)
    expect(sidecar?.status).toBe('running')
    expect(sidecar?.threadId).toBe('task:t1:d1')
    expect(sidecar?.taskId).toBe('t1')
    expect(sidecar?.agentId).toBe('jessica')
    expect(dir).toBe(runWorkspacePathFor('jessica', 'task:t1:d1'))
  })

  it('workflow-step allocation records the stepId', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t2:step:s1:d1', taskId: 't2', stepId: 's1', agentId: 'pixel' })
    expect(readRunSidecar(dir)?.stepId).toBe('s1')
  })

  it('a torn/unparseable sidecar reads as null (missing) — never throws', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t3:d1', taskId: 't3', agentId: 'jessica' })
    writeFileSync(join(dir, '.bakin-run.json'), '{ "version": 1, "threadId": "tor')
    expect(readRunSidecar(dir)).toBeNull()
  })

  it('settle stamps outcome + one-time recursive size', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t4:d1', taskId: 't4', agentId: 'jessica' })
    writeFileSync(join(dir, 'scratch.txt'), 'x'.repeat(1000))
    settleRunWorkspace('jessica', 'task:t4:d1', 'ok')
    const sidecar = readRunSidecar(dir)
    expect(sidecar?.status).toBe('settled')
    expect(sidecar?.outcome).toBe('ok')
    expect(sidecar?.settledAt).toBeTruthy()
    expect(sidecar?.sizeBytes ?? 0).toBeGreaterThanOrEqual(1000)
  })

  it('settling a never-allocated run is a silent no-op', () => {
    expect(() => settleRunWorkspace('jessica', 'task:ghost:d9', 'ok')).not.toThrow()
  })

  it('removeRunWorkspace deletes recursively and tolerates repeats', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t5:d1', taskId: 't5', agentId: 'jessica' })
    writeFileSync(join(dir, 'a.txt'), 'a')
    removeRunWorkspace(dir)
    expect(existsSync(dir)).toBe(false)
    expect(() => removeRunWorkspace(dir)).not.toThrow()
  })

  it('dirSizeBytes tolerates entries vanishing mid-walk', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t6:d1', taskId: 't6', agentId: 'jessica' })
    writeFileSync(join(dir, 'b.txt'), 'bb')
    expect(dirSizeBytes(dir)).toBeGreaterThan(0)
    expect(dirSizeBytes(join(dir, 'no-such-subdir'))).toBe(0)
  })

  it('sidecar JSON round-trips through readFileSync (atomic rename left no .tmp)', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:t7:d1', taskId: 't7', agentId: 'jessica' })
    expect(existsSync(join(dir, '.bakin-run.json.tmp'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, '.bakin-run.json'), 'utf-8')).version).toBe(1)
  })
})

describe('sweep classifier + budget (D5 matrix)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const liveThreads = new Set<string>()
  const deadTasks = new Set<string>()
  const deps = (over: Partial<RunWorkspaceSweepDeps> = {}): RunWorkspaceSweepDeps => ({
    isTurnLive: (t) => liveThreads.has(t),
    taskExists: (t) => !deadTasks.has(t),
    retentionDays: 7,
    maxTotalBytes: 0,
    graceMs: 10 * 60 * 1000,
    ...over,
  })

  function seedSettled(thread: string, task: string, outcome: string, settledAgoMs: number, sizeBytes = 100): string {
    const dir = allocateRunWorkspace({ threadId: thread, taskId: task, agentId: 'sweep-agent' })
    const sidecar = readRunSidecar(dir)!
    writeFileSync(join(dir, '.bakin-run.json'), JSON.stringify({
      ...sidecar, status: 'settled', outcome, settledAt: new Date(Date.now() - settledAgoMs).toISOString(), sizeBytes,
    }))
    return dir
  }

  it('runs the full state matrix: live kept, aged-ok expired, failed windows, deleted-task immediate, grace honored', async () => {
    resetRunWorkspaceStats()
    liveThreads.clear(); deadTasks.clear()

    const liveDir = seedSettled('task:m-live:d1', 'm-live', 'ok', 30 * DAY)
    liveThreads.add('task:m-live:d1') // live registry outranks any age

    const freshOk = seedSettled('task:m-fresh:d1', 'm-fresh', 'ok', 1 * DAY)
    const agedOk = seedSettled('task:m-aged:d1', 'm-aged', 'ok', 8 * DAY)
    const freshFail = seedSettled('task:m-ffail:d1', 'm-ffail', 'failed: x', 20 * DAY)
    const agedFail = seedSettled('task:m-afail:d1', 'm-afail', 'lost: session-death', 31 * DAY)
    const deleted = seedSettled('task:m-del:d1', 'm-del', 'ok', 0)
    deadTasks.add('m-del')
    const young = allocateRunWorkspace({ threadId: 'task:m-young:d1', taskId: 'm-young', agentId: 'sweep-agent' }) // running, unregistered, young

    await sweepRunWorkspaces(deps())

    expect(existsSync(liveDir)).toBe(true)      // live registry → kept
    expect(existsSync(freshOk)).toBe(true)      // ok within 7d → kept
    expect(existsSync(agedOk)).toBe(false)      // ok past 7d → gone
    expect(existsSync(freshFail)).toBe(true)    // failed within 30d → kept (salvage)
    expect(existsSync(agedFail)).toBe(false)    // failed past 30d → gone
    expect(existsSync(deleted)).toBe(false)     // task deleted → immediate
    expect(existsSync(young)).toBe(true)        // grace window → kept

    for (const d of [liveDir, freshOk, freshFail, young]) removeRunWorkspace(d)
  })

  it('size budget evicts oldest SETTLED dirs first and never touches live or in-grace dirs', async () => {
    resetRunWorkspaceStats()
    liveThreads.clear(); deadTasks.clear()

    const oldest = seedSettled('task:b-old:d1', 'b-old', 'ok', 6 * DAY, 500)
    const newer = seedSettled('task:b-new:d1', 'b-new', 'ok', 1 * DAY, 500)
    const liveBig = seedSettled('task:b-live:d1', 'b-live', 'ok', 6 * DAY, 5000)
    liveThreads.add('task:b-live:d1')
    const inGrace = allocateRunWorkspace({ threadId: 'task:b-grace:d1', taskId: 'b-grace', agentId: 'sweep-agent' })

    // Budget forces eviction: total settled+live sizes exceed 1000.
    await sweepRunWorkspaces(deps({ maxTotalBytes: 1000 }))

    expect(existsSync(oldest)).toBe(false)  // oldest evictable went first
    expect(existsSync(liveBig)).toBe(true)  // live NEVER evicted, even over budget
    expect(existsSync(inGrace)).toBe(true)  // grace NEVER evicted

    for (const d of [newer, liveBig, inGrace]) removeRunWorkspace(d)
  })

  it('lazy-stamps sizeBytes onto settled sidecars that lack it, and reports aggregate stats', async () => {
    resetRunWorkspaceStats()
    liveThreads.clear(); deadTasks.clear()

    const dir = allocateRunWorkspace({ threadId: 'task:s-stamp:d1', taskId: 's-stamp', agentId: 'sweep-agent' })
    writeFileSync(join(dir, 'payload.bin'), 'x'.repeat(2048))
    const sidecar = readRunSidecar(dir)!
    // Settled WITHOUT sizeBytes (simulates a pre-crash settle path).
    writeFileSync(join(dir, '.bakin-run.json'), JSON.stringify({
      ...sidecar, status: 'settled', outcome: 'ok', settledAt: new Date().toISOString(),
    }))

    const stats = await sweepRunWorkspaces(deps())
    expect(readRunSidecar(dir)?.sizeBytes ?? 0).toBeGreaterThanOrEqual(2048)
    expect(stats?.count ?? 0).toBeGreaterThanOrEqual(1)
    expect(stats?.sizeBytes ?? 0).toBeGreaterThanOrEqual(2048)
    removeRunWorkspace(dir)
  })
})

describe('worktree-aware accounting (review F5/F6/F7 fixes)', () => {
  it('sidecar sizes are SCRATCH-only: the top-level repo/ checkout never counts', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:acct:d1', taskId: 'acct', agentId: 'jessica' })
    writeFileSync(join(dir, 'notes.txt'), 'x'.repeat(500))
    mkdirSync(join(dir, 'repo', 'src'), { recursive: true })
    writeFileSync(join(dir, 'repo', 'src', 'huge.bin'), 'y'.repeat(100_000))
    settleRunWorkspace('jessica', 'task:acct:d1', 'ok')
    const size = readRunSidecar(dir)?.sizeBytes ?? -1
    expect(size).toBeGreaterThanOrEqual(500)
    expect(size).toBeLessThan(100_000) // checkout excluded
    removeRunWorkspace(dir)
  })

  it('settle stamping is first-write-wins: a late force-release cannot re-stamp a settled sidecar', () => {
    const dir = allocateRunWorkspace({ threadId: 'task:fww:d1', taskId: 'fww', agentId: 'jessica' })
    settleRunWorkspace('jessica', 'task:fww:d1', 'ok')
    settleRunWorkspace('jessica', 'task:fww:d1', 'lost: force-released')
    expect(readRunSidecar(dir)?.outcome).toBe('ok')
    removeRunWorkspace(dir)
  })

  it('budget eviction skips checkout-bearing dirs (plain rm would strand git worktree metadata)', async () => {
    resetRunWorkspaceStats()
    const bare = allocateRunWorkspace({ threadId: 'task:ev-a:d1', taskId: 'ev-a', agentId: 'jessica' })
    const withRepo = allocateRunWorkspace({ threadId: 'task:ev-b:d1', taskId: 'ev-b', agentId: 'jessica' })
    const DAY = 24 * 60 * 60 * 1000
    // withRepo settled 1 day ago: inside the 48h checkout window, so its
    // repoPath survives this pass and the budget must skip it.
    for (const [dir, ago, extra] of [[bare, 6 * DAY, {}], [withRepo, 1 * DAY, { repoPath: '/no/such/repo' }]] as const) {
      const sidecar = readRunSidecar(dir)!
      writeFileSync(join(dir, '.bakin-run.json'), JSON.stringify({
        ...sidecar, ...extra, status: 'settled', outcome: 'failed: x',
        settledAt: new Date(Date.now() - ago).toISOString(), sizeBytes: 600,
      }))
    }
    await sweepRunWorkspaces({
      isTurnLive: () => false, taskExists: () => true,
      retentionDays: 7, maxTotalBytes: 700, graceMs: 10 * 60 * 1000,
    })
    // The bare dir was evicted to satisfy the budget; the checkout-bearing
    // one survives — a dir still carrying repoPath is never budget-evicted
    // (its worktree detaches through the 48h sweep first).
    expect(existsSync(bare)).toBe(false)
    expect(existsSync(withRepo)).toBe(true)
    removeRunWorkspace(withRepo)
  })
})
