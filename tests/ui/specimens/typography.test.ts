import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
}

describe('typography direction specimens', () => {
  it('keeps both locally bundled directions provisional until user review', () => {
    const metadata = JSON.parse(read('design-system/specimens/typography-candidates.json')) as {
      status: string
      selectedPair: string | null
      reviewRequired: boolean
      fonts: Array<{
        id: string
        package: string
        version: string
        license: string
        upstream: string
      }>
      directions: Array<{ id: string; sans: string; mono: string }>
    }
    const packageJson = JSON.parse(read('package.json')) as {
      devDependencies: Record<string, string>
    }

    expect(metadata.status).toBe('candidate')
    expect(metadata.selectedPair).toBeNull()
    expect(metadata.reviewRequired).toBe(true)
    expect(metadata.directions.map((direction) => direction.id)).toEqual([
      'operational-neutral',
      'product-character',
    ])
    expect(new Set(metadata.fonts.map((font) => font.id))).toEqual(
      new Set(['inter', 'space-grotesk', 'jetbrains-mono']),
    )
    for (const font of metadata.fonts) {
      expect(font.license).toBe('OFL-1.1')
      expect(font.upstream).toMatch(/^https:\/\/github\.com\//)
      expect(packageJson.devDependencies[font.package]).toBe(font.version)
    }
  })

  it('covers realistic compact text, 320px, 200% text, and explicit fallback states', () => {
    const story = read('storybook/internal/specimens/typography.stories.tsx')

    expect(story).toContain("tags: ['internal']")
    expect(story).toContain("import '@fontsource/space-grotesk/latin-400.css'")
    expect(story).toContain("import '@fontsource/space-grotesk/latin-700.css'")
    expect(story).not.toMatch(/@import\s+url|fonts\.(?:googleapis|gstatic)\.com/)
    for (const exportName of ['SideBySide', 'TextAt200Percent', 'FontFallbacks']) {
      expect(story).toContain(`export const ${exportName}`)
    }
    for (const coverage of ['desktop', 'mobile-320', 'text-200', 'fallback-missing', 'fallback-slow']) {
      expect(story).toContain(`'${coverage}'`)
    }
    for (const specimen of [
      'OpenClaw runtime capability synchronization and provider fallback recovery',
      'workflow://video-social-post/assemble-video',
      '1,284,330',
      '$18.42',
      'agent:patch:explicit:sess-01JZ9T4P6KE7',
    ]) {
      expect(story).toContain(specimen)
    }
    expect(story).toContain("'Bakin Missing Sans'")
    expect(story).toContain("'Bakin Pending Sans'")
    expect(story).toContain("<style>{'html { font-size: 200%; }'}</style>")
  })
})
