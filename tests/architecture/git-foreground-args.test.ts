/**
 * Every git Bakin spawns goes through `gitArgs` (#978): automatic gc and
 * background maintenance are off, so no git process outlives its command
 * inside a directory the caller is about to rename or delete. Pure scanner —
 * imports no app modules.
 */
import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(import.meta.dir, '..', '..')
// Runtime code only: `scripts/` is repo tooling that runs inside this
// checkout (version stamping, UI baselines), never in a directory Bakin
// renames or deletes.
const SCAN_ROOTS = ['src', 'packages', 'plugins', 'cli'].map((dir) => join(ROOT, dir))
const SKIP_DIRS = new Set(['node_modules', 'dist', 'storybook-static-public'])

// A git child process started with the literal program name — the ONLY way
// Bakin may start one is with `gitArgs(...)` as the argument vector. The
// lookahead sits right after the comma so whitespace cannot backtrack past it.
const RAW_GIT_SPAWN = /\b(?:execFileSync|execFile|execFileAsync|spawn|spawnSync)\(\s*['"]git['"]\s*,(?!\s*gitArgs\()/g
// Shell-string spawns cannot carry the vector at all.
const SHELL_GIT = /\b(?:execSync|exec)\(\s*[`'"]git\s/g

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { yield* sourceFiles(path); continue }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue
    yield path
  }
}

describe('git spawns carry the foreground-only config', () => {
  it('no production file starts git without gitArgs', () => {
    const offenders: string[] = []
    for (const root of SCAN_ROOTS) {
      if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) continue
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf-8')
        for (const re of [RAW_GIT_SPAWN, SHELL_GIT]) {
          re.lastIndex = 0
          let match: RegExpExecArray | null
          while ((match = re.exec(text)) !== null) {
            const line = text.slice(0, match.index).split('\n').length
            offenders.push(`${relative(ROOT, file)}:${line}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
