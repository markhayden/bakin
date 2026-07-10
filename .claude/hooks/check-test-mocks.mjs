#!/usr/bin/env node
// Bakin test-mock checker. Runs as a Claude Code PostToolUse hook on Write|Edit.
// For any file under tests/ matching *.test.{ts,tsx}, verifies:
//   1. Every relative mock-module path resolves to a real file. A typo makes
//      the call silently no-op and the real module gets imported, which has
//      previously leaked test data into ~/.bakin/ and ~/.openclaw/. Matches
//      both Bun's `mock.module(...)` and Vitest's `vi.mock(...)` so the
//      checker works through the Next.js → Bun migration and any future shift.
//   2. The test mocks src/core/content-dir (CLAUDE.md hard rule).
//   3. If the test touches workflows/tasks/openclaw, it also mocks task-store
//      and openclaw-home.
//
// Broken paths set decision: "block" so Claude re-edits.
// Missing required mocks emit a warning via additionalContext (no block).
//
// Manual run:  node .claude/hooks/check-test-mocks.mjs <path-to-test-file>

import { readFileSync, existsSync, statSync } from 'fs'
import { resolve, dirname } from 'path'

function readStdin() {
  try {
    return readFileSync(0, 'utf-8')
  } catch {
    return ''
  }
}

function isTestFile(p) {
  return /\/tests\/.+\.test\.tsx?$/.test(p)
}

function isPureArchitectureTest(p) {
  return /(^|\/)tests\/architecture\/.+\.test\.tsx?$/.test(p)
}

// tests/sdk-testing/ holds external-author acceptance fixtures for
// @makinbakin/sdk/testing. They deliberately import ONLY the published SDK
// surface (no repo-internal modules to mock) — isolation comes from the
// harness itself, which roots ctx.storage in a per-test temp dir. Requiring
// content-dir mocks here would invalidate exactly what the fixtures prove.
function isSdkTestingFixture(p) {
  return /(^|\/)tests\/sdk-testing\/.+\.test\.tsx?$/.test(p)
}

