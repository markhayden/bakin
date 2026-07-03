/**
 * Conformance suite vs the in-tree mock adapter. Guarantees the mock stays
 * an honest stand-in for the contract every real adapter must satisfy.
 */
import { beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// The mock adapter is purely in-memory, but isolation rules are blanket:
// nothing in a test run may resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-conformance-${Date.now()}-${randomUUID()}`)
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

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { createMockSearchAdapter } from '../../../packages/core/src/adapters/search/testing'
import { runSearchConformanceSuite, type ConformanceTarget } from './conformance'

let target: ConformanceTarget

beforeEach(() => {
  target = {
    adapter: createMockSearchAdapter(),
    prefix: 'conf_',
    realEngine: false,
  }
})

runSearchConformanceSuite('mock adapter', () => target)
