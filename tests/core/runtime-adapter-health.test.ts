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

  test('OpenClaw registers the override-authorization (#880) and gateway-protocol (#1007 D7.10) probes when the live adapter is supplied', () => {
    const adapter = {
      models: { routingSupport: () => ({ perTurnModel: true }) },
    } as unknown as Parameters<typeof createRuntimeAdapterHealthChecks>[2]
    expect(createRuntimeAdapterHealthChecks('openclaw', () => undefined, adapter).map((check) => check.id))
      .toEqual(['override-authorization', 'gateway-protocol'])
    // Without the adapter instance (read-only CLI composition) there is
    // nothing to observe — no stub checks.
    expect(createRuntimeAdapterHealthChecks('openclaw', () => undefined)).toEqual([])
  })
})
