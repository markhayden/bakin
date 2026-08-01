import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { SDK_EXPORTS } from '../../../scripts/build-sdk-package'
import { SDK_VENDOR_TARGETS } from '../../../scripts/build-vendors'
import { SDK_SUBPATHS } from '../../../src/core/whiskit/build'
import {
  PLUGIN_CLIENT_EXTERNALS,
  REACT_EXTERNALS,
  SDK_EXTERNALS,
} from '../../../src/core/whiskit/externals'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const FOCUSED_SUBPATHS = ['ui', 'layout', 'patterns', 'charts', 'conversation', 'content', 'navigation'] as const

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

  it('does not retain a placeholder after a focused domain starts migration', () => {
    const conversation = readFileSync(join(REPO_ROOT, 'packages/sdk/src/conversation/index.ts'), 'utf8')
    expect(conversation).not.toContain('export {}')
    expect(conversation).toContain("from '@bakin/ui/conversation'")
  })

  it('the frozen components barrel is deleted from every contract surface (P-final)', () => {
    const manifest = readJson('packages/sdk/package.json')
    const tsconfig = readJson('tsconfig.json')
    const importMap = browserImportMap()
    const vendorTargets = new Map(SDK_VENDOR_TARGETS.map((entry) => [entry.specifier, entry]))

    expect(manifest.exports['./components']).toBeUndefined()
    expect(tsconfig.compilerOptions.paths['@makinbakin/sdk/components']).toBeUndefined()
    expect(SDK_EXTERNALS).not.toContain('@makinbakin/sdk/components')
    expect(vendorTargets.has('@makinbakin/sdk/components')).toBe(false)
    expect(importMap['@makinbakin/sdk/components']).toBeUndefined()
    expect(existsSync(join(REPO_ROOT, 'packages/sdk/src/components'))).toBe(false)
    expect(FOCUSED_SUBPATHS).not.toContain('components' as never)
  })

  it('keeps React, SDK modules, and the canonical stylesheet single at host runtime', () => {
    const html = readFileSync(join(REPO_ROOT, 'packages/host/public/index.html'), 'utf8')
    const sdk = readJson('packages/sdk/package.json')
    const ui = readJson('packages/ui/package.json')
    const importMap = browserImportMap()

    expect(PLUGIN_CLIENT_EXTERNALS).toEqual([...REACT_EXTERNALS, ...SDK_EXTERNALS])
    expect(new Set(PLUGIN_CLIENT_EXTERNALS).size).toBe(PLUGIN_CLIENT_EXTERNALS.length)
    expect(importMap['react-dom']).toBe('/vendor/react-dom.js')
    expect(importMap['react-dom/client']).toBe('/vendor/react-dom.js')
    expect(sdk.peerDependencies).toMatchObject({ react: '^19.0.0', 'react-dom': '^19.0.0' })
    expect(sdk.peerDependencies).toMatchObject({ '@tanstack/react-router': '^1.168.23' })
    expect(sdk.dependencies?.['@tanstack/react-router']).toBeUndefined()
    expect(sdk.dependencies?.react).toBeUndefined()
    expect(sdk.dependencies?.['react-dom']).toBeUndefined()
    expect(ui.peerDependencies).toMatchObject({ react: '^19.0.0', 'react-dom': '^19.0.0' })
    expect(ui.dependencies?.react).toBeUndefined()
    expect(ui.dependencies?.['react-dom']).toBeUndefined()
    expect(html.match(/<link rel="stylesheet" href="\/globals\.css"/g)).toHaveLength(1)
    expect(Object.keys(importMap).filter((specifier) => specifier.endsWith('.css'))).toEqual([])
  })
})
