/**
 * verifyNpmPayload — the ONE "do this payload's dependencies resolve at the
 * declared versions?" predicate (#898 F). File reads only; anchored in the
 * payload's own node_modules.
 */
import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { generatedNpmManifest, verifyNpmPayload } from '../../src/core/agent-packages/npm-verify'

const root = join(tmpdir(), `bakin-test-npm-verify-${Date.now()}-${Math.random().toString(16).slice(2)}`)
const payload = join(root, 'npm', 'pack', 'scripts')
const source = join(root, 'source')
const req = { name: 'scripts', dependencies: { 'dep-a': '1.2.3', '@scope/dep-b': '2.0.0' } as Record<string, string> }

function installDep(name: string, pkg: Record<string, unknown>, files: string[] = ['index.js'], base = join(payload, 'node_modules')): string {
  const dir = join(base, ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...pkg }))
  for (const file of files) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), 'export default 1\n')
  }
  return dir
}

function seedValid(): void {
  mkdirSync(payload, { recursive: true })
  mkdirSync(join(source, 'lib'), { recursive: true })
  writeFileSync(join(source, 'run.js'), 'console.log(1)\n')
  writeFileSync(join(source, 'lib', 'util.js'), 'export const x = 1\n')
  writeFileSync(join(source, 'package.json'), '{"name":"ignored"}')
  writeFileSync(join(payload, 'run.js'), 'console.log(1)\n')
  mkdirSync(join(payload, 'lib'), { recursive: true })
  writeFileSync(join(payload, 'lib', 'util.js'), 'export const x = 1\n')
  writeFileSync(join(payload, 'package.json'), generatedNpmManifest('pack', req))
  installDep('dep-a', { version: '1.2.3', main: 'lib/main' }, ['lib/main.js'])
  // Scoped, ESM, conditional exports map (types first, like real packages).
  installDep('@scope/dep-b', { version: '2.0.0', type: 'module', exports: { '.': { import: { types: './d.ts', default: './dist/b.mjs' }, require: './dist/b.cjs' } } }, ['dist/b.mjs'])
}

const verify = () => verifyNpmPayload(payload, 'pack', req, { scriptsSource: source })
const problems = () => { const v = verify(); return v.ok ? [] : v.problems }

