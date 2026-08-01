#!/usr/bin/env bun
/**
 * Fail a CI run that silently skipped test files.
 *
 * Why this exists (#753): a sharded run was observed finishing GREEN having
 * never dispatched ~7 alphabetically contiguous files. Zero failures were
 * logged because nothing failed — the work simply never ran, and the contiguity
 * said a worker had been handed its chunk and wedged. Exit code and failure
 * count cannot see that class: a run that does less work looks identical to a
 * run where less work was needed.
 *
 * So we check coverage, not outcome. Every test file bun would discover must be
 * accounted for by some shard, or this fails and names the ones that are not.
 *
 * Usage:
 *   bun scripts/check-test-completeness.ts <report>...
 *     where <report> is a junit .xml or a captured shard stdout .log
 *
 * Two facts about bun's output that this script exists to survive — both found
 * by running it against real shards rather than assuming:
 *
 *  1. junit `file=` is sometimes ABSOLUTE and sometimes repo-relative, in the
 *     same report. Paths are normalized before comparison.
 *  2. A file whose tests are ALL skipped (e.g. the antfly suites, gated on a
 *     binary that is absent) emits NO <testsuite> element whatsoever. In junit
 *     alone it is indistinguishable from a file that never ran. bun's stdout
 *     does print its path as a header, so the shard logs are parsed too and the
 *     two sources are unioned. Passing only junit would fail every run.
 *
 * Also note bun nests <testsuite> (one per file, then one per describe), with
 * the file attribute repeated — count DISTINCT files, never a sum.
 */
import { readFileSync, existsSync } from 'fs'
import { Glob } from 'bun'

/** Mirrors --path-ignore-patterns in package.json's test scripts (root-anchored). */
const IGNORED_PREFIXES = ['dev/', 'node_modules/']

/** bun's default matcher, not just the .test.ts we happen to write most of. */
const TEST_GLOBS = [
  '**/*.test.ts', '**/*.test.tsx', '**/*.test.js', '**/*.test.jsx', '**/*.test.mjs',
]

const repoRoot = process.cwd().split('\\').join('/').replace(/\/$/, '')

function normalize(path: string): string {
  const p = path.split('\\').join('/')
  return p.startsWith(repoRoot + '/') ? p.slice(repoRoot.length + 1) : p
}

function discoverTestFiles(): string[] {
  const found = new Set<string>()
  for (const pattern of TEST_GLOBS) {
    for (const file of new Glob(pattern).scanSync('.')) {
      const n = normalize(file)
      if (IGNORED_PREFIXES.some((prefix) => n.startsWith(prefix))) continue
      found.add(n)
    }
  }
  return [...found].sort()
}

/** Distinct file attributes across every <testsuite> in a junit report. */
function filesInJunit(xml: string): Set<string> {
  const files = new Set<string>()
  for (const m of xml.matchAll(/<testsuite\b[^>]*\bfile="([^"]+)"/g)) {
    files.add(normalize(m[1]!))
  }
  return files
}

/**
 * File headers from bun's console output — `tests/foo/bar.test.ts:` on its own
 * line. This is the only source that names a file whose tests were all skipped.
 */
function filesInLog(text: string): Set<string> {
  const files = new Set<string>()
  for (const m of text.matchAll(/^(\S+\.test\.(?:ts|tsx|js|jsx|mjs)):\s*$/gm)) {
    files.add(normalize(m[1]!))
  }
  return files
}

function main(): void {
  const reports = process.argv.slice(2)
  if (reports.length === 0) {
    console.error('usage: bun scripts/check-test-completeness.ts <junit.xml|shard.log>...')
    process.exit(2)
  }

  const missingReports = reports.filter((r) => !existsSync(r))
  if (missingReports.length > 0) {
    // A shard that produced no report is the loudest possible form of the very
    // failure this script exists to catch — never treat it as "nothing to check".
    console.error(`✗ missing report(s): ${missingReports.join(', ')}`)
    console.error('  A shard that produced no report either crashed or never ran.')
    process.exit(1)
  }

  const ran = new Set<string>()
  for (const report of reports) {
    const text = readFileSync(report, 'utf-8')
    const files = report.endsWith('.xml') ? filesInJunit(text) : filesInLog(text)
    console.log(`  ${report}: ${files.size} files`)
    for (const f of files) ran.add(f)
  }

  const discovered = discoverTestFiles()
  const missing = discovered.filter((f) => !ran.has(f))

  console.log(`\ndiscovered ${discovered.length} test files; ${ran.size} accounted for across ${reports.length} report(s)`)

  if (missing.length > 0) {
    console.error(`\n✗ ${missing.length} test file(s) were never dispatched:\n`)
    for (const f of missing) console.error(`    ${f}`)
    console.error('\nThe run cannot be considered green — this is the #753 stall signature.')
    console.error('Re-run; if it recurs, instrument the workers rather than retrying.')
    process.exit(1)
  }

  // Ran but not discovered means the glob and bun's discovery disagree. Worth
  // surfacing (the ignore list may be stale) but not a reason to fail a build.
  const unexpected = [...ran].filter((f) => !discovered.includes(f))
  if (unexpected.length > 0) {
    console.warn(`\n! ${unexpected.length} file(s) ran but the glob did not discover:`)
    for (const f of unexpected) console.warn(`    ${f}`)
  }

  console.log('\n✓ every discovered test file ran')
}

main()
