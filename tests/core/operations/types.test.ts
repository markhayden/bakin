import { afterAll, mock } from 'bun:test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-operations-types-${Date.now()}-${randomUUID()}`)
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
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { describe, expect, it } from 'bun:test'

import * as SdkTypes from '@makinbakin/sdk/types'
import {
  CORE_RESOURCES,
  OPERATION_STAGE_KINDS,
  OperationCancelledError,
  type OperationContext,
  type OperationPlan,
} from '@bakin/core/operations'

describe('operation contract', () => {
  it('fixes the canonical resource acquisition order (D23)', () => {
    expect([...CORE_RESOURCES]).toEqual(['install-state', 'media-store', 'search-engine'])
  })

  it('fixes the stage-kind vocabulary; waiting is not a stage (D8)', () => {
    expect([...OPERATION_STAGE_KINDS]).toEqual([
      'preparing', 'downloading', 'extracting', 'building',
      'installing', 'verifying', 'committing', 'cleanup',
    ])
    expect(OPERATION_STAGE_KINDS).not.toContain('waiting' as never)
  })

  it('single-homes the leaf values in the SDK; core re-exports the same objects', () => {
    expect(CORE_RESOURCES).toBe(SdkTypes.CORE_RESOURCES)
    expect(OPERATION_STAGE_KINDS).toBe(SdkTypes.OPERATION_STAGE_KINDS)
  })

  it('names the cancelled operation on the typed error', () => {
    const err = new OperationCancelledError('op-1')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('OperationCancelledError')
    expect(err.operationId).toBe('op-1')
  })

  it('accepts the three point-of-no-return forms', () => {
    const plans: OperationPlan[] = [
      { stages: [{ id: 'commit', kind: 'committing', label: 'Commit' }], pointOfNoReturn: 'commit' },
      { stages: [], pointOfNoReturn: 'start' },
      { stages: [], pointOfNoReturn: null },
    ]
    expect(plans.map((p) => p.pointOfNoReturn)).toEqual(['commit', 'start', null])
  })

  it('exposes resource ownership on the context so inner writers can assert it', () => {
    const keys: Array<keyof OperationContext> = ['holds', 'throwIfCancelled', 'signal']
    expect(keys).toHaveLength(3)
  })
})
