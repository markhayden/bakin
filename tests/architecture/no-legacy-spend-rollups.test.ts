/**
 * The legacy $0-fabricating ledger rollups are DELETED (work-class routing
 * pass): spendTotal/spendByAgent/spendByModel COALESCE'd unpriced rows to $0,
 * contradicting the NULL-honest engine. Every dollar figure must come from
 * assembleBudgetSpend facets or the NULL-honest rollupSpend browse helper.
 * This scanner keeps the verbs from quietly returning.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['src', 'plugins', 'packages', 'cli']
const BANNED = /\b(spendTotal|spendByAgent|spendByModel)\s*\(/

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx)$/.test(entry)) yield full
  }
}

describe('no legacy spend rollups', () => {
  it('no app code calls the deleted $0-fabricating ledger verbs', () => {
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(ROOT, root))) {
        const src = readFileSync(file, 'utf-8')
        if (BANNED.test(src)) offenders.push(relative(ROOT, file))
      }
    }
    expect(offenders).toEqual([])
  })
})
