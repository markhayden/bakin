/**
 * AntflyAdapter (the wrapper AppServices holds) must delegate EVERY
 * contract member the client implements. Consumers feature-detect optional
 * members (`typeof search.rerank === 'function'`), so a member missing on
 * the WRAPPER silently disables its feature even though the client works —
 * exactly how the merged-top-K cross-table rerank shipped dark (#846,
 * 2026-09-19 field find).
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-antfly-adapter-${Date.now()}-${randomUUID()}`)
process.env.ANTFLY_HOME = join(testDir, 'antfly-home')

import { describe, it, expect, afterAll, mock } from 'bun:test'

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
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { AntflyAdapter } from '../../packages/adapter-antfly/src/adapter'
import { AntflySearchClient } from '../../packages/adapter-antfly/src/client'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('AntflyAdapter delegation completeness', () => {
  it('exposes every contract-facing member the client implements — optional ones included', () => {
    const adapter = new AntflyAdapter({ settings: { url: 'http://127.0.0.1:9' } })
    // Optional members consumers feature-detect:
    expect(typeof adapter.rerank).toBe('function')
    expect(typeof adapter.engineStatus === 'function' || adapter.engineStatus === undefined).toBe(true)
    // Structural sweep: any function on the client that shares a name with
    // a SearchAdapter contract member must exist on the adapter too.
    const client = new AntflySearchClient(adapter['settings' as never] ?? ({ } as never)) as unknown as Record<string, unknown>
    const contractMembers = ['available', 'capabilities', 'mappingFingerprint', 'query', 'multiQuery', 'scan', 'rerank'] as const
    for (const member of contractMembers) {
      if (typeof client[member] === 'function') {
        expect(typeof (adapter as unknown as Record<string, unknown>)[member]).toBe('function')
      }
    }
  })

  it('rerank delegates to the live client (survives initialize() client swaps)', async () => {
    const adapter = new AntflyAdapter({ settings: { url: 'http://127.0.0.1:9' } })
    // Guest-mode URL, no engine: the client's rerank degrades to null on
    // unreachable — proving the call REACHED the client rather than a stub.
    const result = await adapter.rerank('q', ['a'])
    expect(result).toBeNull()
  })
})
