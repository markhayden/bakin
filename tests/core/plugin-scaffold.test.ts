/**
 * Scaffold output contract (#147 TH4, prelaunch-hardening T13).
 *
 * The scaffold must emit the canonical ROOT layout (index.ts + client.tsx at
 * plugin root — the only layout buildUserPlugin supports), a manifest that
 * passes the real parser with contributes/permissions matching the template
 * code, and templates that reference only APIs that exist.
 *
 * The full install → activate proof lives in the golden-path integration
 * test (T14); running `tsc` against node_modules is deliberately out of
 * scope here (no network in tests), so this file pins tsconfig keys and
 * validates template imports statically instead.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The scaffold writes only into process.cwd() (chdir'd to a temp dir below),
// but per CLAUDE.md isolation rules every plugin-adjacent test pins the
// content-dir resolvers to a temp path so nothing can reach ~/.bakin.
const isolationDir = mkdtempSync(join(tmpdir(), `bakin-scaffold-isolation-${Date.now()}-`))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
  getBakinPaths: () => ({ root: isolationDir, db: join(isolationDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
  getBakinPaths: () => ({ root: isolationDir, db: join(isolationDir, 'bakin.db') }),
}))

import { parsePluginManifest } from '../../packages/core/src/plugins/manifest'
import { validatePluginImports } from '../../src/core/whiskit/import-scan'
import { createPluginScaffold, resolveScaffoldVersions } from '../../src/core/plugin-scaffold'

const PLUGIN = 'demo-crm'
let workDir: string
let root: string
let prevCwd: string

beforeAll(() => {
  prevCwd = process.cwd()
  workDir = mkdtempSync(join(tmpdir(), `bakin-scaffold-test-${Date.now()}-`))
  process.chdir(workDir)
  const result = createPluginScaffold(PLUGIN)
  if (!result.ok) throw new Error(`scaffold failed: ${result.error}`)
  root = result.root!
})

afterAll(() => {
  process.chdir(prevCwd)
  rmSync(workDir, { recursive: true, force: true })
  rmSync(isolationDir, { recursive: true, force: true })
})

const read = (rel: string) => readFileSync(join(root, rel), 'utf-8')

describe('createPluginScaffold', () => {
  it('emits the canonical root layout — no src/ directory', () => {
    for (const file of [
      'bakin-plugin.json',
      'package.json',
      'tsconfig.json',
      'index.ts',
      'client.tsx',
      'greeting.ts',
      'tests/plugin.test.ts',
      '.gitignore',
      'README.md',
    ]) {
      expect(existsSync(join(root, file))).toBe(true)
    }
    expect(existsSync(join(root, 'src'))).toBe(false)
  })

  it('manifest passes the real parser with contributes matching the templates', () => {
    const manifest = parsePluginManifest(JSON.parse(read('bakin-plugin.json')))
    expect(manifest.id).toBe(PLUGIN)
    expect(manifest.permissions).toEqual(['storage.read', 'storage.write'])
    expect(manifest.contributes?.apiRoutes?.map(r => `${r.method} ${r.path}`)).toEqual(['GET /hello'])
    expect(manifest.contributes?.execTools?.map(t => t.name)).toEqual([`bakin_exec_${PLUGIN}_greet`])
    expect(manifest.contributes?.routes?.map(r => r.path)).toEqual([`/${PLUGIN}`])
    expect(manifest.contributes?.nav?.[0]?.href).toBe(`/${PLUGIN}`)
    expect(manifest.bakin).toMatch(/^>=/)
    // T12 tombstones: the raw manifest must not carry the removed fields.
    const raw = JSON.parse(read('bakin-plugin.json')) as Record<string, unknown>
    expect(raw.entry).toBeUndefined()
    expect(raw.tests).toBeUndefined()
  })

  it('templates reference only APIs that exist', () => {
    const index = read('index.ts')
    expect(index).toContain('definePlugin')
    expect(index).toContain('defineRoute')
    expect(index).toContain('ctx.registerExecTool')
    expect(index).toContain('ctx.hooks.register')
    expect(index).toContain(`bakin_exec_${PLUGIN}_greet`)
    expect(index).not.toContain('registerHook(')
    expect(index).not.toContain('ctx.registerRoute')

    const client = read('client.tsx')
    expect(client).toContain('registerPlugin')
    expect(client).toContain(`'/${PLUGIN}': DemoCrmPage`)
    expect(client).not.toContain('pages:')
  })

  it('template imports are all declared (static import-scan, tests/ excluded)', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(() => validatePluginImports(root, pkg)).not.toThrow()
  })

  it('never emits the unresolvable ^0.0.0-dev SDK dependency', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.devDependencies['@makinbakin/sdk']).not.toBe('^0.0.0-dev')
    expect(pkg.dependencies.zod).toBeDefined()
    expect(pkg.devDependencies['@types/bun']).toBeDefined()
  })

  it('tsconfig carries the compiler options a standalone typecheck needs', () => {
    const tsconfig = JSON.parse(read('tsconfig.json'))
    expect(tsconfig.compilerOptions).toMatchObject({
      jsx: 'react-jsx',
      moduleResolution: 'bundler',
      strict: true,
      noEmit: true,
    })
  })

  it('starter test drives the plugin through @makinbakin/sdk/testing', () => {
    const test = read('tests/plugin.test.ts')
    expect(test).toContain("from '@makinbakin/sdk/testing'")
    expect(test).toContain("import plugin from '../index'")
    expect(test).toContain('dispose()')
    expect(test).not.toContain('TODO')
  })

  it('generated greeting helper behaves as the starter test asserts', async () => {
    // Import the pure template output directly (Bun runs TS natively) —
    // proves template and starter test agree without a bun install.
    const { buildGreeting } = await import(join(root, 'greeting.ts')) as { buildGreeting: (name?: string) => string }
    expect(buildGreeting('Ada')).toBe('Hello from Ada!')
    expect(buildGreeting()).toBe(`Hello from the ${PLUGIN} plugin!`)
  })

  it('refuses invalid names and existing directories', () => {
    expect(createPluginScaffold('Bad_Name').ok).toBe(false)
    expect(createPluginScaffold(PLUGIN).ok).toBe(false)
  })
})

describe('resolveScaffoldVersions', () => {
  it('pins to the host version on stamped builds', () => {
    expect(resolveScaffoldVersions('1.2.3')).toEqual({ bakinRange: '>=1.2.3', sdkDependency: '^1.2.3' })
  })

  it('falls back to latest for the npm SDK on dev builds', () => {
    expect(resolveScaffoldVersions('0.0.0-dev')).toEqual({ bakinRange: '>=0.0.0-dev', sdkDependency: 'latest' })
  })

  it('prerelease-stamped hosts use the stripped base floor and a resolvable SDK dep', () => {
    // rc release build
    expect(resolveScaffoldVersions('0.6.0-rc.1')).toEqual({ bakinRange: '>=0.6.0', sdkDependency: 'latest' })
    // describe-stamped self-build — ^0.6.1-3-gabc1234 is unresolvable on npm
    expect(resolveScaffoldVersions('0.6.1-3-gabc1234')).toEqual({ bakinRange: '>=0.6.1', sdkDependency: 'latest' })
    expect(resolveScaffoldVersions('0.6.1-3-gabc1234-dirty')).toEqual({ bakinRange: '>=0.6.1', sdkDependency: 'latest' })
  })
})
