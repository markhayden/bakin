import { describe, expect, test } from 'bun:test'

import { createRuntimeAdapterHealthChecks } from '../../src/core/runtime-adapter-factory'

describe('runtime adapter health composition', () => {
  test('exposes Pi probes separately from the runtime contract', () => {
    expect(createRuntimeAdapterHealthChecks('pi').map((check) => check.id)).toEqual([
      'home',
      'agents-root',
      'auth',
      'models',
    ])
  })

  test('does not recreate duplicate OpenClaw probes', () => {
    expect(createRuntimeAdapterHealthChecks('openclaw')).toEqual([])
  })
})
