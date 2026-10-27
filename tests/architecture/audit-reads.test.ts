/**
 * No whole-file reads of the audit log outside core.
 *
 * audit.jsonl is append-only and unbounded (30k+ lines / 7+ MB on a lived-in
 * install). Request paths that `readFileSync` it per call made every page
 * load pay for the whole history (the Margo perf incident, 2026-10-26). The
 * sanctioned reader is `queryAuditEvents` in src/core/audit.ts — bounded
 * tail reads for windowed/limited queries.
 *
 * Pure scanner: imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['src', 'plugins', 'packages', 'cli', 'server.ts']
const EXT_RE = /\.(ts|tsx|mts|js|jsx)$/
const SKIP_DIR = new Set(['node_modules', 'dist', 'tests', 'test', '__tests__'])

/** Files allowed to read the audit log in bulk — each with its reason. */
const ALLOWLIST: Record<string, string> = {
  'src/core/audit.ts': 'the owner: queryAuditEvents and its bounded tail reader',
  'plugins/team/lib/agent-status.ts': 'reads only the last 64 KB (fd tail read) for per-agent last-activity',
  'plugins/memory/lib/indexer.ts': 'offset-incremental indexer: exhaustive by design, reads only bytes past the persisted offset',
}

const READ_CALL_RE = /\b(readFileSync|readFile|createReadStream|Bun\.file)\(/g
const BUN_FILE_READ_RE = /^\s*\.(?:text|json|arrayBuffer|bytes|stream)\b/
const AUDIT_EXPR_RE = /audit\.jsonl|getBakinPaths\(\)\.audit\b|paths\.audit\b/

/** Identifiers bound to an audit-log path in this source. */
function auditPathIdentifiers(source: string): Set<string> {
  const names = new Set<string>()
  for (const m of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^\n;]+)/g)) {
    if (AUDIT_EXPR_RE.test(m[2]!)) names.add(m[1]!)
  }
  for (const m of source.matchAll(/\{([^}]*)\}\s*=\s*getBakinPaths\(\)/g)) {
    for (const part of m[1]!.split(',')) {
      const [key, alias] = part.split(':').map((p) => p.trim())
      if (key === 'audit') names.add(alias || 'audit')
    }
  }
  return names
}

/** The first call argument starting at `from` (just past `(`), and the index after the call's `)`. */
function firstArgument(source: string, from: number): { arg: string; end: number } {
  let depth = 0
  let argEnd = -1
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return { arg: source.slice(from, argEnd === -1 ? i : argEnd).trim(), end: i + 1 }
      depth--
    } else if (ch === ',' && depth === 0 && argEnd === -1) argEnd = i
  }
  return { arg: source.slice(from).trim(), end: source.length }
}

/** Whole-file audit reads in one source text, as `line: call`. */
export function findWholeFileAuditReads(source: string): string[] {
  const ids = auditPathIdentifiers(source)
  const hits: string[] = []
  for (const m of source.matchAll(READ_CALL_RE)) {
    const { arg, end } = firstArgument(source, m.index! + m[0].length)
    // Bun.file(p) is only a handle; it reads when chained with .text() etc.
    if (m[1] === 'Bun.file' && !BUN_FILE_READ_RE.test(source.slice(end))) continue
    if (AUDIT_EXPR_RE.test(arg) || ids.has(arg)) {
      const line = source.slice(0, m.index).split('\n').length
      hits.push(`${line}: ${m[1]}(${arg})`)
    }
  }
  return hits
}

function walk(path: string, out: string[]): void {
  const stat = statSync(path)
  if (stat.isFile()) {
    if (EXT_RE.test(path)) out.push(path)
    return
  }
  for (const entry of readdirSync(path)) {
    if (SKIP_DIR.has(entry) || entry.startsWith('.')) continue
    walk(join(path, entry), out)
  }
}

describe('audit log reads', () => {
  it('no file outside the allowlist reads audit.jsonl whole', () => {
    const files: string[] = []
    for (const root of SCAN_ROOTS) walk(join(ROOT, root), files)
    const violations: string[] = []
    for (const file of files) {
      const rel = relative(ROOT, file)
      if (ALLOWLIST[rel] || /\.test\.tsx?$/.test(rel)) continue
      for (const hit of findWholeFileAuditReads(readFileSync(file, 'utf-8'))) violations.push(`${rel}:${hit}`)
    }
    expect(violations).toEqual([])
  })

  it('every allowlisted file still exists (no stale exemptions)', () => {
    for (const rel of Object.keys(ALLOWLIST)) expect(statSync(join(ROOT, rel)).isFile()).toBe(true)
  })
})

describe('audit-read scanner teeth', () => {
  it('flags an inline literal path', () => {
    expect(findWholeFileAuditReads(`const raw = readFileSync(join(dir, 'audit.jsonl'), 'utf-8')`)).toHaveLength(1)
  })

  it('flags a path variable bound to the literal', () => {
    expect(findWholeFileAuditReads(`const AUDIT_PATH = join(getContentDir(), 'audit.jsonl')\nconst raw = readFileSync(AUDIT_PATH, 'utf-8')`)).toHaveLength(1)
  })

  it('flags getBakinPaths().audit, directly and destructured', () => {
    expect(findWholeFileAuditReads(`readFileSync(getBakinPaths().audit, 'utf-8')`)).toHaveLength(1)
    expect(findWholeFileAuditReads(`const { home, audit: auditPath } = getBakinPaths()\nreadFileSync(auditPath, 'utf-8')`)).toHaveLength(1)
  })

  it('flags Bun.file(...).text() on the audit log', () => {
    expect(findWholeFileAuditReads(`const p = getBakinPaths().audit\nawait Bun.file(p).text()`)).toHaveLength(1)
  })

  it('ignores reads of other files and non-read uses of the audit path', () => {
    expect(findWholeFileAuditReads(`const p = join(dir, 'audit.jsonl')\nexistsSync(p)\nreadFileSync(join(dir, 'settings.json'), 'utf-8')`)).toEqual([])
  })
})
