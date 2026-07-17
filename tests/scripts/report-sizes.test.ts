/**
 * Tests for the size-report tooling (scripts/report-sizes.ts).
 *
 * Exercises the pure aggregation + artifact-scan helpers against fixture
 * data — never a real build. The script only runs main() under
 * `import.meta.main`, so importing it here is side-effect free.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `bakin-test-report-sizes-${Date.now()}`)

// The script never touches the content dir, but mock the resolvers anyway
// (CLAUDE.md isolation rules) so no transitive import can reach ~/.bakin/.
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => root,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => root,
  getBakinPaths: () => ({}),
}))

import { aggregateMetafileInputs, collectArtifactSizes } from '../../scripts/report-sizes'

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('aggregateMetafileInputs', () => {
  it('attributes bytes to packages across .bun store, scoped, and plain paths', () => {
    const rows = aggregateMetafileInputs({
      'node_modules/.bun/zod@4.3.6/node_modules/zod/index.js': { bytes: 100 },
      'node_modules/.bun/zod@4.3.6/node_modules/zod/locales/en.js': { bytes: 50 },
      'node_modules/.bun/@modelcontextprotocol+sdk@1.29.0/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js':
        { bytes: 40 },
      'node_modules/iconv-lite/lib/index.js': { bytes: 30 },
      'node_modules/@scope/plain/dist/a.js': { bytes: 20 },
    })
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.bytes]))
    expect(byName['zod']).toBe(150)
    expect(byName['@modelcontextprotocol/sdk']).toBe(40)
    expect(byName['iconv-lite']).toBe(30)
    expect(byName['@scope/plain']).toBe(20)
  })

  it('groups app code by top-level directory and sorts descending', () => {
    const rows = aggregateMetafileInputs({
      'server.ts': { bytes: 10 },
      'src/core/cli.ts': { bytes: 200 },
      'src/lib/audit.ts': { bytes: 100 },
      'packages/host/src/api/agents.ts': { bytes: 400 },
      'node_modules/zod/index.js': { bytes: 350 },
    })
    expect(rows[0]).toEqual({ name: '(app) packages', bytes: 400 })
    expect(rows[1]).toEqual({ name: 'zod', bytes: 350 })
    expect(rows[2]).toEqual({ name: '(app) src', bytes: 300 })
    expect(rows[3]).toEqual({ name: '(app) server.ts', bytes: 10 })
  })
})

describe('collectArtifactSizes', () => {
  it('reports vendor, plugin client, host shell, and binary sizes from a fixture tree', () => {
    const seed = (rel: string, size: number) => {
      const full = join(root, rel)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, 'x'.repeat(size))
    }
    seed('packages/host/public/vendor/sdk-index.js', 100)
    seed('packages/host/public/vendor/sdk-shared-abc123.js', 250)
    seed('packages/host/public/vendor/react.js', 75)
    seed('packages/host/public/globals.css', 60)
    seed('packages/host/dist/main.js', 500)
    seed('plugins/tasks/dist/client.js', 40)
    seed('plugins/tasks/dist/client.css', 10)
    seed('plugins/tasks/index.ts', 999) // source, must not be counted
    seed('dist/bakin-darwin-arm64', 1000)

    const report = collectArtifactSizes(root)

    expect(report.vendor.total).toBe(425)
    expect(report.vendor.files.map((f) => f.name).sort()).toEqual([
      'react.js',
      'sdk-index.js',
      'sdk-shared-abc123.js',
    ])
    expect(report.sdk.total).toBe(350)
    expect(report.plugins.total).toBe(50)
    expect(report.css.total).toBe(70)
    expect(report.hostShell.total).toBe(500)
    expect(report.binaries.total).toBe(1000)
    expect(report.binaries.files[0].name).toBe('bakin-darwin-arm64')
  })

  it('returns empty sections when artifacts are not built', () => {
    const emptyRoot = join(root, 'empty')
    mkdirSync(emptyRoot, { recursive: true })
    const report = collectArtifactSizes(emptyRoot)
    expect(report.vendor.files).toEqual([])
    expect(report.vendor.total).toBe(0)
    expect(report.sdk.total).toBe(0)
    expect(report.css.total).toBe(0)
    expect(report.binaries.files).toEqual([])
  })
})
