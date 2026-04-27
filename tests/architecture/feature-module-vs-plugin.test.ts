/**
 * Architecture fitness test (Phase 7 P7.C3).
 *
 * Walks the trees that constitute "core code" — `src/`, `cli/`,
 * `packages/core/`, `packages/host/` — and grep-asserts that no
 * source line imports from a third-party plugin install path
 * (`~/.bakin/plugins/*` or relative paths that traverse into a
 * `.bakin/plugins/` segment).
 *
 * Belt + suspenders alongside the `no-restricted-imports` rule in
 * `eslint.config.mjs`. The lint rule catches violations at PR time;
 * this test runs in CI's `bun test --isolate` step so a glob-pattern
 * drift in the lint config can't silently weaken the boundary.
 *
 * Failure mode is loud: assertion message lists every offending
 * `<file>:<line>` so the author sees exactly what to fix.
 *
 * Defensive isolation: this test is pure repo-tree reading — no fs
 * writes, no `~/.bakin/` access — but the standard content-dir
 * mocks are wired up so the test stays hermetic by construction
 * if it ever grows to need bakin runtime types.
 */
import { describe, it, expect, mock } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-arch-fitness-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

const REPO_ROOT = join(__dirname, '..', '..')

/** Paths whose contents must NOT contain a third-party plugin import. */
const ROOTS = [
  'src/core',
  'src/lib',
  'cli',
  'packages/core',
  'packages/host',
] as const

/** Skip generated/vendored output. */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '__tmp_lint_check',
])

/** Only inspect TypeScript source. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx'])

/**
 * Patterns flagged as third-party plugin imports. Keep this regex
 * narrow enough to skip false positives (`packages/core/src/plugins/
 * lockfile.ts` legitimately mentions the runtime plugin path in
 * comments) but broad enough to catch real violations.
 */
const FORBIDDEN_IMPORT_REGEX = /\b(import\s.*from|require)\s*\(?['"]([^'"]*\/?\.bakin\/plugins\/[^'"]*)['"]/g

interface Violation {
  file: string
  line: number
  match: string
}

function* walk(dir: string): Generator<string> {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
      continue
    }
    if (!entry.isFile()) continue
    const ext = full.slice(full.lastIndexOf('.'))
    if (!SOURCE_EXTENSIONS.has(ext)) continue
    yield full
  }
}

function findViolations(): Violation[] {
  const violations: Violation[] = []
  for (const root of ROOTS) {
    const absRoot = join(REPO_ROOT, root)
    try {
      statSync(absRoot)
    } catch {
      continue
    }
    for (const file of walk(absRoot)) {
      const lines = readFileSync(file, 'utf-8').split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        FORBIDDEN_IMPORT_REGEX.lastIndex = 0
        if (FORBIDDEN_IMPORT_REGEX.test(line)) {
          violations.push({
            file: relative(REPO_ROOT, file),
            line: i + 1,
            match: line.trim(),
          })
        }
      }
    }
  }
  return violations
}

describe('architecture: feature modules vs third-party plugins', () => {
  it('no source line in src/, cli/, packages/core/, packages/host/ imports from ~/.bakin/plugins/', () => {
    const violations = findViolations()
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n')
      throw new Error(
        `Found ${violations.length} core→third-party-plugin import violation(s):\n${msg}\n\n` +
        `Core code must reach third-party plugins via ctx.hooks (server) or @bakin/sdk/hooks (client). ` +
        `Direct imports of ~/.bakin/plugins/* break under hot reload AND fail at runtime in production binaries.`,
      )
    }
    expect(violations).toHaveLength(0)
  })
})
