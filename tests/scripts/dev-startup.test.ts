import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('dev startup build order', () => {
  it('regenerates the embedded asset manifest before importing the server', () => {
    const source = readFileSync(join(import.meta.dir, '..', '..', 'scripts/dev.ts'), 'utf-8')

    const hostBuild = source.indexOf("await runStep('build:host-shell'")
    const manifestBuild = source.indexOf("await runStep('build:assets-manifest'")
    const serverImport = source.indexOf("await import('../server')")

    expect(hostBuild).toBeGreaterThanOrEqual(0)
    expect(manifestBuild).toBeGreaterThan(hostBuild)
    expect(serverImport).toBeGreaterThan(manifestBuild)
  })
})
