import { describe, expect, it } from 'bun:test'

import {
  CORE_PLUGIN_IDS,
  checkPluginDependencies,
  planPluginDependencyOrder,
} from '../../../src/core/plugins/dependencies'

describe('plugin dependency checks', () => {
  it('accepts dependencies satisfied by core plugins', () => {
    const result = checkPluginDependencies({
      id: 'official',
      dependencies: ['tasks', 'team'],
    }, { installedIds: new Set() })
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
  })

  it('accepts dependencies satisfied by installed user plugins', () => {
    const result = checkPluginDependencies(
      { id: 'consumer', dependencies: ['shared'] },
      { installedIds: new Set(['shared']) },
    )
    expect(result.ok).toBe(true)
  })

  it('reports missing and self dependencies', () => {
    const result = checkPluginDependencies({
      id: 'consumer',
      dependencies: ['consumer', 'missing'],
    }, { installedIds: new Set() })
    expect(result.ok).toBe(false)
    expect(result.selfDependencies).toEqual(['consumer'])
    expect(result.missing).toEqual(['missing'])
  })
})

describe('plugin dependency install planning', () => {
  it('preserves curated order for independent plugins', () => {
    const plan = planPluginDependencyOrder([
      { id: 'first', dependencies: [] },
      { id: 'second', dependencies: [] },
    ], { installedIds: new Set() })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.ordered.map(plugin => plugin.id)).toEqual(['first', 'second'])
  })

  it('orders selected dependencies before dependents', () => {
    const plan = planPluginDependencyOrder([
      { id: 'consumer', dependencies: ['shared'] },
      { id: 'shared', dependencies: [] },
    ], { installedIds: new Set() })
    expect(plan.ok).toBe(true)
    if (plan.ok) expect(plan.ordered.map(plugin => plugin.id)).toEqual(['shared', 'consumer'])
  })

  it('fails when a dependency is neither core, installed, nor selected', () => {
    const plan = planPluginDependencyOrder([
      { id: 'consumer', dependencies: ['missing'] },
    ], {
      coreIds: new Set([...CORE_PLUGIN_IDS].filter(id => id !== 'missing')),
      installedIds: new Set(),
    })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.error).toContain('consumer: missing')
      expect(plan.missing).toEqual([{ pluginId: 'consumer', dependencies: ['missing'] }])
    }
  })

  it('detects cycles among selected plugins', () => {
    const plan = planPluginDependencyOrder([
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
    ], { installedIds: new Set() })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.error).toContain('Circular plugin dependencies')
      expect(plan.cycle).toEqual(['a', 'b'])
    }
  })
})
