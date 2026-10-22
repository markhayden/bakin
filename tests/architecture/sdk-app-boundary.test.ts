/**
 * The SDK never imports application code except where a decision says so
 * (#809). `packages/sdk/src` may reach the repo's root `src/` only from the
 * files below, each with the issue that retires its entry; anything else is
 * the sdk→app→sdk layer bounce this test exists to refuse. The plugin-sourced
 * hook re-exports in the hooks barrel are the one permanent exception (P2 #5:
 * a hook's wire contract lives with the plugin that owns the route it
 * fetches; the npm build inlines them and asserts self-containment).
 *
 * Every module reference counts — `import … from`, `export … from` (multiline
 * too), side-effect `import '…'`, and dynamic `import('…')` — and a relative
 * specifier is resolved against the importing file, so `../../../src/foo`
 * from a file directly under packages/sdk/src is caught the same as
 * `@/foo`. Pure text scanner: imports no app module.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

const ROOT = process.cwd()
const SDK = 'packages/sdk/src'
const APP_ROOT = join(ROOT, 'src')

/** file → why it may still import app code (and what retires it). */
const ALLOWED: Record<string, string> = {
  'packages/sdk/src/hooks/index.ts': 'groups 1–3 of the hooks barrel; group 1 (src/hooks) moves into the SDK in #809b, groups 2–3 stay (P2 #5)',
  'packages/sdk/src/conversation/use-conversation-thread.ts': 'usePluginEvent from src/hooks — moves with #809b',
  'packages/sdk/src/conversation/use-conversation-attention.tsx': 'src/hooks — move with #809b',
}

/** Paths #809a deleted; a facade or a re-creation fails here. */
const GONE = [
  'src/components/conversation',
  'src/components/drawer.tsx',
  'src/components/ui',
  'src/core/conversation-turns.ts',
  'src/core/tool-access.ts',
]

/** Every module specifier a source file references, in any import/export form. */
const SPECIFIER = /\b(?:from\s*|import\s*\(?\s*)['"]([^'"\n]+)['"]/g

export function moduleSpecifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]!)
}

/** The specifiers of `file` (absolute path) that land in the repo's root `src/`. */
export function appImportsOf(file: string, source: string, appRoot = APP_ROOT): string[] {
  const hits: string[] = []
  for (const spec of moduleSpecifiers(source)) {
    if (spec.startsWith('@/')) { hits.push(spec); continue }
    if (!spec.startsWith('.')) continue
    const target = resolve(dirname(file), spec)
    if (target === appRoot || target.startsWith(appRoot + '/')) hits.push(spec)
  }
  return hits
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(name)) yield full
  }
}

describe('sdk → app boundary', () => {
  it('only the allowlisted SDK files reference application code', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, SDK))) {
      const rel = relative(ROOT, file)
      if (rel in ALLOWED) continue
      for (const spec of appImportsOf(file, readFileSync(file, 'utf-8'))) offenders.push(`${rel}: ${spec}`)
    }
    expect(offenders).toEqual([])
  })

  it('every allowlisted file still exists and still needs its entry', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const file = join(ROOT, rel)
      expect(existsSync(file), rel).toBe(true)
      expect(appImportsOf(file, readFileSync(file, 'utf-8')).length, `${rel} no longer references app code — remove its allowlist entry`).toBeGreaterThan(0)
    }
  })

  it('the paths #809a deleted stay deleted', () => {
    expect(GONE.filter((p) => existsSync(join(ROOT, p)))).toEqual([])
  })

  describe('the predicate', () => {
    // packages/sdk/src/deep/dir/ is five levels below the repo root.
    const file = join(ROOT, 'packages/sdk/src/deep/dir/module.ts')
    it('sees every import form and resolves relative specifiers against the importing file', () => {
      const source = [
        "import { a } from '@/hooks/use-a'",
        "import {\n  b,\n  c,\n} from '../../../../../src/lib/b'",
        "export {\n  d,\n} from '../../../../../src/lib/d'",
        "import '../../../../../src/side-effect'",
        "const lazy = await import('../../../../../src/core/lazy')",
        "import { ok } from '../../types'",
        "import { peer } from '@bakin/ui'",
        "import { near } from './src/not-the-app'",
      ].join('\n')
      expect(appImportsOf(file, source)).toEqual([
        '@/hooks/use-a',
        '../../../../../src/lib/b',
        '../../../../../src/lib/d',
        '../../../../../src/side-effect',
        '../../../../../src/core/lazy',
      ])
    })
    it('a shallower file reaches the app with fewer ../ and is caught the same', () => {
      const shallow = join(ROOT, 'packages/sdk/src/module.ts')
      expect(appImportsOf(shallow, "import { x } from '../../../src/x'")).toEqual(['../../../src/x'])
      expect(appImportsOf(shallow, "import { y } from '../../ui/src/y'")).toEqual([])
    })
  })
})
