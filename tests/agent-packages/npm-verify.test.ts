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

  it('a subpath-only exports map has no root entry to check', () => {
    installDep('dep-a', { version: '1.2.3', exports: { './feature': './feature.js' } }, [])
    expect(verify()).toEqual({ ok: true })
  })

  it('a missing payload directory is not ok', () => {
    rmSync(payload, { recursive: true, force: true })
    expect(problems()).toEqual(['payload directory is missing'])
  })
})
