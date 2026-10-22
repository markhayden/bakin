/**
 * The SDK never imports application code except where a decision says so
 * (#809). `packages/sdk/src` may reach `src/` (via `@/` or a relative path) only
 * from the files below, each with the issue that retires the entry; anything
 * else is the sdk→app→sdk layer bounce this test exists to refuse. The
 * plugin-sourced hook re-exports in the hooks barrel are the one permanent
 * exception (P2 #5: a hook's wire contract lives with the plugin that owns the
 * route it fetches; the npm build inlines them and asserts self-containment).
 * Pure text scanner: imports no app module.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SDK = 'packages/sdk/src'

/** file → why it may still import app code (and what retires it). */
const ALLOWED: Record<string, string> = {
  'packages/sdk/src/hooks/index.ts': 'groups 1–3 of the hooks barrel; group 1 (src/hooks) moves into the SDK in #809b, groups 2–3 stay (P2 #5)',
  'packages/sdk/src/conversation/use-conversation-thread.ts': 'usePluginEvent from src/hooks — moves with #809b',
  'packages/sdk/src/conversation/use-conversation-attention.tsx': 'src/hooks + src/lib/browser-notify — move with #809b',
}

/** Paths #809a deleted; a facade or a re-creation fails here. */
const GONE = [
  'src/components/conversation',
  'src/components/drawer.tsx',
  'src/components/ui',
  'src/core/conversation-turns.ts',
  'src/core/tool-access.ts',
]

const APP_IMPORT = /^\s*(?:import|export)\b[^'"\n]*?from\s+['"]((?:@\/|(?:\.\.\/)+src\/)[^'"]*)['"]/gm

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.tsx?$/.test(name)) yield full
  }
}

describe('sdk → app boundary', () => {
  it('only the allowlisted SDK files import application code', () => {
    const offenders: string[] = []
    for (const file of walk(join(ROOT, SDK))) {
      const rel = relative(ROOT, file)
      if (rel in ALLOWED) continue
      const src = readFileSync(file, 'utf-8')
      for (const m of src.matchAll(APP_IMPORT)) {
        // `../src/` from inside packages/sdk/src never means the app; only `../../../../src/`-style escapes do.
        if (!m[1]!.startsWith('@/') && !/^(?:\.\.\/){4,}src\//.test(m[1]!)) continue
        offenders.push(`${rel}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every allowlisted file still exists and still needs its entry', () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(existsSync(join(ROOT, rel)), rel).toBe(true)
      const src = readFileSync(join(ROOT, rel), 'utf-8')
      expect([...src.matchAll(APP_IMPORT)].length, `${rel} no longer imports app code — remove its allowlist entry`).toBeGreaterThan(0)
    }
  })

  it('the paths #809a deleted stay deleted', () => {
    expect(GONE.filter((p) => existsSync(join(ROOT, p)))).toEqual([])
  })
})
