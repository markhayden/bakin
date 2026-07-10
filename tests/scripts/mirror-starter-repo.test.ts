/**
 * Dry-run coverage for the starter-repo mirror staging (scripts/release/
 * mirror-starter-repo.ts). The git clone/commit/push half lives in the
 * release workflow and is deliberately untested here — this pins the pure
 * staging: verbatim copy, SDK dep rewrite, README header injection, and the
 * no-repo-internal-deps guard.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Pure script-staging test (fs only) — the mirror script never touches app
// modules; mocks exist to satisfy the isolation checker and future-proof.
const mockDir = mkdtempSync(join(tmpdir(), 'bakin-test-mirror-home-'))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({ root: mockDir, db: join(mockDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({ root: mockDir, db: join(mockDir, 'bakin.db') }),
}))

import { mirrorStarter } from '../../scripts/release/mirror-starter-repo'

const SOURCE = join(import.meta.dir, '..', '..', 'examples', 'reference-plugin')
const tempRoot = mkdtempSync(join(tmpdir(), 'bakin-test-mirror-starter-'))

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true })
  rmSync(mockDir, { recursive: true, force: true })
})

describe('mirrorStarter (dry-run staging)', () => {
  it('stages a verbatim copy with the SDK dep pinned and README framed', () => {
    const target = join(tempRoot, 'clone')
    mkdirSync(join(target, '.git'), { recursive: true })
    writeFileSync(join(target, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(target, 'stale-from-last-release.ts'), 'gone\n')

    const { staged } = mirrorStarter({ source: SOURCE, target, version: '0.7.0' })

    // Verbatim copy of the example's file set; stale target files replaced.
    expect(staged).toContain('bakin-plugin.json')
    expect(staged).toContain('index.ts')
    expect(staged).toContain('client.tsx')
    expect(staged).toContain('tests')
    expect(staged).not.toContain('stale-from-last-release.ts')
    // .git preserved (the workflow clones, we stage into the clone).
    expect(readFileSync(join(target, '.git', 'HEAD'), 'utf-8')).toContain('refs/heads/main')

    // Source and copy agree on the manifest byte-for-byte.
    expect(readFileSync(join(target, 'bakin-plugin.json'), 'utf-8')).toBe(
      readFileSync(join(SOURCE, 'bakin-plugin.json'), 'utf-8'),
    )

    // SDK dep rewritten from `latest` to the released range; private stripped.
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf-8'))
    expect(pkg.devDependencies['@makinbakin/sdk']).toBe('^0.7.0')
    expect(pkg.private).toBeUndefined()
    // No repo-internal dependency forms leak into the public starter.
    expect(readFileSync(join(target, 'package.json'), 'utf-8')).not.toMatch(/workspace:|file:/)

    // README gains the starter header and keeps the example's own content.
    const readme = readFileSync(join(target, 'README.md'), 'utf-8')
    expect(readme).toContain('Bakin plugin starter')
    expect(readme).toContain('v0.7.0')
    expect(readme).toContain('reference plugin')
  })

  it('refuses prerelease/garbage versions and non-plugin sources', () => {
    const target = join(tempRoot, 'clone2')
    expect(() => mirrorStarter({ source: SOURCE, target, version: '0.7.0-rc.1' })).toThrow(/stable x\.y\.z/)
    expect(() => mirrorStarter({ source: tempRoot, target, version: '0.7.0' })).toThrow(/bakin-plugin\.json/)
  })
})
