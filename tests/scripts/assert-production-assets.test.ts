import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { assertProductionAssets } from '../../scripts/assert-production-assets'

const tmpRoots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-production-assets-'))
  tmpRoots.push(root)
  mkdirSync(join(root, 'packages/host/dist'), { recursive: true })
  mkdirSync(join(root, 'packages/host/public/vendor'), { recursive: true })
  mkdirSync(join(root, 'plugins/tasks/dist'), { recursive: true })
  return root
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('assertProductionAssets', () => {
  it('passes for production browser assets', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'packages/host/dist/main.js'), 'import { jsx } from "react/jsx-runtime"\n')
    writeFileSync(join(root, 'packages/host/public/vendor/sdk-index.js'), 'export const ok = true\n')
    writeFileSync(join(root, 'plugins/tasks/dist/client.js'), 'import { jsx } from "react/jsx-runtime"\n')

    expect(() => assertProductionAssets({ rootDir: root })).not.toThrow()
  })

  it('fails when production assets import the JSX dev runtime', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'plugins/tasks/dist/client.js'), 'import { jsxDEV } from "react/jsx-dev-runtime"\n')

    expect(() => assertProductionAssets({ rootDir: root })).toThrow('react/jsx-dev-runtime')
  })

  it('fails when production assets contain Storybook or Vite workbench dependencies', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'packages/host/dist/main.js'), [
      'import { channel } from "storybook/internal/channels"',
      'import { createServer } from "vite"',
    ].join('\n'))

    expect(() => assertProductionAssets({ rootDir: root })).toThrow(
      'main.js contains development-only UI workbench dependency storybook/internal/',
    )
    expect(() => assertProductionAssets({ rootDir: root })).toThrow(
      'main.js contains development-only UI workbench dependency from "vite"',
    )
  })

  it('fails when the host production build emits source maps', () => {
    const root = makeRoot()
    writeFileSync(join(root, 'packages/host/dist/main.js'), 'export const ok = true\n')
    writeFileSync(join(root, 'packages/host/dist/main.js.map'), '{}\n')

    expect(() => assertProductionAssets({ rootDir: root })).toThrow('main.js.map')
  })
})
