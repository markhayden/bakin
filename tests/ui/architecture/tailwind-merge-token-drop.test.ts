import { describe, expect, it } from 'bun:test'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { cn } from '@bakin/ui/utils'

const REPO_ROOT = resolve(import.meta.dir, '../../..')

/**
 * A font size and a text colour are BOTH `text-*` utilities, so tailwind-merge
 * treats them as one group and keeps only the last one it sees. Passing
 * `text-bakin-typography-size-meta` and `text-bakin-text-muted` through `cn()`
 * therefore drops the size silently — the markup looks correct, the class list
 * looks plausible, and the element just renders at the inherited size.
 *
 * This is the same failure shape as `off-scale-utilities`: a style that
 * disappears without any error. It shipped once — WorkspacePage's compact
 * sticky title rendered at the wrong size until the Text primitive work found
 * it — so it is pinned here.
 *
 * The fix inside kit components is the arbitrary-length form,
 * `text-[length:var(--bakin-typography-size-meta)]`, which lands in the
 * font-size group and survives. Plugin files keep the readable shorthand and
 * reach for the `Text` primitive instead, which is why it exists.
 *
 * Note this cannot live in the legacy-styles ratchet: that scanner does not
 * cover `packages/ui/src` at all, which is part of why the bug went unnoticed.
 */
const ROOTS = [
  'packages/ui/src',
  'packages/sdk/src',
  'packages/host/src',
  'plugins',
  'src',
  'storybook/public',
]

const SIZE_TOKEN = /text-bakin-typography-size-[a-z-]+/
const COLOUR_TOKEN = /text-bakin-(?:text|signal|action)-[a-z-]+/

/**
 * Only strings that actually reach tailwind-merge can be damaged by it. A
 * ternary branch assigned straight to `className` keeps both utilities and is
 * perfectly fine, so enclosure in a `cn(` call is the thing to detect — not
 * merely being a quoted string that happens to contain the tokens.
 */
function classStringsInsideCn(source: string): Array<{ offset: number, classes: string }> {
  const found: Array<{ offset: number, classes: string }> = []
  for (const call of source.matchAll(/\bcn\(/g)) {
    let depth = 1
    let index = call.index! + call[0].length
    let quote: string | null = null
    let literalStart = -1
    const pending: Array<{ offset: number, classes: string }> = []
    while (index < source.length && depth > 0) {
      const char = source[index]!
      if (quote !== null) {
        if (char === '\\') index += 1
        else if (char === quote) {
          pending.push({ offset: literalStart, classes: source.slice(literalStart, index) })
          quote = null
        }
      } else if (char === "'" || char === '"' || char === '`') {
        quote = char
        literalStart = index + 1
      } else if (char === '(') depth += 1
      else if (char === ')') depth -= 1
      index += 1
    }
    // Only trust a call we actually saw close. A `cn(` inside a comment or a
    // string never balances, and an unbounded walk would otherwise hoover up
    // every literal to end-of-file and report plain className="…" attributes.
    if (depth === 0) found.push(...pending)
  }
  return found
}

function findDroppedSizeTokens(): string[] {
  const offenders: string[] = []
  const cmd = `grep -rln "text-bakin-typography-size-" ${ROOTS.join(' ')} `
    + `--include='*.tsx' --include='*.ts' || true`
  const files = execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
  if (!files) return offenders

  for (const file of files.split('\n')) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8')
    if (!source.includes('cn(')) continue
    for (const { offset, classes } of classStringsInsideCn(source)) {
      if (!SIZE_TOKEN.test(classes) || !COLOUR_TOKEN.test(classes)) continue
      // The authority is tailwind-merge itself, not a guess about its rules.
      if (SIZE_TOKEN.test(cn(classes))) continue
      const line = source.slice(0, offset).split('\n').length
      offenders.push(`${file}:${line}: ${classes}`)
    }
  }
  return offenders
}

describe('tailwind-merge token drop', () => {
  it('never lets a colour utility swallow a font-size token', () => {
    const offenders = findDroppedSizeTokens()
    expect(offenders).toEqual([])
  })

  it('proves the hazard is real, so the scan above is not vacuous', () => {
    // The shorthand pairing loses its size...
    expect(cn('text-bakin-typography-size-meta text-bakin-text-muted'))
      .not.toMatch(SIZE_TOKEN)
    // ...and the arbitrary-length form the kit uses survives it.
    expect(cn('text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted'))
      .toContain('--bakin-typography-size-meta')
  })
})