beforeEach(() => { rmSync(root, { recursive: true, force: true }); seedValid() })
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('verifyNpmPayload', () => {
  it('a payload whose dependencies resolve at their pins (scoped, ESM exports map, extension-less main) is ok', () => {
    expect(verify()).toEqual({ ok: true })
  })

  it('an empty node_modules fails — "node_modules exists" is not proof', () => {
    rmSync(join(payload, 'node_modules'), { recursive: true, force: true })
    mkdirSync(join(payload, 'node_modules'))
    expect(problems()).toEqual(expect.arrayContaining([expect.stringContaining('dep-a is not installed'), expect.stringContaining('@scope/dep-b is not installed')]))
  })

  it('a wrong version or a wrong name fails', () => {
    installDep('dep-a', { version: '1.2.4', main: 'lib/main' }, ['lib/main.js'])
    expect(problems()).toEqual([expect.stringContaining('dep-a is 1.2.4, not the declared 1.2.3')])
    seedValid()
    writeFileSync(join(payload, 'node_modules', 'dep-a', 'package.json'), JSON.stringify({ name: 'evil-a', version: '1.2.3', main: 'lib/main' }))
    expect(problems()).toEqual([expect.stringContaining('installed as "evil-a"')])
  })

  it('a missing entry file fails', () => {
    rmSync(join(payload, 'node_modules', '@scope', 'dep-b', 'dist', 'b.mjs'))
    expect(problems()).toEqual([expect.stringContaining('@scope/dep-b is missing its entry file dist/b.mjs')])
  })

  it('an ancestor node_modules never satisfies a dependency (no fallback)', () => {
    rmSync(join(payload, 'node_modules', 'dep-a'), { recursive: true, force: true })
    installDep('dep-a', { version: '1.2.3', main: 'lib/main' }, ['lib/main.js'], join(root, 'npm', 'node_modules'))
    expect(problems()).toEqual([expect.stringContaining('dep-a is not installed in the payload')])
  })

  it('a symlink is followed only while it stays inside the payload node_modules', () => {
    const outside = installDep('dep-a', { version: '1.2.3', main: 'lib/main' }, ['lib/main.js'], join(root, 'elsewhere'))
    rmSync(join(payload, 'node_modules', 'dep-a'), { recursive: true, force: true })
    symlinkSync(outside, join(payload, 'node_modules', 'dep-a'))
    expect(problems()).toEqual([expect.stringContaining('dep-a resolves outside the payload')])
    // Isolated-linker shape: a link into the payload's own store is fine.
    rmSync(join(payload, 'node_modules', 'dep-a'))
    const stored = installDep('dep-a', { version: '1.2.3', main: 'lib/main' }, ['lib/main.js'], join(payload, 'node_modules', '.store'))
    symlinkSync(stored, join(payload, 'node_modules', 'dep-a'))
    expect(verify()).toEqual({ ok: true })
  })

  it('an altered or missing payload script fails; the pack\'s own package.json never counts', () => {
    writeFileSync(join(payload, 'lib', 'util.js'), 'export const x = 2\n')
    expect(problems()).toEqual([expect.stringContaining('script lib/util.js differs from the pack')])
    rmSync(join(payload, 'run.js'))
    expect(problems()).toEqual(expect.arrayContaining([expect.stringContaining('script run.js is missing')]))
  })

  it('a package.json that differs from the declared dependency set fails', () => {
    writeFileSync(join(payload, 'package.json'), generatedNpmManifest('pack', { name: 'scripts', dependencies: { 'dep-a': '1.0.0' } }))
    expect(problems()).toEqual([expect.stringContaining('package.json differs')])
  })

  it('every concrete exported subpath must exist — a subpath-only package is not "no entry"', () => {
    installDep('dep-a', { version: '1.2.3', exports: { './feature': './feature.js', './lib/*': './lib/*.js' } }, ['feature.js'])
    expect(verify()).toEqual({ ok: true })
    rmSync(join(payload, 'node_modules', 'dep-a', 'feature.js'))
    expect(problems()).toEqual([expect.stringContaining('dep-a is missing its export ./feature feature.js')])
  })

  it('conditions resolve in DECLARATION order, as Node does', () => {
    // node is declared first: Node loads ./node.js, whatever import names.
    installDep('dep-a', { version: '1.2.3', exports: { node: './node.js', import: './import.js' } }, ['import.js'])
    expect(problems()).toEqual([expect.stringContaining('dep-a is missing its entry file node.js')])
    installDep('dep-a', { version: '1.2.3', exports: { node: './node.js', import: './import.js' } }, ['node.js'])
    rmSync(join(payload, 'node_modules', 'dep-a', 'import.js'), { force: true })
    expect(verify()).toEqual({ ok: true })
  })

  it('`module` is a bundler field: Node\'s main decides', () => {
    installDep('dep-a', { version: '1.2.3', module: './esm.js', main: './cjs.js' }, ['esm.js'])
    expect(problems()).toEqual([expect.stringContaining('dep-a is missing its entry file cjs.js')])
    installDep('dep-a', { version: '1.2.3', module: './esm.js', main: './cjs.js' }, ['cjs.js'])
    rmSync(join(payload, 'node_modules', 'dep-a', 'esm.js'), { force: true })
    expect(verify()).toEqual({ ok: true })
  })

  it('a malformed dependency package.json is a failed verdict, never an exception', () => {
    writeFileSync(join(payload, 'node_modules', 'dep-a', 'package.json'), 'null')
    expect(problems()).toEqual([expect.stringContaining('dep-a has a malformed package.json')])
  })

  it('a node_modules that is itself a symlink out of the payload is rejected', () => {
    const outside = join(root, 'shared-modules')
    mkdirSync(root, { recursive: true })
    require('fs').renameSync(join(payload, 'node_modules'), outside)
    symlinkSync(outside, join(payload, 'node_modules'))
    expect(problems()).toEqual([expect.stringContaining('node_modules is a symlink')])
  })

  describe('Node resolution edge cases (review round 2)', () => {
    const depDir = () => join(payload, 'node_modules', 'dep-a')
    const reset = (pkg: Record<string, unknown>, files: string[]) => {
      rmSync(depDir(), { recursive: true, force: true })
      installDep('dep-a', { version: '1.2.3', ...pkg }, files)
    }

    it('a payload package.json that is not a file is a failed verdict, not EISDIR', () => {
      rmSync(join(payload, 'package.json'))
      mkdirSync(join(payload, 'package.json'))
      expect(problems()).toEqual(['package.json is not a file'])
    })

    it('an entry file symlinked outside the payload is rejected — Node would follow it', () => {
      reset({ main: 'index.js' }, [])
      const outside = join(root, 'outside.js')
      writeFileSync(outside, 'export default 1\n')
      symlinkSync(outside, join(depDir(), 'index.js'))
      expect(problems()).toEqual([expect.stringContaining('entry file resolves outside the payload')])
    })

    it('a literal target behind a wildcard KEY is still checked', () => {
      reset({ exports: { '.': './index.js', './feature/*': './shared.js' } }, ['index.js'])
      expect(problems()).toEqual([expect.stringContaining('export ./feature/* shared.js')])
    })

    it('exports: null means legacy main resolution', () => {
      reset({ exports: null, main: 'missing.js' }, [])
      expect(problems()).toEqual([expect.stringContaining('missing its entry file missing.js')])
    })

    it('an explicit null condition blocks the subpath — it never falls through to default', () => {
      reset({ exports: { '.': './index.js', './browser': { node: null, default: './browser.js' } } }, ['index.js'])
      expect(verify()).toEqual({ ok: true })
    })

    it('array targets fall back past invalid strings; a bare non-"./" target is invalid', () => {
      reset({ exports: ['invalid', './index.js'] }, ['index.js'])
      expect(verify()).toEqual({ ok: true })
      reset({ exports: 'index.js' }, ['index.js'])
      expect(problems()).toEqual([expect.stringContaining('invalid target for entry file')])
    })

    it('a missing main falls back to the package root index.js, as Node does', () => {
      reset({ main: 'missing.js' }, ['index.js'])
      expect(verify()).toEqual({ ok: true })
    })
  })

  it('a missing payload directory is not ok', () => {
    rmSync(payload, { recursive: true, force: true })
    expect(problems()).toEqual(['payload directory is missing'])
  })
})
