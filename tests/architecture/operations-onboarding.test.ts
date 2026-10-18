/**
 * PR6 (#895 D11): every onboarding component install is an operation.
 *
 * - The local-operation wrappers the onboarding switch replaced
 *   (`installMediaStoreLocally`, `installSearchComponentLocally`) and the
 *   string `onProgress` callback never come back.
 * - Components report through the `op` they are handed: none of them starts
 *   a local operation of its own (`runOwning`/`runLocal`) — the component's
 *   operation owns its declared resources.
 * - Components never prompt: the caller resolves consent before anything
 *   starts, so neither the components nor the search adapter's installers
 *   reach for `askYesNo` or an `interactive` option.
 * - The onboarding install route is the web handler, and nothing auto-approves.
 *
 * Pure scanner: reads source as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['packages', 'plugins', 'src', 'cli', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor'])

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

const read = (file: string) => readFileSync(join(ROOT, file), 'utf-8')

/** Code only — comment lines dropped. */
const code = (text: string): string => text.split('\n').filter((line) => {
  const t = line.trim()
  return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))
}).join('\n')

const DELETED = [/\binstallMediaStoreLocally\b/, /\binstallSearchComponentLocally\b/, /core\/media-store-install\b/, /core\/search-setup-install\b/]

const ONBOARDING_DIR = 'src/core/onboarding'
/** The CLI's consent prompt lives here; it is the only onboarding module that may prompt. */
const PROMPTS = 'src/core/onboarding/prompts.ts'

describe('the onboarding switch (#895 PR6)', () => {
  it('no source names a deleted wrapper', () => {
    const hits: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const file of sourceFiles(join(ROOT, root))) {
        const text = code(readFileSync(file, 'utf-8'))
        for (const re of DELETED) if (re.test(text)) hits.push(`${relative(ROOT, file)}: ${re.source}`)
      }
    }
    expect(hits).toEqual([])
    expect(existsSync(join(ROOT, 'src/core/media-store-install.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/core/search-setup-install.ts'))).toBe(false)
  })

  it('components report through their op: no local operations, no onProgress, no prompts', () => {
    const hits: string[] = []
    for (const file of sourceFiles(join(ROOT, ONBOARDING_DIR))) {
      const rel = relative(ROOT, file)
      if (rel === PROMPTS) continue
      const text = code(readFileSync(file, 'utf-8'))
      if (/\brunOwning\b|\brunLocal\b/.test(text)) hits.push(`${rel}: starts its own operation`)
      if (/\bonProgress\b/.test(text)) hits.push(`${rel}: onProgress`)
      if (/\baskYesNo\b|\breadLine\b/.test(text)) hits.push(`${rel}: prompts`)
      if (/\binteractive\b/.test(text)) hits.push(`${rel}: an interactive option`)
    }
    expect(hits).toEqual([])
  })

  it("the search adapter's installers never prompt", () => {
    const hits: string[] = []
    for (const file of sourceFiles(join(ROOT, 'packages/adapter-antfly/src'))) {
      const text = code(readFileSync(file, 'utf-8'))
      if (/\baskYesNo\b|opts\.interactive\b/.test(text)) hits.push(relative(ROOT, file))
    }
    expect(code(read('packages/core/src/adapters/search/index.ts'))).not.toMatch(/\baskYesNo\b|\binteractive:/)
    expect(hits).toEqual([])
  })

  it('the install route is the web handler, and nothing auto-approves on the server', () => {
    const router = code(read('src/core/server/request-handler.ts'))
    expect(router).toMatch(/dispatchWebHandler\(req, res, onboardingRoute\.install\)/)
    expect(router).not.toMatch(/component\.install\(/)
    expect(code(read('packages/host/src/api/runtime/onboarding.ts'))).not.toMatch(/autoApprove:\s*true/)
  })
})
