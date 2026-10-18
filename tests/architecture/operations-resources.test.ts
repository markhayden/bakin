/**
 * Operation resource ownership (#895, D23): only the resource module creates
 * `install.lock` or lock files under `~/.bakin/locks/`. Everything else
 * acquires through `@bakin/core/operations`, so there is exactly one lock
 * algorithm and one ownership context.
 *
 * Scoped to OPERATION resources: antfly's own service lock
 * (`adapter-antfly/src/service-lock.ts`, `'wx'` under `~/.antfly`) is a
 * different lock by construction and is not matched.
 *
 * Pure scanner: reads source as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['packages', 'plugins', 'src', 'cli', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor'])
const OWNER = 'packages/core/src/operations/resources.ts'

/** String literals naming the install lock file or the operation locks directory. */
const LOCK_LITERAL = /(['"`])(?:[^'"`\n]*\/)?(?:install\.lock|locks)(?:\/[^'"`\n]*)?\1/

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

function codeLines(text: string): string[] {
  return text.split('\n').filter((line) => {
    const t = line.trim()
    return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))
  })
}

function offenders(): string[] {
  const out: string[] = []
  for (const root of SCAN_ROOTS) {
    for (const file of sourceFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file)
      if (rel === OWNER) continue
      for (const line of codeLines(readFileSync(file, 'utf-8'))) {
        if (LOCK_LITERAL.test(line)) out.push(`${rel}: ${line.trim()}`)
      }
    }
  }
  return out
}

describe('operation resources have one owner', () => {
  it('only resources.ts names install.lock or the locks directory', () => {
    expect(offenders()).toEqual([])
  })

  it('has teeth: the owner itself matches the pattern', () => {
    const owner = codeLines(readFileSync(join(ROOT, OWNER), 'utf-8'))
    expect(owner.filter((line) => LOCK_LITERAL.test(line)).length).toBeGreaterThanOrEqual(2)
    expect(LOCK_LITERAL.test(`join(getContentDir(), 'install.lock')`)).toBe(true)
    expect(LOCK_LITERAL.test(`join(home, 'locks', name)`)).toBe(true)
    expect(LOCK_LITERAL.test(`'~/.bakin/locks/media-store.lock'`)).toBe(true)
    expect(LOCK_LITERAL.test(`openSync(lockPath, 'wx')`)).toBe(false)
  })
})
