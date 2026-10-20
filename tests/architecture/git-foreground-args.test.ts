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
// Bun's array form (`Bun.spawn(['git', ...])`) carries the vector inline: the
// rest of it must be `...gitArgs(...)`, nothing else (review r12 #3).
const ARRAY_GIT_SPAWN = /\b(?:Bun\.spawn|Bun\.spawnSync|spawn|spawnSync|execFile|execFileSync)\(\s*\[\s*['"]git['"]\s*,(?!\s*\.\.\.gitArgs\()/g
// Shell-string spawns cannot carry the vector at all.
const SHELL_GIT = /\b(?:execSync|exec)\(\s*[`'"]git\s/g
const PATTERNS = [RAW_GIT_SPAWN, ARRAY_GIT_SPAWN, SHELL_GIT]

/** Line numbers of every git spawn in `text` that does not carry `gitArgs`. */
function gitSpawnOffenders(text: string): number[] {
  const lines: number[] = []
  for (const re of PATTERNS) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) lines.push(text.slice(0, match.index).split('\n').length)
  }
  return lines.sort((a, b) => a - b)
}

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
        for (const line of gitSpawnOffenders(text)) offenders.push(`${relative(ROOT, file)}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the scanner has teeth for every spawn form: wrapped calls pass, unwrapped ones are named', () => {
    const wrapped = [
      "execFileSync('git', gitArgs(['fetch']), { cwd })",
      "spawn('git', gitArgs(['ls-remote', url]), opts)",
      "Bun.spawn(['git', ...gitArgs(['ls-remote', '--', url, ref])], { cwd })",
      "Bun.spawnSync(['git', ...gitArgs(['rev-parse', 'HEAD'])])",
      "spawn(['git', ...gitArgs(['status'])])",
    ].join('\n')
    expect(gitSpawnOffenders(wrapped)).toEqual([])
    const unwrapped = [
      "execFileSync('git', ['fetch'], { cwd })",
      "spawn('git',   ['ls-remote', url])",
      "Bun.spawn(['git', 'ls-remote', '--', url, ref], { cwd })",
      "Bun.spawnSync([ 'git', ...args ])",
      "spawn(['git', 'status'])",
      "execSync('git gc --auto')",
      "exec(`git fetch ${remote}`)",
    ].join('\n')
    expect(gitSpawnOffenders(unwrapped)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
