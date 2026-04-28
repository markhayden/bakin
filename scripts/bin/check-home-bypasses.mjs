#!/usr/bin/env node
/**
 * Lint guard: fail the build if any source file constructs a path to
 * ~/.bakin/ or ~/.openclaw/ without going through getContentDir() /
 * getBakinPaths() / getOpenClawHome() / getOpenClawPath().
 *
 * Background: leaking test data into the developer's real ~/.bakin/ or
 * ~/.openclaw/ has repeatedly corrupted the production instance. Runtime
 * guards in content-dir.ts and adapter-openclaw/home.ts catch it at test time;
 * this script catches it at lint time so the pattern never ships.
 *
 * Allowlist: the resolver modules themselves, plus the onboarding/init
 * paths that legitimately have to write the real home directory.
 */
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()

// Paths allowed to construct ~/.bakin or ~/.openclaw directly.
// Keep this list as small as possible.
const ALLOWLIST = [
  // Resolver modules — they ARE the source of truth
  'packages/core/src/content-dir.ts',
  'packages/adapter-openclaw/src/home.ts',
  // Onboarding/init legitimately needs to materialize the real directories
  'src/core/onboarding',
  // Dev mock sets its own home and must know the real one to avoid collisions
  'dev/imitation-crab',
  // CLI `bakin init` seeds the real home
  'cli/bakin.ts',
  // Guard script + regression test intentionally reference the raw paths
  'scripts/bin/check-home-bypasses.mjs',
  'tests/core/leak-guard.test.ts',
]

// Forbidden patterns — each is a regex that should NOT appear outside
// the allowlist. We require `join(` in the match so template-literal prose
// like `Check ~/.bakin/logs/server.log` in alert messages is not flagged.
const PATTERNS = [
  {
    label: "join(homedir(), '.bakin')",
    regex: /join\s*\(\s*[^)]*homedir\s*\(\s*\)[^)]*['"`]\.bakin['"`]/,
  },
  {
    label: "join(homedir(), '.openclaw')",
    regex: /join\s*\(\s*[^)]*homedir\s*\(\s*\)[^)]*['"`]\.openclaw['"`]/,
  },
  {
    label: "join(process.env.HOME, '.bakin')",
    regex: /join\s*\(\s*[^)]*process\.env\.HOME[^)]*['"`]\.bakin['"`]/,
  },
  {
    label: "join(process.env.HOME, '.openclaw')",
    regex: /join\s*\(\s*[^)]*process\.env\.HOME[^)]*['"`]\.openclaw['"`]/,
  },
]

const SCAN_DIRS = ['src', 'plugins', 'packages', 'cli', 'scripts', 'dev', 'tests']
const EXT_RE = /\.(ts|tsx|mjs|cjs|js)$/

function isAllowlisted(relPath) {
  return ALLOWLIST.some(a => relPath === a || relPath.startsWith(a + '/'))
}

function walk(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      walk(full, out)
    } else if (e.isFile() && EXT_RE.test(e.name)) {
      out.push(full)
    }
  }
  return out
}

function scanFile(absPath) {
  const rel = relative(ROOT, absPath)
  if (isAllowlisted(rel)) return []

  let src
  try {
    src = readFileSync(absPath, 'utf-8')
  } catch {
    return []
  }

  const hits = []
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Skip comment-only lines so we don't flag the explainer text that
    // documents why a guard exists.
    if (/^\s*(\/\/|\*|#)/.test(line)) continue
    for (const p of PATTERNS) {
      if (p.regex.test(line)) {
        hits.push({ rel, line: i + 1, label: p.label, text: line.trim() })
      }
    }
  }
  return hits
}

function main() {
  const allHits = []
  for (const dir of SCAN_DIRS) {
    const files = walk(join(ROOT, dir))
    for (const f of files) {
      allHits.push(...scanFile(f))
    }
  }

  if (allHits.length === 0) {
    console.log('OK: no ~/.bakin or ~/.openclaw bypasses found')
    process.exit(0)
  }

  console.error('ERROR: found direct ~/.bakin or ~/.openclaw path construction outside the allowlist:')
  console.error('')
  for (const h of allHits) {
    console.error(`  ${h.rel}:${h.line}`)
    console.error(`    ${h.label}`)
    console.error(`    ${h.text}`)
    console.error('')
  }
  console.error('Fix: resolve these paths via getContentDir()/getBakinPaths() from')
  console.error('packages/core/src/content-dir.ts, or getOpenClawHome()/getOpenClawPath()')
  console.error('from packages/adapter-openclaw/src/home.ts. See CLAUDE.md § OpenClaw Adapter')
  console.error('Principle and § Testing Rules.')
  process.exit(1)
}

main()
