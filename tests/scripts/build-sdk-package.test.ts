import { afterAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  SDK_EXPORTS,
  SDK_STYLES_SPECIFIER,
  PUBLIC_SDK_PACKAGE_NAME,
  assertSdkStylesheetIdentity,
  buildSdkPackage,
  findForbiddenPackageImports,
} from '../../scripts/build-sdk-package'

const testRoot = join(tmpdir(), `bakin-test-build-sdk-package-${Date.now()}`)
const repoRoot = resolve(import.meta.dir, '../..')

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
      exports: Record<string, { import: string; types: string } | string>
      sideEffects: string[]
      peerDependencies: Record<string, string>
      dependencies: Record<string, string>
    }>(join(outDir, 'package.json'))

    expect(pkg.name).toBe(PUBLIC_SDK_PACKAGE_NAME)
    expect(pkg.version).toBe('0.9.0-rc.1')
    expect(pkg.type).toBe('module')
    expect(pkg.peerDependencies).toEqual({
      '@tanstack/react-router': '^1.168.23',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    })
    expect(pkg.dependencies.zod).toBeDefined()
    expect(pkg.dependencies['@base-ui/react']).toBeDefined()
    expect(SDK_STYLES_SPECIFIER).toBe('@makinbakin/sdk/styles.css')
    expect(pkg.exports['./styles.css']).toBe('./styles.css')
    expect(pkg.sideEffects).toEqual(['./styles.css'])
    expect(existsSync(join(outDir, 'styles.css'))).toBe(true)
    expect(readFileSync(join(outDir, 'styles.css'), 'utf-8')).toContain('--bakin-color-canvas-default')
    expect(readFileSync(join(outDir, 'styles.css'))).toEqual(
      readFileSync(join(repoRoot, 'packages/sdk/styles.css')),
    )

    for (const entry of SDK_EXPORTS) {
      const exportConfig = pkg.exports[entry.exportPath]
      expect(exportConfig).toBeDefined()
      if (typeof exportConfig === 'string') throw new Error(`${entry.exportPath} must be a JS/types export`)
      expect(existsSync(join(outDir, exportConfig.import))).toBe(true)
      expect(existsSync(join(outDir, exportConfig.types))).toBe(true)
      expect(statSync(join(outDir, exportConfig.import)).size).toBeGreaterThan(0)
      expect(statSync(join(outDir, exportConfig.types)).size).toBeGreaterThan(0)
    }

    const consumerDir = join(repoRoot, `.tmp-sdk-focused-consumer-${Date.now()}`)
    try {
      mkdirSync(join(consumerDir, 'node_modules/@makinbakin'), { recursive: true })
      symlinkSync(outDir, join(consumerDir, 'node_modules/@makinbakin/sdk'), 'dir')
      cpSync(join(repoRoot, 'tests/fixtures/sdk-focused-consumer/index.ts'), join(consumerDir, 'index.ts'))
      writeFileSync(join(consumerDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          skipLibCheck: true,
          preserveSymlinks: true,
        },
        include: ['index.ts'],
      }))
      const result = spawnSync(join(repoRoot, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], {
        cwd: consumerDir,
        encoding: 'utf8',
      })
      expect(`${result.stdout}${result.stderr}`).toBe('')
      expect(result.status).toBe(0)
    } finally {
      rmSync(consumerDir, { recursive: true, force: true })
    }
  }, 120_000)

  it('does not leak repo-only import specifiers into published JS or declarations', async () => {
    const outDir = join(testRoot, 'package-no-leaks')
    await buildSdkPackage({ version: '0.9.0', outDir })

    const files = collectFiles(outDir).filter((path) => path.endsWith('.js') || path.endsWith('.d.ts'))
    const leaks = findForbiddenPackageImports(files, outDir)

    expect(leaks).toEqual([])
  }, 120_000)

  it('rejects a compiled package stylesheet that differs from the canonical artifact', () => {
    const dir = join(testRoot, 'stylesheet-identity')
    const canonicalPath = join(dir, 'canonical.css')
    const candidatePath = join(dir, 'candidate.css')
    mkdirSync(dir, { recursive: true })
    writeFileSync(canonicalPath, ':root { --bakin-test: canonical; }\n')
    writeFileSync(candidatePath, ':root { --bakin-test: stale; }\n')

    expect(() => assertSdkStylesheetIdentity(candidatePath, canonicalPath)).toThrow(
      'SDK stylesheet does not match the canonical artifact',
    )

    writeFileSync(candidatePath, readFileSync(canonicalPath))
    expect(() => assertSdkStylesheetIdentity(candidatePath, canonicalPath)).not.toThrow()
  })

  it('copies the npm README with the public package name', async () => {
    const outDir = join(testRoot, 'package-readme')
    await buildSdkPackage({ version: '0.9.0', outDir })

    const readme = readFileSync(join(outDir, 'README.md'), 'utf-8')
    expect(readme).toContain(PUBLIC_SDK_PACKAGE_NAME)
  }, 120_000)

  it('emits declaration docs with the public package name', async () => {
    const outDir = join(testRoot, 'package-declaration-docs')
    await buildSdkPackage({ version: '0.9.0', outDir })

    const declarations = collectFiles(outDir)
      .filter((path) => path.endsWith('.d.ts'))
      .map((path) => readFileSync(path, 'utf-8'))
      .join('\n')

    expect(declarations).toContain(PUBLIC_SDK_PACKAGE_NAME)
  }, 120_000)

  it('refuses missing required options', async () => {
    const outDir = join(testRoot, 'missing-options')
    mkdirSync(outDir, { recursive: true })

    await expect(buildSdkPackage({ version: '', outDir })).rejects.toThrow('version is required')
  })
})
