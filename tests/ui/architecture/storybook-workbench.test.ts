import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

interface PackageManifest {
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('Storybook workbench foundation', () => {
  it('keeps the React/Vite workbench development-only and exposes Bun commands', () => {
    const manifest = JSON.parse(readRepoFile('package.json')) as PackageManifest

    expect(manifest.scripts['ui:dev']).toContain('storybook dev')
    expect(manifest.scripts['ui:dev']).toContain('--host 127.0.0.1')
    expect(manifest.scripts['ui:build']).toContain('storybook build')

    for (const dependency of ['storybook', '@storybook/react-vite', 'vite']) {
      expect(manifest.devDependencies[dependency]).toBeDefined()
      expect(manifest.dependencies[dependency]).toBeUndefined()
    }
  })

  it('uses the supported React/Vite framework and the internal story root', () => {
    const mainConfig = readRepoFile('.storybook/main.ts')

    expect(mainConfig).toContain("from '@storybook/react-vite'")
    expect(mainConfig).toContain("framework: '@storybook/react-vite'")
    expect(mainConfig).toContain("'../storybook/**/*.stories.@(ts|tsx)'")
  })

  it('renders a real public SDK component under the canonical compiled stylesheet', () => {
    const preview = readRepoFile('.storybook/preview.tsx')
    const foundationStory = readRepoFile('storybook/internal/foundation.stories.tsx')

    expect(preview).toContain("import '../packages/host/public/globals.css'")
    expect(foundationStory).toContain("from '@makinbakin/sdk/ui'")
    expect(foundationStory).not.toContain("from '@/components/")
    expect(foundationStory).not.toContain('packages/ui')
  })
})
