import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SDK_EXPORTS,
  buildSdkPackage,
  findForbiddenPackageImports,
} from '../../scripts/build-sdk-package'

const testRoot = join(tmpdir(), `bakin-test-build-sdk-package-${Date.now()}`)

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function collectFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(path))
    else out.push(path)
  }
  return out
}

describe('buildSdkPackage', () => {
  it('builds JS and declarations for every public SDK export', async () => {
    const outDir = join(testRoot, 'package')
    await buildSdkPackage({ version: '0.9.0-rc.1', outDir })

    const pkg = readJson<{
      name: string
      version: string
      type: string
      exports: Record<string, { import: string; types: string }>
      peerDependencies: Record<string, string>
      dependencies: Record<string, string>
    }>(join(outDir, 'package.json'))

    expect(pkg.name).toBe('@bakin/sdk')
    expect(pkg.version).toBe('0.9.0-rc.1')
    expect(pkg.type).toBe('module')
    expect(pkg.peerDependencies).toEqual({
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    })
    expect(pkg.dependencies.zod).toBeDefined()
    expect(pkg.dependencies['@base-ui/react']).toBeDefined()

    for (const entry of SDK_EXPORTS) {
      const exportConfig = pkg.exports[entry.exportPath]
      expect(exportConfig).toBeDefined()
      expect(existsSync(join(outDir, exportConfig.import))).toBe(true)
      expect(existsSync(join(outDir, exportConfig.types))).toBe(true)
      expect(statSync(join(outDir, exportConfig.import)).size).toBeGreaterThan(0)
      expect(statSync(join(outDir, exportConfig.types)).size).toBeGreaterThan(0)
    }
  }, 120_000)

  it('does not leak repo-only import specifiers into published JS or declarations', async () => {
    const outDir = join(testRoot, 'package-no-leaks')
    await buildSdkPackage({ version: '0.9.0', outDir })

    const files = collectFiles(outDir).filter((path) => path.endsWith('.js') || path.endsWith('.d.ts'))
    const leaks = findForbiddenPackageImports(files, outDir)

    expect(leaks).toEqual([])
  }, 120_000)

  it('refuses missing required options', async () => {
    const outDir = join(testRoot, 'missing-options')
    mkdirSync(outDir, { recursive: true })

    await expect(buildSdkPackage({ version: '', outDir })).rejects.toThrow('version is required')
  })
})
