import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  CANONICAL_PLAYWRIGHT_IMAGE,
  validateCanonicalEnvironment,
} from '../../../scripts/ui/canonical-playwright.mjs'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function readRepoFile(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('canonical Playwright visual harness', () => {
  it('pins the Playwright image and canonical desktop/mobile projects', () => {
    expect(CANONICAL_PLAYWRIGHT_IMAGE).toBe('mcr.microsoft.com/playwright:v1.60.0-noble')
    const config = readRepoFile('playwright.ui.config.ts')

    expect(config).toContain("name: 'chromium-desktop'")
    expect(config).toContain('viewport: { width: 1440, height: 900 }')
    expect(config).toContain("name: 'chromium-mobile'")
    expect(config).toContain('viewport: { width: 320, height: 800 }')
    expect(config).toContain("timezoneId: 'UTC'")
    expect(config).toContain("trace: 'retain-on-failure'")
    expect(config).toContain("outputFolder: 'playwright-report/ui'")
    expect(config).toContain('tests/ui/snapshots')
    expect(config).toContain("testMatch: '**/*.visual.ts'")
    expect(readdirSync(join(REPO_ROOT, 'tests/ui/visual'))).toEqual(['foundation.visual.ts'])
  })

  it('allows rendering in the pinned image but never allows CI to update snapshots', () => {
    const canonical = {
      platform: 'linux',
      architecture: 'x64',
      imageMarker: CANONICAL_PLAYWRIGHT_IMAGE,
      osRelease: 'ID=ubuntu\nVERSION_CODENAME=noble\n',
      playwrightVersion: '1.60.0',
      ci: false,
    }
    expect(validateCanonicalEnvironment(canonical, 'render')).toEqual([])
    expect(validateCanonicalEnvironment(canonical, 'update')).toEqual([])
    expect(validateCanonicalEnvironment({ ...canonical, ci: true }, 'render')).toEqual([])
    expect(validateCanonicalEnvironment({ ...canonical, ci: true }, 'update')).toContain(
      'CI is never allowed to update visual baselines',
    )
    expect(validateCanonicalEnvironment({ ...canonical, playwrightVersion: '1.61.0' }, 'render')).toContain(
      `Playwright package 1.61.0 does not match ${CANONICAL_PLAYWRIGHT_IMAGE}`,
    )
  })

  it('refuses macOS, non-x64, unmarked, and non-Noble baseline updates', () => {
    const violations = validateCanonicalEnvironment({
      platform: 'darwin',
      architecture: 'arm64',
      imageMarker: '',
      osRelease: 'ID=macos\nVERSION_CODENAME=sequoia\n',
      playwrightVersion: '1.60.0',
      ci: false,
    }, 'update')

    expect(violations).toContain('visual baselines require Linux, received darwin')
    expect(violations).toContain('visual baselines require x64, received arm64')
    expect(violations).toContain(`missing canonical image marker ${CANONICAL_PLAYWRIGHT_IMAGE}`)
    expect(violations).toContain('visual baselines require Ubuntu Noble')
  })

  it('exposes safe test/update commands and a seeded teeth check', () => {
    const manifest = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> }

    expect(manifest.scripts['ui:test:visual']).toContain('scripts/ui/run-visual-tests.ts')
    expect(manifest.scripts['ui:test:visual:teeth']).toContain('scripts/ui/verify-visual-teeth.ts')
    expect(manifest.scripts['ui:snapshots:update']).toContain('scripts/ui/update-snapshots.ts')
    expect(readRepoFile('tests/ui/visual/foundation.visual.ts')).toContain('BAKIN_UI_VISUAL_SEED_DIFF')
  })

  it('keeps update flags out of CI and uploads every failure artifact', () => {
    const workflow = readRepoFile('.github/workflows/ui-visual.yml')
    const callers = [
      readRepoFile('.github/workflows/ci-pr.yml'),
      readRepoFile('.github/workflows/ci-main.yml'),
    ].join('\n')

    expect(workflow).toContain(`image: ${CANONICAL_PLAYWRIGHT_IMAGE}`)
    expect(workflow).toContain('options: --init --ipc=host')
    expect(workflow).toContain('bun run ui:test:visual')
    expect(workflow).not.toContain('update-snapshots')
    expect(workflow).toContain('if: failure()')
    expect(workflow).toContain('playwright-report/ui')
    expect(workflow).toContain('test-results/ui-visual')
    expect(callers).toContain('./.github/workflows/ui-visual.yml')
  })

  it('tracks both canonical sample baselines', () => {
    for (const project of ['chromium-desktop', 'chromium-mobile']) {
      expect(existsSync(join(
        REPO_ROOT,
        'tests/ui/snapshots',
        project,
        'foundation.visual.ts',
        'foundation-button.png',
      ))).toBe(true)
    }
  })
})
