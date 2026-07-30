/**
 * Architecture scan: story scaffolding stays in Storybook.
 *
 * Nothing under src/, packages/, plugins/, cli/, or dev/ may import from
 * `storybook/` (including `storybook/support` and `storybook/fixtures`) or
 * `.storybook/`. Scaffolding exists to stage stories; app code importing it
 * would smuggle catalog chrome into the product bundle and invert the
 * dependency direction (stories depend on the SDK, never the reverse).
 *
 * Build tooling under scripts/ legitimately reads .storybook/audiences and
 * the fixture manifest, so scripts/ is exempt.
 *
 * Pure scanner: walks the source tree as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const ROOT = process.cwd()
const SCANNED_ROOTS = ['src', 'packages', 'plugins', 'cli', 'dev']
const SOURCE_PATTERN = /\.(?:ts|tsx|mts|js|jsx|mjs)$/
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git'])

const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), files)
    } else if (SOURCE_PATTERN.test(entry.name)) {
      files.push(join(dir, entry.name))
    }
  }
  return files
}

/** True when a specifier from `importer` reaches storybook/ or .storybook/. */
function reachesStorybook(importer: string, specifier: string): boolean {
  if (specifier.startsWith('.')) {
    const resolved = resolve(dirname(importer), specifier)
    const rel = relative(ROOT, resolved)
    return rel === 'storybook' || rel.startsWith('storybook/')
      || rel === '.storybook' || rel.startsWith('.storybook/')
  }
  return specifier === 'storybook' || specifier.startsWith('storybook/')
    || specifier === '.storybook' || specifier.startsWith('.storybook/')
}

describe('storybook support boundary', () => {
  it('classifier flags storybook-reaching specifiers and passes others', () => {
    const importer = join(ROOT, 'packages/host/src/example.tsx')
    expect(reachesStorybook(importer, '../../../storybook/support')).toBe(true)
    expect(reachesStorybook(importer, 'storybook/support')).toBe(true)
    expect(reachesStorybook(importer, '../../../.storybook/audiences')).toBe(true)
    expect(reachesStorybook(importer, '@makinbakin/sdk/ui')).toBe(false)
    expect(reachesStorybook(importer, './storybook-helpers')).toBe(false)
  })

  it('no app code imports story scaffolding', () => {
    const violations: string[] = []
    for (const rootName of SCANNED_ROOTS) {
      for (const file of walk(join(ROOT, rootName))) {
        const source = readFileSync(file, 'utf8')
        for (const match of source.matchAll(IMPORT_PATTERN)) {
          if (reachesStorybook(file, match[1]!)) {
            violations.push(`${relative(ROOT, file)} imports ${match[1]}`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })
})
