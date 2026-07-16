/**
 * Canonical Health is a single-version contract. This text scan prevents the
 * retired result/repair vocabulary from quietly re-entering production or its
 * direct consumers after the cutover.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SELF = 'tests/architecture/health-contract.test.ts'
const SCAN_ROOTS = ['packages', 'plugins', 'src', 'tests']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.astro'])
const SKIP_FILES = new Set([
  SELF,
  // Generated and intentionally user-owned during this project.
  'packages/host/src/api/_embedded-assets-static.ts',
])

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(?:ts|tsx)$/.test(name)) yield full
  }
}

const files = SCAN_ROOTS.flatMap(root => [...walk(join(ROOT, root))])
  .map(file => ({
    path: relative(ROOT, file),
    source: readFileSync(file, 'utf8'),
  }))
  .filter(file => !SKIP_FILES.has(file.path))

function matches(pattern: RegExp, scopedFiles = files): string[] {
  return scopedFiles.flatMap(file => file.source.split('\n').flatMap((line, index) => {
    pattern.lastIndex = 0
    return pattern.test(line) ? [`${file.path}:${index + 1}: ${line.trim()}`] : []
  }))
}

const globalLegacyTerms = [
  ['legacy result type', new RegExp(['Health', 'Check', 'Result'].join(''))],
  ['adapter result fork', new RegExp(['Adapter', 'Health', 'Check', 'Result'].join(''))],
  ['adapter definition fork', new RegExp(['Adapter', 'Health', 'Check', 'Definition'].join(''))],
  ['retired Health service factory', new RegExp(['create', 'Health', 'Service'].join(''))],
  ['retired last-results cache', new RegExp(['getLast', 'Results'].join(''))],
  ['retired result constructor', new RegExp(['health', 'Fixed'].join(''))],
  ['message-derived row identity', new RegExp(['row', 'Signature'].join(''))],
] as const

function isCanonicalHealthSurface(path: string): boolean {
  return path.startsWith('plugins/health/')
    || /^src\/(?:cli\/commands|core\/cli\/ui)\/doctor(?:-repair)?\.tsx?$/.test(path)
    || /^src\/core\/(?:doctor|health-)/.test(path)
    || path === 'plugins/team/components/diagnostics-tab.tsx'
    || path === 'packages/sdk/src/types/health.ts'
    || /^tests\/(?:cli\/doctor|core\/(?:doctor|health)|plugins\/health)/.test(path)
    || path === 'tests/plugins/team/diagnostics-tab.test.tsx'
}

const canonicalHealthFiles = files.filter(file => isCanonicalHealthSurface(file.path))
const healthLegacyTerms = [
  ['embedded repairability flag', /\bautoFixable\b/, ['tests/plugins/health/checks-route.test.ts']],
  ['embedded repair callback', /\bautoFix\b/, [
    'tests/core/health-check-registry.test.ts',
    'tests/core/health-contract.test.ts',
    'tests/plugins/health/checks-route.test.ts',
  ]],
  ['retired fixed diagnostic status', /(?:status\s*(?:===|:)|case)\s*['"]fixed['"]/, []],
] as const

describe('canonical Health contract has no compatibility plane', () => {
  for (const [label, pattern] of globalLegacyTerms) {
    it(`has no ${label}`, () => {
      expect(matches(pattern)).toEqual([])
    })
  }

  for (const [label, pattern, negativeFixturePaths] of healthLegacyTerms) {
    it(`has no ${label} in Health producers or consumers`, () => {
      const negativeFixtures = new Set<string>(negativeFixturePaths)
      const scanned = canonicalHealthFiles.filter(file => !negativeFixtures.has(file.path))
      expect(matches(pattern, scanned)).toEqual([])
    })
  }
})
