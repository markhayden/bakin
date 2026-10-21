/** The engine-owned updates file: validated on read, atomic on write, invalid ⇒ discarded. */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-store-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const warnings: string[] = []
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: (message: string) => { warnings.push(message) }, error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import type { UpdateRecord } from '@makinbakin/sdk/types'
import type { UpdatesFile } from '../../../src/core/updates/store'

// Dynamic, after the mocks: the store creates its logger at module load, and a
// hoisted static import would bind the real (silenced) logger before the mock lands.
const { emptyUpdatesFile, readUpdatesFile, writeUpdatesFile } = await import('../../../src/core/updates/store')

const record: UpdateRecord = {
  id: 'plugin:projects',
  group: 'available',
  subject: { kind: 'plugin', id: 'projects', label: 'Projects' },
  installed: { version: '0.11.4', display: '0.11.4' },
  available: { version: '0.11.5', display: '0.11.5' },
  reason: 'newer-version',
  outcome: 'update-available',
  source: { kind: 'artifact-index', endpoint: 'github:markhayden/bakin-bits-official#plugins/projects' },
  observedAt: '2026-10-20T10:00:00.000Z',
  attempt: { at: '2026-10-20T10:00:00.000Z' },
  fingerprint: 'abc',
  action: { kind: 'operation', start: { route: '/api/plugins/projects/upgrade' }, impact: ['download'] },
}

describe('updates store', () => {
  it('round-trips a file atomically with a trailing newline and no leftover temp file', () => {
    const path = join(testDir, 'a', 'updates.json')
    const file: UpdatesFile = {
      ...emptyUpdatesFile(),
      records: { [record.id]: record },
      schedule: { [record.id]: { lastCheckedAt: '2026-10-20T10:00:00.000Z', nextDueAt: '2026-10-20T16:00:00.000Z', failures: 0 } },
      conditional: { 'https://api.github.com/repos/x/y/releases/latest': { etag: '"e1"', body: { tag_name: 'v1' }, updatedAt: '2026-10-20T10:00:00.000Z' } },
    }
    writeUpdatesFile(path, file)
    expect(readFileSync(path, 'utf-8').endsWith('\n')).toBe(true)
    expect(readdirSync(join(testDir, 'a')).filter((name) => name.includes('.tmp-'))).toEqual([])
    expect(readUpdatesFile(path)).toEqual(file)
  })

  it('a missing file reads as null without a warning', () => {
    warnings.length = 0
    expect(readUpdatesFile(join(testDir, 'nope', 'updates.json'))).toBeNull()
    expect(warnings).toEqual([])
  })

  it('unparseable JSON is logged and discarded, never thrown', () => {
    warnings.length = 0
    const path = join(testDir, 'bad.json')
    writeFileSync(path, '{not json')
    expect(readUpdatesFile(path)).toBeNull()
    expect(warnings.some((message) => /updates file/i.test(message))).toBe(true)
  })

  it('a file that fails the schema (unknown outcome, wrong version) is logged and discarded', () => {
    warnings.length = 0
    const path = join(testDir, 'invalid.json')
    writeFileSync(path, JSON.stringify({ ...emptyUpdatesFile(), records: { x: { ...record, outcome: 'maybe' } } }))
    expect(readUpdatesFile(path)).toBeNull()
    writeFileSync(path, JSON.stringify({ ...emptyUpdatesFile(), version: 99 }))
    expect(readUpdatesFile(path)).toBeNull()
    expect(warnings.length).toBe(2)
    expect(existsSync(path)).toBe(true) // never rewritten on read
  })
})
