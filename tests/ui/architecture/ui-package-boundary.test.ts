import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { validatePluginImports } from '../../../src/core/whiskit/import-scan'
import {
  findPrivateUiDependencyViolations,
  findPrivateUiImportViolations,
} from '../../../scripts/ui/private-ui-boundary'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const fixtureRoots: string[] = []

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-private-ui-boundary-'))
  fixtureRoots.push(root)
  return root
}

function writeFixture(root: string, path: string, source: string): void {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, source)
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as Record<string, any>
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('private UI package contract', () => {
  it('is a private, side-effect-controlled workspace with explicit exports and React peers', () => {
    const manifest = readJson('packages/ui/package.json')
    const tsconfig = readJson('tsconfig.json')
    const host = readJson('packages/host/package.json')
    const sdk = readJson('packages/sdk/package.json')

    expect(manifest).toMatchObject({
      name: '@bakin/ui',
      private: true,
      type: 'module',
      main: './src/index.ts',
      types: './src/index.ts',
      exports: {
        '.': './src/index.ts',
        './tokens': './src/tokens.generated.ts',
      },
      sideEffects: ['./src/styles/*.css'],
      peerDependencies: {
        react: '^19.0.0',
        'react-dom': '^19.0.0',
      },
    })
    expect(manifest.publishConfig).toBeUndefined()
    expect(manifest.dependencies?.react).toBeUndefined()
    expect(manifest.dependencies?.['react-dom']).toBeUndefined()
    expect(tsconfig.compilerOptions.paths['@bakin/ui']).toEqual(['./packages/ui/src/index.ts'])
    expect(tsconfig.compilerOptions.paths['@bakin/ui/*']).toEqual(['./packages/ui/src/*'])
    expect(host.dependencies['@bakin/ui']).toBe('workspace:*')
    expect(sdk.devDependencies['@bakin/ui']).toBe('workspace:*')
  })

  it('gives host and SDK consumers the same CSS-free React implementation', async () => {
    const [direct, host, sdk] = await Promise.all([
      import('@bakin/ui'),
      import('../../../packages/host/src/private-ui-boundary-probe'),
      import('../../../packages/sdk/src/internal/private-ui-boundary-probe'),
    ])

    expect(host.PrivateUiBoundaryProbe).toBe(direct.PrivateUiBoundaryProbe)
    expect(sdk.PrivateUiBoundaryProbe).toBe(direct.PrivateUiBoundaryProbe)
    const element = direct.PrivateUiBoundaryProbe({ children: 'private boundary' })
    expect(element.type).toBe('span')
    expect((element.props as Record<string, unknown>)['data-bakin-ui-boundary']).toBe('private')

    const root = fixtureRoot()
    const entry = join(root, 'entry.ts')
    writeFileSync(entry, [
      `import * as host from ${JSON.stringify(join(REPO_ROOT, 'packages/host/src/private-ui-boundary-probe.ts'))}`,
      `import * as sdk from ${JSON.stringify(join(REPO_ROOT, 'packages/sdk/src/internal/private-ui-boundary-probe.ts'))}`,
      'export const sameImplementation = host.PrivateUiBoundaryProbe === sdk.PrivateUiBoundaryProbe',
      'export const hostProbe = host.PrivateUiBoundaryProbe',
      'export const sdkProbe = sdk.PrivateUiBoundaryProbe',
    ].join('\n'))
    const result = await Bun.build({
      entrypoints: [entry],
      outdir: join(root, 'dist'),
      target: 'browser',
      format: 'esm',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
    })

    expect(result.success).toBe(true)
    const jsOutputs = result.outputs.filter((output) => output.path.endsWith('.js'))
    const cssOutputs = result.outputs.filter((output) => output.path.endsWith('.css'))
    expect(jsOutputs).toHaveLength(1)
    expect(cssOutputs).toHaveLength(0)
    const source = readFileSync(jsOutputs[0]!.path, 'utf8')
    expect(source.match(/data-bakin-ui-boundary/g)).toHaveLength(1)
    expect(source.match(/from\s+["']react["']/g)).toHaveLength(1)
  })
})

describe('private UI ownership gate', () => {
  it('allows only UI, host, SDK, and internal Storybook owners', () => {
    const root = fixtureRoot()
    writeFixture(root, 'packages/ui/src/index.ts', "export const marker = 'ui'\n")
    writeFixture(root, 'packages/host/src/allowed.ts', "export { marker } from '@bakin/ui'\n")
    writeFixture(root, 'packages/sdk/src/allowed.ts', "export { marker } from '@bakin/ui'\n")
    writeFixture(root, 'storybook/internal/allowed.stories.tsx', "import { marker } from '@bakin/ui'\nexport default marker\n")
    writeFixture(root, 'plugins/example/client.tsx', "import { marker } from '@bakin/ui'\nexport default marker\n")
    writeFixture(root, 'src/components/bypass.ts', "export { marker } from '../../packages/ui/src'\n")
    writeFixture(root, 'storybook/public/private.stories.tsx', "import { marker } from '@bakin/ui/tokens'\nexport default marker\n")
    writeFixture(root, 'packages/host/public/vendor/generated.js', "export { marker } from '@bakin/ui'\n")

    expect(findPrivateUiImportViolations(root)).toEqual([
      'plugins/example/client.tsx:1 cannot import @bakin/ui; private UI is limited to host, SDK, and internal Storybook',
      'src/components/bypass.ts:1 cannot import ../../packages/ui/src; private UI is limited to host, SDK, and internal Storybook',
      'storybook/public/private.stories.tsx:1 cannot import @bakin/ui/tokens; private UI is limited to host, SDK, and internal Storybook',
    ])
  })

  it('keeps private UI presentation-only, package-local, declared, and free of runtime CSS imports', () => {
    const root = fixtureRoot()
    writeFixture(root, 'packages/ui/package.json', JSON.stringify({
      dependencies: { clsx: '^2.1.1' },
      peerDependencies: { react: '^19.0.0' },
    }))
    writeFixture(root, 'packages/ui/src/index.ts', [
      "import type { ReactNode } from 'react'",
      "import { clsx } from 'clsx'",
      "import { z } from 'zod'",
      "export { Button } from '@makinbakin/sdk/ui'",
      "export { app } from '../../../src/app'",
      "import './styles/runtime.css'",
      "export { local } from './local'",
      'export const value: ReactNode = clsx(z.string())',
    ].join('\n'))
    writeFixture(root, 'packages/ui/src/local.ts', 'export const local = true\n')
    writeFixture(root, 'packages/ui/src/styles/runtime.css', ':root {}\n')

    expect(findPrivateUiDependencyViolations(root)).toEqual([
      'packages/ui/src/index.ts:3 imports undeclared runtime dependency zod',
      'packages/ui/src/index.ts:4 imports undeclared runtime dependency @makinbakin/sdk',
      'packages/ui/src/index.ts:5 relative import escapes packages/ui/src: ../../../src/app',
      'packages/ui/src/index.ts:6 runtime modules must not import CSS: ./styles/runtime.css',
    ])
  })

  it('keeps the checked-in repository inside both boundaries', () => {
    expect(findPrivateUiImportViolations(REPO_ROOT)).toEqual([])
    expect(findPrivateUiDependencyViolations(REPO_ROOT)).toEqual([])
  })

  it('rejects a plugin that declares the private package as its own dependency', () => {
    const root = fixtureRoot()
    writeFixture(root, 'client.tsx', "import { PrivateUiBoundaryProbe } from '@bakin/ui'\nexport default PrivateUiBoundaryProbe\n")

    expect(() => validatePluginImports(root, {
      dependencies: { '@bakin/ui': 'workspace:*' },
    })).toThrow('@bakin/ui is private; use @makinbakin/sdk/*')
  })
})
