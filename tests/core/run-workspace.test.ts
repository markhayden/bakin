/**
 * Core run-workspace module (same-agent-concurrency D2/D5): collision-proof
 * encoding, sidecar-with-mkdir allocation, tolerant reads (torn == missing),
 * settle stamping with one-time size, eager removal.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
  runWorkspacePathFor,
  settleRunWorkspace,
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