// Matches both `mock.module('...', ...)` (Bun) and `vi.mock('...', ...)` (Vitest).
const MOCK_RE = /(?:vi\.mock|mock\.module)\(\s*['"]([^'"]+)['"]/g

function extractMockPaths(src) {
  const out = []
  for (const m of src.matchAll(MOCK_RE)) out.push(m[1])
  return out
}

function resolveRelativeMock(testFile, mockArg) {
  // Only resolve relative paths. Aliases like @/core/foo or @bakin/... need
  // tsconfig resolution we don't replicate here — skip them.
  if (!mockArg.startsWith('.')) return { skipped: true }
  const baseDir = dirname(testFile)
  const exts = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']
  const tried = []
  for (const ext of exts) {
    const abs = resolve(baseDir, mockArg + ext)
    tried.push(abs)
    if (existsSync(abs) && statSync(abs).isFile()) {
      return { resolved: abs }
    }
  }
  return { broken: true, tried }
}

// REQUIRED_PATTERNS run against the *string argument* of vi.mock(...) calls,
// so they need to match both relative paths ('../../../src/core/content-dir')
// and aliases ('@/core/content-dir', '@bakin/adapter-openclaw/home').
const REQUIRED_PATTERNS = [
  {
    label: 'src/core/content-dir (or packages/core/src/content-dir)',
    matches: (p) =>
      /(^|\/)src\/core\/content-dir$/.test(p)
      || /(^|\/)packages\/core\/src\/content-dir$/.test(p)
      || /@\/core\/content-dir$/.test(p)
      || /@bakin\/core\/content-dir$/.test(p),
    always: true,
  },
  {
    label: 'src/core/task-store',
    matches: (p) =>
      /(^|\/)src\/core\/task-store$/.test(p)
      || /@\/core\/task-store$/.test(p),
    requiredIf: (src) =>
      /task-store|@bakin\/workflows|plugins\/(tasks|workflows)/.test(src),
  },
  {
    label: 'openclaw-home resolver (packages/adapter-openclaw/src/home or @bakin/adapter-openclaw/home)',
    matches: (p) =>
      /(^|\/)packages\/adapter-openclaw\/src\/home$/.test(p)
      || /@bakin\/adapter-openclaw\/home$/.test(p),
    requiredIf: (src) =>
      /openclaw-home|getOpenClawPath|getOpenClawHome|@bakin\/adapter-openclaw\/home/.test(src),
  },
  {
    label: 'src/core/openclaw-client',
    matches: (p) => /(^|\/)src\/core\/openclaw-client$/.test(p) || /@\/core\/openclaw-client$/.test(p),
    requiredIf: (src) => /openclaw-client|sendToAgent|openClawClient/.test(src),
  },
]

// Self-test exception: a file like tests/core/openclaw-home.test.ts IS the
// test for the openclaw-home module, so it can't mock the module under test.
// We detect this by matching the test file's basename against each pattern's
// label keywords and skip the requirement.
function isSelfTest(filePath, patternLabel) {
  const base = filePath.replace(/.*\/tests\//, '').replace(/\.test\.tsx?$/, '')
  // e.g. 'core/openclaw-home' → slug 'openclaw-home'
  const slug = base.split('/').pop()
  if (!slug) return false
  // Label contains the slug as a path segment (e.g. 'openclaw-home' in the label)
  if (patternLabel.includes(slug)) return true
  // tests/core/leak-guard.test.ts is the regression test for both guards;
  // it intentionally imports the real modules to verify they throw.
  if (slug === 'leak-guard' && (patternLabel.includes('content-dir') || patternLabel.includes('openclaw-home'))) return true
  return false
}

function check(filePath) {
  let src
  try {
    src = readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }

  const mockPaths = extractMockPaths(src)

  const broken = []
  for (const mp of mockPaths) {
    const r = resolveRelativeMock(filePath, mp)
    if (r.broken) broken.push({ arg: mp, tried: r.tried })
  }

  const missing = []
  if (!isPureArchitectureTest(filePath) && !isSdkTestingFixture(filePath)) {
    for (const req of REQUIRED_PATTERNS) {
      const found = mockPaths.some(req.matches)
      if (found) continue
      if (isSelfTest(filePath, req.label)) continue
      if (req.always) {
        missing.push(req.label)
      } else if (req.requiredIf && req.requiredIf(src)) {
        missing.push(`${req.label} (referenced in this test file)`)
      }
    }
  }

  return { broken, missing, mockPaths }
}

function formatReport(filePath, result) {
  const lines = [`Test mock check failed for ${filePath}`, '']

  if (result.broken.length > 0) {
    lines.push('BROKEN vi.mock paths (path does not resolve to a real file):')
    for (const b of result.broken) {
      lines.push(`  - "${b.arg}"`)
      lines.push(`    tried: ${b.tried.slice(0, 3).join(', ')}${b.tried.length > 3 ? ', ...' : ''}`)
    }
    lines.push('')
    lines.push(
      'A vi.mock() with a path that does not resolve silently no-ops — the real '
      + 'module gets imported, which has previously leaked test data into ~/.bakin/ '
      + 'and ~/.openclaw/. Fix the path so it resolves to a real source file.'
    )
    lines.push('')
  }

  if (result.missing.length > 0) {
    lines.push('MISSING required mocks (per CLAUDE.md test isolation rules):')
    for (const m of result.missing) lines.push(`  - ${m}`)
    lines.push('')
    lines.push(
      'Every test that touches storage, plugins, or workflows MUST mock these '
      + 'modules so it cannot accidentally write to ~/.bakin/ or ~/.openclaw/.'
    )
  }

  return lines.join('\n')
}

function main() {
  // CLI mode: file path as argv
  const cliPath = process.argv[2]
  if (cliPath) {
    const result = check(cliPath)
    if (!result) {
      console.error(`could not read ${cliPath}`)
      process.exit(1)
    }
    if (result.broken.length === 0 && result.missing.length === 0) {
      console.log(`OK: ${cliPath}`)
      process.exit(0)
    }
    console.error(formatReport(cliPath, result))
    process.exit(result.broken.length > 0 ? 2 : 1)
  }

  // Hook mode: stdin JSON from Claude Code
  const raw = readStdin()
  if (!raw) process.exit(0)

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const filePath = payload?.tool_response?.filePath || payload?.tool_input?.file_path || ''
  if (!filePath || !isTestFile(filePath)) process.exit(0)

  const result = check(filePath)
  if (!result) process.exit(0)
  if (result.broken.length === 0 && result.missing.length === 0) process.exit(0)

  const output = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: formatReport(filePath, result),
    },
  }
  if (result.broken.length > 0) {
    output.decision = 'block'
    output.reason = `${result.broken.length} broken vi.mock path(s) in ${filePath}`
  }
  process.stdout.write(JSON.stringify(output))
  process.exit(0)
}

main()
