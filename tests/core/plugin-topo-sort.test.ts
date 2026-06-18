/**
 * Direct unit tests for the unified plugin topological sort.
 *
 * This free function replaced two near-identical class methods
 * (`topologicalSort` / `topologicalSortUserPlugins`). The registry test covers
 * both paths end-to-end; these tests pin the parameterized differences in
 * isolation so the dedup can't silently regress one mode:
 *   - failOnMissingDep (core fails the dependent; user skips the edge)
 *   - source (the failure record's source field)
 *
 * The third option, logCycle, only controls a cosmetic top-level log line whose
 * sink is captured at module load (before mock.module can intercept it), so it
 * isn't asserted here — the registry test + boot smoke exercise it in practice.
 */
import { describe, it, expect } from 'bun:test'

// Pure graph function; never touches storage. Defensive content-dir mocks keep
// the isolation rule satisfied so a future import can't leak into ~/.bakin/.
import { mock } from 'bun:test'
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => '/tmp/bakin-topo-test' }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => '/tmp/bakin-topo-test' }))

import { topologicalSortPlugins } from '../../src/lib/plugin-topo-sort'
import type { PluginFailureState, PluginLoadEntry } from '../../src/lib/plugin-registry-types'

function entry(id: string, deps: string[] = []): PluginLoadEntry {
  return { id, path: `plugins/${id}`, deps }
}

/** Drives the sort with a real failed-set so isFailed reflects markFailed. */
function run(entries: PluginLoadEntry[], opts: { source: 'built-in' | 'user'; failOnMissingDep: boolean; logCycle: boolean }) {
  const failed = new Map<string, PluginFailureState>()
  const sorted = topologicalSortPlugins(entries, opts, {
    markFailed: (f) => failed.set(f.id, f),
    isFailed: (id) => failed.has(id),
  })
  return { sorted: sorted.map((e) => e.id), failed }
}

const CORE = { source: 'built-in' as const, failOnMissingDep: true, logCycle: true }
const USER = { source: 'user' as const, failOnMissingDep: false, logCycle: false }

describe('topologicalSortPlugins', () => {
  it('preserves order when there are no dependencies', () => {
    const { sorted } = run([entry('a'), entry('b'), entry('c')], CORE)
    expect(sorted).toEqual(['a', 'b', 'c'])
  })

  it('orders a dependent after its dependency', () => {
    const { sorted } = run([entry('b', ['a']), entry('a')], CORE)
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'))
  })

  it('core pass: a missing dependency fails the dependent (source built-in)', () => {
    const { sorted, failed } = run([entry('a', ['ghost'])], CORE)
    expect(sorted).toEqual([]) // failed entry filtered out of activation
    expect(failed.get('a')?.errorCode).toBe('missing_dependency')
    expect(failed.get('a')?.source).toBe('built-in')
  })

  it('user pass: a missing dependency is skipped silently, not failed', () => {
    const { sorted, failed } = run([entry('a', ['ghost'])], USER)
    expect(sorted).toEqual(['a']) // edge skipped, entry still activates
    expect(failed.has('a')).toBe(false)
  })

  it('core pass: detects a cycle and fails the involved entries (source built-in)', () => {
    const { sorted, failed } = run([entry('a', ['b']), entry('b', ['a'])], CORE)
    expect(sorted).toEqual([])
    expect(failed.get('a')?.errorCode).toBe('dependency_cycle')
    expect(failed.get('b')?.source).toBe('built-in')
  })

  it('user pass: detects a cycle and fails the involved entries (source user)', () => {
    const { sorted, failed } = run([entry('a', ['b']), entry('b', ['a'])], USER)
    expect(sorted).toEqual([])
    expect(failed.get('a')?.errorCode).toBe('dependency_cycle')
    expect(failed.get('b')?.source).toBe('user')
  })
})
