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
