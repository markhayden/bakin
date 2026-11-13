/** Home's decisions store: the only state Home keeps (home-first-run plan, task 1.3). */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-home-decisions-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { decisionsPath, readDecisions, updateDecisions } from '../../../plugins/home/lib/decisions'

beforeEach(() => rmSync(testDir, { recursive: true, force: true }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('home decisions', () => {
  it('nothing decided on a home that has no file, and reading creates nothing', () => {
    expect(readDecisions()).toEqual({ version: 1 })
    expect(() => readFileSync(decisionsPath())).toThrow()
  })

  it('a decision is written and read back', () => {
    updateDecisions((current) => ({ ...current, introduction: { status: 'skipped', at: '2026-11-13T12:00:00.000Z' } }))
    expect(readDecisions().introduction).toEqual({ status: 'skipped', at: '2026-11-13T12:00:00.000Z' })
  })

  it('keeps keys a newer version wrote, across a change made by this one', () => {
    mkdirSync(dirname(decisionsPath()), { recursive: true })
    writeFileSync(decisionsPath(), JSON.stringify({ version: 1, dismissedSuggestions: { discord: '2026-11-01T00:00:00.000Z' } }))
    updateDecisions((current) => ({ ...current, introduction: { status: 'completed', at: '2026-11-13T12:00:00.000Z' } }))
    expect(JSON.parse(readFileSync(decisionsPath(), 'utf-8'))).toEqual({
      version: 1,
      dismissedSuggestions: { discord: '2026-11-01T00:00:00.000Z' },
      introduction: { status: 'completed', at: '2026-11-13T12:00:00.000Z' },
    })
  })

  it('a file that cannot be read means nothing decided, and is left as it was', () => {
    mkdirSync(dirname(decisionsPath()), { recursive: true })
    writeFileSync(decisionsPath(), '{ not json')
    expect(readDecisions()).toEqual({ version: 1 })
    expect(readFileSync(decisionsPath(), 'utf-8')).toBe('{ not json')
  })

  it('refuses to write a decision it does not understand', () => {
    expect(() => updateDecisions((current) => ({ ...current, introduction: { status: 'maybe', at: 'x' } } as never))).toThrow()
    expect(() => readFileSync(decisionsPath())).toThrow()
  })
})
