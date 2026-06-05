/**
 * Tests for the in-memory task-store index (id→path + column buckets).
 *
 * Exercises createFileBakinTaskStore directly against a temp root — the store
 * receives its root explicitly, so no content-dir resolution is involved, but
 * BAKIN_HOME is still pointed at the temp dir as a safety net per repo rules.
 */
import { describe, it, expect, beforeEach, afterAll, spyOn, mock } from 'bun:test'
import * as fs from 'fs'
import { mkdirSync, rmSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testHome = join(tmpdir(), `bakin-task-index-test-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testHome

// Standard isolation mocks (CLAUDE.md test rules) — the store under test gets
// its root passed explicitly, but these guarantee nothing can resolve ~/.bakin/.
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ tasks: join(testHome, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testHome,
  getBakinPaths: () => ({ tasks: join(testHome, 'tasks') }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
// Not imported by this test (it targets the package-level store directly), but
// mocked so an accidental transitive import can never reach the real ~/.bakin/.
mock.module('../../src/core/task-store', () => ({
  getSharedBakinTaskStore: () => { throw new Error('app-level task-store not available in this test') },
}))

import { createFileBakinTaskStore, createEmptyBakinTask, type BakinTask, type SyncBakinTaskStore } from '@bakin/core/tasks/store'

let root: string
let store: SyncBakinTaskStore

beforeEach(() => {
  root = join(testHome, `tasks-${randomUUID()}`)
  mkdirSync(root, { recursive: true })
  store = createFileBakinTaskStore(root)
})

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})

function writeExternalTask(id: string, column = 'todo', createdAt = new Date().toISOString()): string {
  const task: BakinTask = createEmptyBakinTask({ id, title: `external ${id}`, column }, createdAt)
  const shard = createdAt.slice(0, 7)
  const dir = join(root, shard)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `task-${id}.json`)
  writeFileSync(path, JSON.stringify(task, null, 2), 'utf-8')
  return path
}

describe('index consistency', () => {
  it('counts by column across create/move/delete', () => {
    store.createSync({ id: 'a', title: 'a', column: 'todo' })
    store.createSync({ id: 'b', title: 'b', column: 'todo' })
    store.createSync({ id: 'c', title: 'c', column: 'inProgress' })

    expect(store.countByColumnSync('todo')).toBe(2)
    expect(store.countByColumnSync('inProgress')).toBe(1)

    store.updateSync('a', { column: 'inProgress' })
    expect(store.countByColumnSync('todo')).toBe(1)
    expect(store.countByColumnSync('inProgress')).toBe(2)

    store.removeSync('b')
    expect(store.countByColumnSync('todo')).toBe(0)
  })

  it('matches listSync({column}).length including pendingDelete exclusion', () => {
    store.createSync({ id: 'a', title: 'a', column: 'todo' })
    store.createSync({ id: 'b', title: 'b', column: 'todo' })
    store.markPendingDeleteSync('b', true)

    expect(store.countByColumnSync('todo')).toBe(store.listSync({ column: 'todo' }).length)
    expect(store.countByColumnSync('todo')).toBe(1)
  })

  it('createSync rejects duplicate ids via the index', () => {
    store.createSync({ id: 'dup', title: 'one' })
    expect(() => store.createSync({ id: 'dup', title: 'two' })).toThrow(/already exists/)
  })
})

describe('self-healing', () => {
  it('getSync finds an externally-written task file and repairs the index', () => {
    // Warm the index first so the external write is genuinely unseen.
    store.createSync({ id: 'seed', title: 'seed' })
    expect(store.countByColumnSync('todo')).toBe(1)

    writeExternalTask('ext-1', 'todo')
    const found = store.getSync('ext-1')
    expect(found?.id).toBe('ext-1')
    // Repaired into the index: now counted.
    expect(store.countByColumnSync('todo')).toBe(2)
  })

  it('tolerates external deletion of a task file', () => {
    store.createSync({ id: 'gone', title: 'gone', column: 'todo' })
    store.createSync({ id: 'stays', title: 'stays', column: 'todo' })
    expect(store.countByColumnSync('todo')).toBe(2)

    const raw = store.getSync('gone')
    expect(raw).not.toBeNull()
    // Delete behind the store's back (e.g. test cleanup / manual rm).
    for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue
      const p = join(root, shard.name, 'task-gone.json')
      if (fs.existsSync(p)) unlinkSync(p)
    }

    expect(store.getSync('gone')).toBeNull()
    expect(store.countByColumnSync('todo')).toBe(1)
  })

  it('picks up an external column edit on read', () => {
    store.createSync({ id: 'moved', title: 'moved', column: 'todo' })
    expect(store.countByColumnSync('todo')).toBe(1)

    // Hand-edit the column on disk.
    for (const shard of fs.readdirSync(root, { withFileTypes: true })) {
      if (!shard.isDirectory()) continue
      const p = join(root, shard.name, 'task-moved.json')
      if (fs.existsSync(p)) {
        const task = JSON.parse(fs.readFileSync(p, 'utf-8')) as BakinTask
        task.column = 'blocked'
        writeFileSync(p, JSON.stringify(task, null, 2), 'utf-8')
      }
    }

    expect(store.getSync('moved')?.column).toBe('blocked')
    // Index refreshed from the read.
    expect(store.countByColumnSync('todo')).toBe(0)
    expect(store.countByColumnSync('blocked')).toBe(1)
  })
})

describe('IO regression — no full scans on hot ops', () => {
  it('appendLogSync does not scale file reads or dir walks with store size', () => {
    const N = 40
    for (let i = 0; i < N; i++) store.createSync({ id: `t${i}`, title: `t${i}` })

    // Warm everything.
    store.getSync('t0')

    const readSpy = spyOn(fs, 'readFileSync')
    const dirSpy = spyOn(fs, 'readdirSync')
    readSpy.mockClear()
    dirSpy.mockClear()

    const K = 5
    for (let i = 0; i < K; i++) {
      store.appendLogSync('t1', { timestamp: new Date().toISOString(), author: 'test', message: `log ${i}` })
    }

    // Each append needs exactly one content read of the target task; no shard walks.
    expect(readSpy.mock.calls.length).toBe(K)
    expect(dirSpy.mock.calls.length).toBe(0)

    readSpy.mockRestore()
    dirSpy.mockRestore()
  })

  it('getSync on a warm index performs one read and no dir walks', () => {
    for (let i = 0; i < 10; i++) store.createSync({ id: `g${i}`, title: `g${i}` })
    store.getSync('g0') // warm

    const readSpy = spyOn(fs, 'readFileSync')
    const dirSpy = spyOn(fs, 'readdirSync')
    readSpy.mockClear()
    dirSpy.mockClear()

    expect(store.getSync('g5')?.id).toBe('g5')
    expect(readSpy.mock.calls.length).toBe(1)
    expect(dirSpy.mock.calls.length).toBe(0)

    readSpy.mockRestore()
    dirSpy.mockRestore()
  })

  it('countByColumnSync performs zero file reads', () => {
    for (let i = 0; i < 10; i++) store.createSync({ id: `c${i}`, title: `c${i}` })
    store.countByColumnSync('todo') // warm

    const readSpy = spyOn(fs, 'readFileSync')
    readSpy.mockClear()
    expect(store.countByColumnSync('todo')).toBe(10)
    expect(readSpy.mock.calls.length).toBe(0)
    readSpy.mockRestore()
  })
})
