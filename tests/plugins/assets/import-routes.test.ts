/**
 * Import routes (D7): GET /import/scan lists unmanaged files; POST /import
 * imports named paths or everything. Explicit actions only.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-import-routes-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: () => () => {},
  registerUnlinkHook: () => () => {},
}))

import { handleImportScan, handleImport } from '@bakin/assets/routes/import'
import { unmanagedCount, resetUnmanagedTrackerForTests } from '@bakin/assets/lib/unmanaged-tracker'
import { getAsset } from '@bakin/assets/lib/asset-service'

function drop(relPath: string, content = 'x'): string {
  const abs = join(testDir, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
  return relPath
}
const post = (body: unknown) => new Request('http://x/import', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('assets import routes', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    resetUnmanagedTrackerForTests()
  })
  afterEach(() => rmSync(testDir, { recursive: true, force: true }))

  it('scan lists unmanaged files and reseeds the tracker', async () => {
    drop('assets/inbox/a.png')
    drop('assets/legacy.pdf')
    const res = await handleImportScan()
    const body = await res.json() as { count: number; files: Array<{ relPath: string; suggestedType: string }> }
    expect(body.count).toBe(2)
    expect(body.files.map(f => f.relPath).sort()).toEqual(['assets/inbox/a.png', 'assets/legacy.pdf'])
    expect(unmanagedCount()).toBe(2)
  })

  it('imports named paths with a type override and audits each success', async () => {
    const rel = drop('assets/inbox/notes.bin')
    const audits: Array<Record<string, unknown>> = []
    const res = await handleImport(post({ paths: [rel], type: 'research' }), {
      activity: { audit: (event, agent, data) => audits.push({ event, agent, ...data }) },
    })
    const body = await res.json() as { ok: boolean; imported: number; results: Array<{ assetId?: string }> }
    expect(body.ok).toBe(true)
    expect(body.imported).toBe(1)
    expect(getAsset(body.results[0].assetId!)!.type).toBe('research')
    expect(audits).toHaveLength(1)
    expect(audits[0].event).toBe('asset.imported')
  })

  it('import-all drains everything and the follow-up scan is empty', async () => {
    drop('assets/inbox/a.txt')
    drop('assets/inbox/b.txt')
    const res = await handleImport(post({ all: true }))
    const body = await res.json() as { ok: boolean; imported: number }
    expect(body.ok).toBe(true)
    expect(body.imported).toBe(2)
    const scan = await (await handleImportScan()).json() as { count: number }
    expect(scan.count).toBe(0)
    expect(unmanagedCount()).toBe(0)
  })

  it('rejects a request with neither paths nor all', async () => {
    const res = await handleImport(post({}))
    expect(res.status).toBe(400)
  })
})
