import { afterAll, beforeAll, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-activity-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, audit: join(testDir, 'audit.jsonl'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@/core/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const logError = mock()
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: logError, debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('@/core/logger', loggerMock)
mock.module('../../src/core/watcher', () => ({ start: mock(), stop: mock() }))

const board = {
  columns: {
    todo: [] as unknown[],
    inProgress: [
      {
        id: 'task-1', title: 'One',
        log: [
          { timestamp: '2026-10-26T20:00:00.000Z', author: 'pixel', message: 'same instant A' },
          { timestamp: '2026-10-26T20:00:00.000Z', author: 'pixel', message: 'same instant B' },
        ],
      },
      { id: 'task-2', title: 'Two', log: [{ timestamp: '2026-10-26T20:00:00.000Z', author: 'pixel', message: 'same instant A' }] },
    ],
  },
}
const readTaskboard = mock(() => board)
const taskStoreMock = () => ({ readTaskboard })
mock.module('../../src/core/task-store', taskStoreMock)
mock.module('@/core/task-store', taskStoreMock)

import { auditActivityId, taskLogActivityId } from '../../packages/core/src/events/activity-id'
// Dynamic import AFTER the mocks: the handler creates its logger at module load.
const { ACTIVITY_LIMIT, get } = await import('../../packages/host/src/api/activity')

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  const lines: string[] = []
  for (let i = 0; i < 2000; i++) {
    lines.push(JSON.stringify({ ts: new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), event: 'task.created', agent: 'main', data: { taskId: `t-${i}`, title: `T${i}` } }))
  }
  writeFileSync(join(testDir, 'audit.jsonl'), lines.join('\n') + '\n')
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

async function feed(): Promise<Array<{ id: string; type: string; ts: string; taskId?: string }>> {
  const res = await get(new Request('http://localhost/api/activity'))
  return ((await res.json()) as { events: Array<{ id: string; type: string; ts: string; taskId?: string }> }).events
}

describe('GET /api/activity', () => {
  it('reads the audit log through the bounded reader, never a whole-file read', async () => {
    const fs = await import('fs')
    const readFileSpy = spyOn(fs, 'readFileSync')
    readFileSpy.mockClear()
    const events = await feed()
    const auditReads = readFileSpy.mock.calls.filter((c) => String(c[0]).endsWith('audit.jsonl'))
    readFileSpy.mockRestore()
    expect(auditReads).toHaveLength(0)
    expect(events).toHaveLength(ACTIVITY_LIMIT)
  })

  it('derives ids with the shared activity identities', async () => {
    const events = await feed()
    const audit = events.find((e) => e.type === 'audit')!
    expect(audit.id).toBe(auditActivityId({ ts: audit.ts, event: 'task.created', agent: 'main' }))
    const logs = events.filter((e) => e.type === 'log')
    expect(logs.map((e) => e.id).sort()).toEqual([
      taskLogActivityId('task-1', '2026-10-26T20:00:00.000Z', 'pixel', 'same instant A'),
      taskLogActivityId('task-1', '2026-10-26T20:00:00.000Z', 'pixel', 'same instant B'),
      taskLogActivityId('task-2', '2026-10-26T20:00:00.000Z', 'pixel', 'same instant A'),
    ].sort())
  })

  it('keeps every id unique (same instant, same author, different tasks/messages)', async () => {
    const ids = (await feed()).map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('logs (and survives) a task-board failure', async () => {
    logError.mockClear()
    readTaskboard.mockImplementationOnce(() => { throw new Error('store down') })
    const events = await feed()
    expect(events.every((e) => e.type === 'audit')).toBe(true)
    expect(logError).toHaveBeenCalledWith('Failed to read task logs for the activity feed', expect.any(Error))
  })
})
