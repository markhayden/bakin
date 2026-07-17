/**
 * System-send route resolution — the non-dispatch half of the work-class
 * matrix. Config via the models.getRoutingConfig hook; never throws into the
 * send path; no config/match = inherit.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-system-route')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

let hookResult: unknown = undefined
let hookThrows = false
mock.module('../../packages/core/src/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async () => {
      if (hookThrows) throw new Error('registry down')
      return hookResult
    },
  }),
}))

import { resolveSystemRoute, routeSendArgs } from '../../src/core/system-route'

describe('resolveSystemRoute', () => {
  it('resolves a matching class route', async () => {
    hookResult = { routes: [{ workClass: 'auto-title', model: 'anthropic/claude-haiku-4-5', thinking: 'off' }], tagOverrides: [] }
    expect(await resolveSystemRoute('auto-title'))
      .toEqual({ model: 'anthropic/claude-haiku-4-5', thinking: 'off', source: 'class' })
  })

  it('inherits when no route matches the class', async () => {
    hookResult = { routes: [{ workClass: 'relay', model: 'm' }], tagOverrides: [] }
    expect(await resolveSystemRoute('send')).toEqual({ source: 'inherit' })
  })

  it('inherits when the hook returns nothing (models plugin absent)', async () => {
    hookResult = undefined
    expect(await resolveSystemRoute('relay')).toEqual({ source: 'inherit' })
  })

  it('inherits (never throws) when the hook registry fails', async () => {
    hookThrows = true
    expect(await resolveSystemRoute('relay')).toEqual({ source: 'inherit' })
    hookThrows = false
  })
})

describe('routeSendArgs', () => {
  it('spreads only the overrides that resolved', () => {
    expect(routeSendArgs({ source: 'inherit' })).toEqual({})
    expect(routeSendArgs({ model: 'm', source: 'class' })).toEqual({ model: 'm' })
    expect(routeSendArgs({ model: 'm', thinking: 'low', source: 'class' })).toEqual({ model: 'm', thinking: 'low' })
  })
})
