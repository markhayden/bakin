import { afterAll, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testDir = join(tmpdir(), `bakin-test-health-manifest-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

const healthPlugin = (await import('../../../plugins/health')).default
const manifest = JSON.parse(readFileSync(join(import.meta.dir, '../../../plugins/health/bakin-plugin.json'), 'utf8')) as {
  version: string
  permissions: string[]
  contributes: { apiRoutes: Array<{ method: string; path: string }> }
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('Health manifest parity', () => {
  it('declares every server route exactly once', () => {
    const actual = (healthPlugin.routes ?? []).map((route) => `${route.method} ${route.path}`).sort()
    const declared = manifest.contributes.apiRoutes.map((route) => `${route.method} ${route.path}`).sort()

    expect(new Set(declared).size).toBe(declared.length)
    expect(declared).toEqual(actual)
  })

  it('aligns version, Search mutation permission, and live settings', () => {
    expect(healthPlugin.version).toBe('1.4.0')
    expect(manifest.version).toBe(healthPlugin.version)
    expect(manifest.permissions).toContain('search.write')
    expect(healthPlugin.settingsSchema?.fields.map((field) => field.key)).toEqual(['usageHistoryScanMinutes'])
  })
})
