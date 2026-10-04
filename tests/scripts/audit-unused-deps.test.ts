/**
 * Tests for the unused-dependency audit (scripts/audit-unused-deps.ts).
 *
 * Runs against a throwaway fixture tree, never the real repo. The script only
 * executes main() under `import.meta.main`, so importing it is side-effect free.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = join(tmpdir(), `bakin-test-audit-unused-deps-${Date.now()}`)

// The audit never touches the content dir, but mock the resolvers anyway
// (CLAUDE.md isolation rules) so no transitive import can reach ~/.bakin/.
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => root,
  getBakinPaths: () => ({}),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => root,
  getBakinPaths: () => ({}),
}))

import { auditDependencyUsage, unusedDependencies } from '../../scripts/audit-unused-deps'

function seed(rel: string, content: string): void {
  const full = join(root, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

seed('package.json', JSON.stringify({
  scripts: { 'build:css': 'twcli -i in.css -o out.css' },
  dependencies: { 'used-lib': '^1.0.0', 'unused-lib': '^2.0.0', '@scope/sub-used': '^1.0.0' },
  devDependencies: {
    '@types/used-lib': '^1.0.0',
    '@types/unused-lib': '^1.0.0',
    '@types/bun': '^1.0.0',
    'bin-tool': '^3.0.0',
  },
}))
seed('src/a.ts', "import { x } from 'used-lib'\nimport y from '@scope/sub-used/deep/path'\n")
seed('docs/notes.md', 'Prose mentioning `unused-lib` does not count as code.\n')
seed('node_modules/bin-tool/package.json', JSON.stringify({ name: 'bin-tool', bin: { twcli: 'cli.js' } }))
seed('node_modules/unused-lib/index.js', 'module.exports = {}\n')
seed('dist/bundle.js', "require('unused-lib')\n") // build output must be ignored

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('auditDependencyUsage', () => {
  const rows = auditDependencyUsage(root)
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

  it('counts code imports, including sub-path imports', () => {
    expect(byName['used-lib'].codeHits).toBe(1)
    expect(byName['@scope/sub-used'].codeHits).toBe(1)
  })

  it('ignores node_modules, dist output, and prose mentions', () => {
    expect(byName['unused-lib'].codeHits).toBe(0)
    expect(byName['unused-lib'].proseHits).toBe(1)
  })

  it('credits a package whose bin is invoked from package.json scripts', () => {
    expect(byName['bin-tool'].scriptHits).toBe(1)
  })
})

describe('unusedDependencies', () => {
  const unused = unusedDependencies(auditDependencyUsage(root))

  it('reports packages with no code or script usage', () => {
    expect(unused).toContain('unused-lib')
  })

  it('reports @types packages whose base package is itself unused', () => {
    expect(unused).toContain('@types/unused-lib')
    expect(unused).not.toContain('@types/used-lib')
  })

  it('never reports runtime-global typings or bin-only tools', () => {
    expect(unused).not.toContain('@types/bun')
    expect(unused).not.toContain('bin-tool')
  })

  it('is exactly the two dead packages', () => {
    expect([...unused].sort()).toEqual(['@types/unused-lib', 'unused-lib'])
  })
})
