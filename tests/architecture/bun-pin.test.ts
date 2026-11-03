/**
 * The bun pin lives in three places that must move together (#965):
 *   - `.bun-version` (read by every CI job and by the dev rig's image build)
 *   - `src/core/whiskit/bun-pin.ts` `MANAGED_BUN_VERSION` (the bun Bakin
 *     installs for itself on a box without one — its sha256s are regenerated
 *     by the loop in that file's header; not asserted here, that needs the
 *     network)
 *   - the RESOLVED `@types/bun` / `bun-types` in `bun.lock` (the range in
 *     package.json is not what is checked — the lock is; the types ride the
 *     runtime's `major.minor` line)
 * Pure text scanner: imports no app module.
 */
import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8')
const minor = (v: string) => v.split('.').slice(0, 2).join('.')

describe('bun pin', () => {
  const pin = read('.bun-version').trim()

  it('.bun-version is an exact release', () => {
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('MANAGED_BUN_VERSION tracks .bun-version', () => {
    const m = read('src/core/whiskit/bun-pin.ts').match(/export const MANAGED_BUN_VERSION = '([^']+)'/)
    expect(m?.[1]).toBe(pin)
  })

  it('the lock resolves @types/bun and bun-types on the pin\'s minor line', () => {
    const lock = read('bun.lock')
    for (const pkg of ['@types/bun', 'bun-types']) {
      const m = lock.match(new RegExp(`"${pkg}": \\["${pkg.replace('/', '\\/')}@(\\d+\\.\\d+\\.\\d+)"`))
      expect(m?.[1], `${pkg} resolved version in bun.lock`).toBeDefined()
      expect(minor(m![1]!)).toBe(minor(pin))
    }
  })
})
