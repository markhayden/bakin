/**
 * Every binary replacement enters the self-update OPERATION (#1007 D7.11):
 * `selfUpdate(` is called from exactly one place — the operation — which
 * both the server's apply route and the in-process `bakin update` run.
 * The old `/api/update/apply` handler is gone; a new direct caller is a
 * reviewed change to this list. Pure scanner: no app imports.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const ROOTS = ['src', 'packages/host/src', 'packages/core/src', 'cli', 'plugins']
const CALLERS = ['src/core/updates/self-update-operation.ts']
const DEFINITION = 'src/core/self-update.ts'

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* files(full)
    else if (/\.(ts|tsx)$/.test(name)) yield full
  }
}

describe('self-update callers', () => {
  it('selfUpdate( is called only by the self-update operation', () => {
    const callers: string[] = []
    for (const root of ROOTS) {
      for (const file of files(join(ROOT, root))) {
        const rel = relative(ROOT, file)
        if (rel === DEFINITION) continue
        const source = readFileSync(file, 'utf-8')
        if (/\bselfUpdate\(/.test(source)) callers.push(rel)
      }
    }
    expect(callers.sort()).toEqual(CALLERS)
  })

  it('the old self-update routes are gone', () => {
    const router = readFileSync(join(ROOT, 'src/core/server/request-handler.ts'), 'utf-8')
    expect(router).not.toContain('/api/update/apply')
    expect(router).not.toContain('/api/update/status')
    expect(() => statSync(join(ROOT, 'packages/host/src/api/update'))).toThrow()
  })
})
