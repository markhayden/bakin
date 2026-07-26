/**
 * Architecture pin (#737): context readings NEVER derive from billing
 * data. run_costs/usage.db usage is SUMMED ACROSS a turn's internal
 * tool-loop requests (cache_read re-counts the same prefix per call), so
 * no arithmetic over spend rows yields a prompt snapshot — the 109%
 * incident (post-mortem: .claude/specs/chat-turn-usage.md D1). Context
 * comes from RUNTIME truth only (session files / session stores).
 *
 * Pure scanner — imports no app modules (the sanctioned mock-less shape
 * for tests/architecture/).
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..', '..')

const BILLING_SOURCES = /listRunCostsByPrefix|listRunCostsSince|recordRunCost|execution-ledger|execution\/ledger|run_costs|usage-history|usage\.db/

/** Every file implementing a contextStats source, discovered not listed —
 *  a new adapter's context-stats module joins the pin automatically. */
function contextStatsFiles(): string[] {
  const files: string[] = []
  const packagesDir = join(ROOT, 'packages')
  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory() || !pkg.name.startsWith('adapter-')) continue
    const src = join(packagesDir, pkg.name, 'src')
    if (!existsSync(src)) continue
    for (const file of readdirSync(src)) {
      if (file.includes('context-stats') && file.endsWith('.ts')) {
        files.push(join(src, file))
      }
    }
  }
  return files
}

describe('no billing-derived context (the 109% ban)', () => {
  it('context-stats implementations never import spend sources', () => {
    const files = contextStatsFiles()
    // Both adapters implement it today — an empty list means the scanner
    // went blind, not that the rule is satisfied.
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      // Strip comments — the ban is on CODE reaching billing data; the
      // files legitimately DOCUMENT the ban in prose.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(BILLING_SOURCES.test(code), `${file} reaches a billing source`).toBe(false)
      // Belt: the comment strip can be blinded by an unterminated /* inside
      // a string literal — raw import/require lines are scanned unstripped.
      const importLines = source.split('\n').filter((l) => /^\s*(import|export)\b.*from|require\(/.test(l))
      for (const line of importLines) {
        expect(BILLING_SOURCES.test(line), `${file} imports a billing source: ${line.trim()}`).toBe(false)
      }
    }
  })

  it('the openclaw implementation never reads trajectories (accumulated usage — the trap itself)', () => {
    const file = join(ROOT, 'packages', 'adapter-openclaw', 'src', 'context-stats.ts')
    const source = readFileSync(file, 'utf-8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(/trajectory/i.test(code), 'openclaw context-stats touches trajectory machinery').toBe(false)
  })

  it('the scanner has teeth', () => {
    expect(BILLING_SOURCES.test("import { listRunCostsByPrefix } from '../execution-ledger'")).toBe(true)
    expect(BILLING_SOURCES.test('const rows = db.query("SELECT * FROM run_costs")')).toBe(true)
  })
})
