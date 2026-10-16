import { afterEach, describe, expect, it, mock } from 'bun:test'
import { healthHealthy, healthObserved } from '@makinbakin/sdk/utils'
import { HealthContractError } from '../../src/core/health-contract'
import {
  getHealthCheck,
  getHealthRepairAction,
  listHealthChecks,
  listHealthRepairActions,
  onHealthRegistryChanged,
  registerAdapterHealthCheck,
  registerAdapterHealthRepairAction,
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterOwnerHealth,
  unregisterPluginHealthChecks,
} from '../../src/core/health-check-registry'

const owners = [
  ['plugin', 'test-plugin'],
  ['plugin', 'other-plugin'],
  ['adapter', 'pi'],
] as const

afterEach(() => {
  for (const [kind, id] of owners) unregisterOwnerHealth(kind, id)
})

function check(id = 'reachability') {
  return {
    id,
    name: 'Runtime reachability',
    description: 'Checks whether the configured runtime can serve a turn.',
    group: { key: 'runtime', label: 'Runtime' },
    maxAgeMs: 60_000,
    run: async () => healthObserved([
      healthHealthy({ key: 'ping', summary: 'Runtime answered.' }),
    ]),
  }
}

function action(id = 'restart') {
  return {
    id,
    name: 'Restart runtime',
    plan: async () => [],
    apply: async () => [],
  }
}

describe('owner-aware Health registry', () => {
  it('starts without built-in self-seeding', () => {
    expect(listHealthChecks()).toEqual([])
    expect(listHealthRepairActions()).toEqual([])
  })

  it('namespaces checks and stamps immutable plugin ownership', () => {
    const id = registerPluginHealthCheck('test-plugin', check(), 'Test Plugin')

    expect(id).toBe('test-plugin.reachability')
    expect(getHealthCheck(id)).toMatchObject({
      id,
      localId: 'reachability',
      name: 'Runtime reachability',
      description: expect.any(String),
      group: { key: 'runtime', label: 'Runtime' },
      maxAgeMs: 60_000,
      owner: { kind: 'plugin', id: 'test-plugin', label: 'Test Plugin' },
    })
  })

  it('keeps same local ids separate across owner kinds', () => {
    registerPluginHealthCheck('test-plugin', check(), 'Test Plugin')
    registerAdapterHealthCheck('pi', 'Pi', check())

    expect(listHealthChecks().map((row) => row.id)).toEqual([
      'pi.reachability',
      'test-plugin.reachability',
    ])
  })

  it('rejects duplicate owner-local registrations', () => {
    registerPluginHealthCheck('test-plugin', check())
    expect(() => registerPluginHealthCheck('test-plugin', check())).toThrow(/already registered/)
  })

  it('rejects the removed legacy shape with a typed activation contract error', () => {
    expect(() => registerPluginHealthCheck('test-plugin', {
      id: 'legacy',
      name: 'Legacy check',
      run: async () => [],
      autoFix: true,
    } as never)).toThrow(HealthContractError)
  })
})

describe('separate repair-action registry', () => {
  it('namespaces and retrieves an owner-local action independently', () => {
    const id = registerPluginHealthRepairAction('test-plugin', action(), 'Test Plugin')
    expect(id).toBe('test-plugin.restart')
    expect(getHealthRepairAction(id)).toMatchObject({
      id,
      localId: 'restart',
      owner: { kind: 'plugin', id: 'test-plugin', label: 'Test Plugin' },
    })
    expect(listHealthChecks()).toEqual([])
  })

  it('rejects an invalid action before insertion', () => {
    expect(() => registerPluginHealthRepairAction('test-plugin', {
      id: 'Bad action',
      name: '',
      plan: 'not-callable',
      apply: async () => [],
    } as never)).toThrow(HealthContractError)
    expect(listHealthRepairActions()).toEqual([])
  })

  it('accepts and forwards the operation plan and resources (#895 D10)', () => {
    const operationPlan = () => ({ stages: [{ id: 'apply', kind: 'installing' as const, label: 'Apply' }], pointOfNoReturn: 'apply' })
    const id = registerPluginHealthRepairAction('test-plugin', { ...action(), operationPlan, resources: ['test-plugin:cache'] })
    const stored = getHealthRepairAction(id)!
    expect(stored.operationPlan).toBe(operationPlan)
    expect(stored.resources).toEqual(['test-plugin:cache'])
  })

  it('rejects a non-callable operation plan', () => {
    expect(() => registerPluginHealthRepairAction('test-plugin', { ...action(), operationPlan: 'stages' } as never)).toThrow(HealthContractError)
  })
})

describe('repair resource authorization (#895 D10/D19)', () => {
  it('refuses core resources and foreign namespaces from a user plugin', () => {
    expect(() => registerPluginHealthRepairAction('test-plugin', { ...action('a'), resources: ['media-store'] })).toThrow('may not declare resource "media-store"')
    expect(() => registerPluginHealthRepairAction('test-plugin', { ...action('b'), resources: ['other-plugin:cache'] })).toThrow('may not declare resource "other-plugin:cache"')
    expect(() => registerPluginHealthRepairAction('test-plugin', { ...action('c'), resources: ['test-plugin:'] })).toThrow('may not declare resource')
    expect(listHealthRepairActions()).toEqual([])
  })

  it('allows a core plugin the core resources and every plugin its own namespace', () => {
    expect(registerPluginHealthRepairAction('test-plugin', { ...action('media'), resources: ['media-store', 'install-state'] }, 'Test', { isCorePlugin: true })).toBe('test-plugin.media')
    expect(registerPluginHealthRepairAction('other-plugin', { ...action('own'), resources: ['other-plugin:cache'] })).toBe('other-plugin.own')
  })

  it('allows adapters the core resources only', () => {
    expect(registerAdapterHealthRepairAction('pi', 'Pi', { ...action('engine'), resources: ['search-engine'] })).toBe('pi.engine')
    expect(() => registerAdapterHealthRepairAction('pi', 'Pi', { ...action('other'), resources: ['pi:cache'] })).toThrow('may not declare resource "pi:cache"')
  })
})

describe('owner teardown and cache invalidation seam', () => {
  it('removes checks and repair actions for only the selected owner', () => {
    registerPluginHealthCheck('test-plugin', check())
    registerPluginHealthRepairAction('test-plugin', action())
    registerPluginHealthCheck('other-plugin', check())

    unregisterPluginHealthChecks('test-plugin')

    expect(getHealthCheck('test-plugin.reachability')).toBeUndefined()
    expect(getHealthRepairAction('test-plugin.restart')).toBeUndefined()
    expect(getHealthCheck('other-plugin.reachability')).toBeDefined()
  })

  it('publishes exact removed check ids for report-cache pruning', () => {
    registerPluginHealthCheck('test-plugin', check('one'))
    registerPluginHealthCheck('test-plugin', check('two'))
    const listener = mock()
    const unsubscribe = onHealthRegistryChanged(listener)

    unregisterPluginHealthChecks('test-plugin')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(['test-plugin.one', 'test-plugin.two'])
    unsubscribe()
  })
})
