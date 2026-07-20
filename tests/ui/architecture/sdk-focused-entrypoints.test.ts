import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { SDK_EXPORTS } from '../../../scripts/build-sdk-package'
import { SDK_VENDOR_TARGETS } from '../../../scripts/build-vendors'
import { SDK_SUBPATHS } from '../../../src/core/whiskit/build'
import { SDK_EXTERNALS } from '../../../src/core/whiskit/externals'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const FOCUSED_SUBPATHS = ['ui', 'layout', 'patterns', 'charts', 'conversation'] as const
const PENDING_SUBPATHS = ['patterns', 'charts', 'conversation'] as const

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as Record<string, any>
}

function browserImportMap(): Record<string, string> {
  const html = readFileSync(join(REPO_ROOT, 'packages/host/public/index.html'), 'utf8')
  const match = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/)
  if (!match) throw new Error('host index is missing its browser import map')
  return (JSON.parse(match[1]!) as { imports: Record<string, string> }).imports
}

describe('focused public SDK entrypoint contract', () => {
  it('publishes every focused path through source, npm, browser, and plugin-build contracts', () => {
    const manifest = readJson('packages/sdk/package.json')
    const tsconfig = readJson('tsconfig.json')
    const importMap = browserImportMap()
    const packageExports = new Map(SDK_EXPORTS.map((entry) => [entry.exportPath, entry]))
    const vendorTargets = new Map(SDK_VENDOR_TARGETS.map((entry) => [entry.specifier, entry]))

    for (const subpath of FOCUSED_SUBPATHS) {
      const specifier = `@makinbakin/sdk/${subpath}`
      const source = `packages/sdk/src/${subpath}/index.ts`
      expect(manifest.exports[`./${subpath}`]).toBe(`./src/${subpath}/index.ts`)
      expect(tsconfig.compilerOptions.paths[specifier]).toEqual([`./${source}`])
      expect(packageExports.get(`./${subpath}`)?.source).toBe(source)
      expect(vendorTargets.get(specifier)).toEqual({
        specifier,
        name: `sdk-${subpath}`,
        entrypoint: source,
      })
      expect(importMap[specifier]).toBe(`/vendor/sdk-${subpath}.js`)
      expect(SDK_EXTERNALS).toContain(specifier)
      expect(SDK_SUBPATHS).toContain(subpath)
      expect(existsSync(join(REPO_ROOT, source))).toBe(true)
    }
  })

  it('keeps new domain entrypoints empty until their owned migration tasks land', () => {
    for (const subpath of PENDING_SUBPATHS) {
      const source = readFileSync(join(REPO_ROOT, `packages/sdk/src/${subpath}/index.ts`), 'utf8')
      expect(source).toContain('export {}')
      expect(source).not.toMatch(/export\s+(?:\*|\{)[^}]*\bfrom\b/)
    }
  })

  it('retains the components barrel only as a separately named legacy surface', () => {
    const manifest = readJson('packages/sdk/package.json')
    const importMap = browserImportMap()

    expect(manifest.exports['./components']).toBe('./src/components/index.ts')
    expect(SDK_EXTERNALS).toContain('@makinbakin/sdk/components')
    expect(importMap['@makinbakin/sdk/components']).toBe('/vendor/sdk-components.js')
    expect(FOCUSED_SUBPATHS).not.toContain('components' as never)
  })
})
