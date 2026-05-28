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
    expect(out.system).toEqual([])
    expect(out.builtIn).toEqual([])
    expect(out.installed).toEqual([])
  })

  it('pins the system tab into its own bucket', () => {
    const out = groupAndSortSchemas([
      { id: SYSTEM_SETTINGS_TAB_ID, name: 'System & Alerts', schema, source: 'built-in' },
      entry('tasks', 'Tasks', 'built-in'),
    ])
    expect(out.system).toHaveLength(1)
    expect(out.system[0].id).toBe(SYSTEM_SETTINGS_TAB_ID)
    expect(out.builtIn).toHaveLength(1)
    expect(out.installed).toHaveLength(0)
  })

  it('sorts built-in plugins alphabetically, case-insensitive', () => {
    const out = groupAndSortSchemas([
      entry('tasks', 'Tasks', 'built-in'),
      entry('assets', 'assets', 'built-in'),
      entry('Workflows', 'Workflows', 'built-in'),
      entry('git', 'Git', 'built-in'),
    ])
    expect(out.builtIn.map(p => p.name)).toEqual(['assets', 'Git', 'Tasks', 'Workflows'])
  })

  it('sorts installed plugins alphabetically and partitions by source', () => {
    const out = groupAndSortSchemas([
      entry('tasks', 'Tasks', 'built-in'),
      entry('projects', 'Projects'),
      entry('messaging', 'Messaging'),
      entry('assets', 'Assets', 'built-in'),
    ])
    expect(out.builtIn.map(p => p.name)).toEqual(['Assets', 'Tasks'])
    expect(out.installed.map(p => p.name)).toEqual(['Messaging', 'Projects'])
  })

  it('leaves installed bucket empty when no user plugins are present', () => {
    const out = groupAndSortSchemas([
      { id: SYSTEM_SETTINGS_TAB_ID, name: 'System & Alerts', schema, source: 'built-in' },
      entry('tasks', 'Tasks', 'built-in'),
      entry('assets', 'Assets', 'built-in'),
    ])
    expect(out.installed).toEqual([])
  })
})
