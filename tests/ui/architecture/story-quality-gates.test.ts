import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { validatePublicStoryA11yContract } from '../../../scripts/ui/build-storybook'

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const tempRoots: string[] = []

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bakin-story-a11y-'))
  tempRoots.push(root)
  mkdirSync(join(root, 'storybook/public'), { recursive: true })
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Storybook quality gates', () => {
  it('runs public stories and accessibility checks in Storybook Test', () => {
    const main = readRepoFile('.storybook/main.ts')
    const preview = readRepoFile('.storybook/preview.tsx')
    const manifest = JSON.parse(readRepoFile('package.json')) as {
      devDependencies: Record<string, string>
      scripts: Record<string, string>
    }

    expect(main).toContain("'@storybook/addon-a11y'")
    expect(main).toContain("'@storybook/addon-vitest'")
    expect(preview).toContain("test: 'error'")
    expect(preview).toContain("'wcag22a'")
    expect(preview).toContain("'wcag22aa'")
    expect(manifest.devDependencies['@storybook/addon-a11y']).toBe('10.5.2')
    expect(manifest.devDependencies['@storybook/addon-vitest']).toBe('10.5.2')
    expect(manifest.scripts['ui:test:stories']).toContain('vitest')
    expect(readRepoFile('vitest.config.ts')).toContain("name: 'storybook'")
    expect(readRepoFile('vitest.config.ts')).toContain('fileParallelism: false')
  })

  it('requires reason and evidence beside every public-story a11y suppression', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/invalid.stories.tsx'), [
      "export default { title: 'Invalid', tags: ['public'] }",
      "export const MissingMetadata = { parameters: { a11y: { test: 'todo' } } }",
      "export const MissingEvidence = { parameters: { a11y: { test: 'off' }, bakinA11ySuppression: { reason: 'Demonstrates misuse' } } }",
    ].join('\n'))

    expect(validatePublicStoryA11yContract(root)).toEqual([
      'storybook/public/invalid.stories.tsx:2 accessibility suppression requires non-empty parameters.bakinA11ySuppression.reason and .evidence',
      'storybook/public/invalid.stories.tsx:3 accessibility suppression requires non-empty parameters.bakinA11ySuppression.reason and .evidence',
    ])
  })

  it('accepts a narrow suppression with reviewable reason and evidence', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/valid.stories.tsx'), [
      "export default { title: 'Valid', tags: ['public'] }",
      'export const Documented = {',
      '  parameters: {',
      "    a11y: { config: { rules: [{ id: 'region', enabled: false }] } },",
      "    bakinA11ySuppression: { reason: 'Isolated component has no landmark', evidence: 'manual-a11y/foundation-button.md' },",
      '  },',
      '}',
    ].join('\n'))

    expect(validatePublicStoryA11yContract(root)).toEqual([])
  })

  it('detects a disabled axe rule through static constants and assertions', () => {
    const root = makeFixtureRoot()
    writeFileSync(join(root, 'storybook/public/meta-suppression.stories.tsx'), [
      'const disabled = false as const',
      "export default { title: 'Invalid meta', tags: ['public'], parameters: { a11y: { config: { rules: [{ id: 'region', enabled: disabled }] } } } }",
    ].join('\n'))

    expect(validatePublicStoryA11yContract(root)).toEqual([
      'storybook/public/meta-suppression.stories.tsx:2 accessibility suppression requires non-empty parameters.bakinA11ySuppression.reason and .evidence',
    ])
  })

  it('defines three browser behavior projects without cross-browser pixel baselines', () => {
    const config = readRepoFile('playwright.browser.config.ts')
    const container = readRepoFile('scripts/ui/playwright-container.ts')

    for (const browser of ['chromium', 'firefox', 'webkit']) {
      expect(config).toContain(`name: '${browser}'`)
      expect(config).toContain(`browserName: '${browser}'`)
    }
    expect(config).not.toContain('toHaveScreenshot')
    expect(config).not.toContain('snapshotPathTemplate')
    expect(readRepoFile('tests/ui/browser/story-smoke.browser.pw.ts')).not.toContain('toHaveScreenshot')
    expect(container).toContain("'XDG_CACHE_HOME=/tmp/bakin-playwright-cache'")
    expect(container).toContain("'XDG_CONFIG_HOME=/tmp/bakin-playwright-config'")
  })

  it('provides seeded teeth commands for axe, focus, keyboard, overflow, and console failures', () => {
    const manifest = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> }
    const teeth = [
      readRepoFile('scripts/ui/verify-story-teeth.ts'),
      readRepoFile('scripts/ui/verify-browser-teeth.ts'),
    ].join('\n')

    expect(manifest.scripts['ui:test:stories:teeth']).toContain('verify-story-teeth.ts')
    expect(manifest.scripts['ui:test:browsers:teeth']).toContain('verify-browser-teeth.ts')
    for (const seededFailure of ['axe', 'focus', 'keyboard', 'overflow', 'console']) {
      expect(teeth).toContain(`'${seededFailure}'`)
    }
  })
})
