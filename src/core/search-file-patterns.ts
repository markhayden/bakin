/**
 * Glob matching for file-backed content-type patterns (watcher sync/unlink
 * scoping). Minimal subset sufficient for filePatterns:
 *   `**`     → match any path segments (including none)
 *   `*`      → match any non-slash run
 *   `{a,b}`  → alternation
 *   literal segments and dots
 */
import { sep } from 'path'
import type { FilePatternMapper } from '../../packages/core/src/plugin-types'

export function globToRegex(pattern: string): RegExp {
  let re = ''
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` consumes any number of segments (including zero)
        if (pattern[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 3
          continue
        }
        re += '.*'
        i += 2
        continue
      }
      re += '[^/]*'
      i += 1
      continue
    }
    if (ch === '{') {
      const close = pattern.indexOf('}', i)
      if (close === -1) {
        re += '\\{'
        i += 1
        continue
      }
      const alts = pattern.slice(i + 1, close).split(',').map(a => a.replace(/[.+^$()|[\]\\]/g, '\\$&'))
      re += `(?:${alts.join('|')})`
      i = close + 1
      continue
    }
    if (ch === '.' || ch === '+' || ch === '^' || ch === '$' || ch === '(' || ch === ')' || ch === '|' || ch === '[' || ch === ']' || ch === '\\') {
      re += '\\' + ch
      i += 1
      continue
    }
    re += ch
    i += 1
  }
  return new RegExp('^' + re + '$')
}

export function matchesAnyPattern(rel: string, patterns: string[]): boolean {
  const normalized = rel.split(sep).join('/')
  for (const p of patterns) {
    if (globToRegex(p).test(normalized)) return true
  }
  return false
}

export function findMatchingMapper(
  rel: string,
  mappers: FilePatternMapper[],
): FilePatternMapper | undefined {
  const normalized = rel.split(sep).join('/')
  for (const m of mappers) {
    if (globToRegex(m.pattern).test(normalized)) return m
  }
  return undefined
}
