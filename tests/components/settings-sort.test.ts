import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-settings-sort-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

import { groupAndSortSchemas, type PluginSchemaEntry } from '../../packages/host/src/routes/settings'
import { SYSTEM_SETTINGS_TAB_ID } from '@/components/system-settings'

const schema = { fields: [] }

function entry(id: string, name: string, source: 'built-in' | 'user' = 'user'): PluginSchemaEntry {
  return { id, name, schema, source }
}

describe('groupAndSortSchemas', () => {
  it('returns empty buckets for empty input', () => {
    const out = groupAndSortSchemas([])
    expect(out.core).toEqual([])
    expect(out.extensions).toEqual([])
  })

  it('pins System & Alerts at the top of the core bucket', () => {
    const out = groupAndSortSchemas([
      entry('assets', 'Assets', 'built-in'),
      { id: SYSTEM_SETTINGS_TAB_ID, name: 'System & Alerts', schema, source: 'built-in' },
      entry('tasks', 'Tasks', 'built-in'),
    ])
    expect(out.core.map(p => p.id)).toEqual([SYSTEM_SETTINGS_TAB_ID, 'assets', 'tasks'])
    expect(out.extensions).toHaveLength(0)
  })

  it('sorts core plugins (excluding System) alphabetically, case-insensitive', () => {
    const out = groupAndSortSchemas([
      entry('tasks', 'Tasks', 'built-in'),
      entry('assets', 'assets', 'built-in'),
      entry('Workflows', 'Workflows', 'built-in'),
      entry('git', 'Git', 'built-in'),
    ])
    expect(out.core.map(p => p.name)).toEqual(['assets', 'Git', 'Tasks', 'Workflows'])
  })

  it('partitions extensions from core and sorts each alphabetically', () => {
    const out = groupAndSortSchemas([
      entry('tasks', 'Tasks', 'built-in'),
      entry('projects', 'Projects'),
      entry('messaging', 'Messaging'),
      entry('assets', 'Assets', 'built-in'),
    ])
    expect(out.core.map(p => p.name)).toEqual(['Assets', 'Tasks'])
    expect(out.extensions.map(p => p.name)).toEqual(['Messaging', 'Projects'])
  })

  it('leaves extensions bucket empty when no user plugins are present', () => {
    const out = groupAndSortSchemas([
      { id: SYSTEM_SETTINGS_TAB_ID, name: 'System & Alerts', schema, source: 'built-in' },
      entry('tasks', 'Tasks', 'built-in'),
      entry('assets', 'Assets', 'built-in'),
    ])
    expect(out.extensions).toEqual([])
  })
})
