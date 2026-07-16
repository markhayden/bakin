import { describe, expect, test } from 'bun:test'

import { createRuntimeAdapterHealthChecks } from '../../src/core/runtime-adapter-factory'

describe('runtime adapter health composition', () => {
  test('exposes Pi probes separately from the runtime contract', () => {
    expect(createRuntimeAdapterHealthChecks('pi', () => undefined).map((check) => check.id)).toEqual([
      'home',
      'agents-root',
      'auth',
      'models',
      'extensions',
    ])
  })

  test('does not recreate duplicate OpenClaw probes', () => {
    expect(createRuntimeAdapterHealthChecks('openclaw', () => undefined)).toEqual([])
  })
})
