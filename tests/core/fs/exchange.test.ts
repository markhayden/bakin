/** exchangePaths — atomic swap of two existing directories (darwin/linux). */
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { exchangePaths } from '../../../packages/core/src/fs/exchange'

const dir = join(tmpdir(), `bakin-test-exchange-${Date.now()}-${Math.random().toString(16).slice(2)}`)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('exchangePaths', () => {
  it('swaps two directories in one step on supported platforms', () => {
    mkdirSync(join(dir, 'live'), { recursive: true })
    mkdirSync(join(dir, 'staged'), { recursive: true })
    writeFileSync(join(dir, 'live', 'f'), 'old')
    writeFileSync(join(dir, 'staged', 'f'), 'new')
    const swapped = exchangePaths(join(dir, 'staged'), join(dir, 'live'))
    if (process.platform === 'darwin' || process.platform === 'linux') expect(swapped).toBe(true)
    if (swapped) {
      expect(readFileSync(join(dir, 'live', 'f'), 'utf-8')).toBe('new')
      expect(readFileSync(join(dir, 'staged', 'f'), 'utf-8')).toBe('old')
    }
  })

  it('throws when the call fails on a supported platform (a missing path)', () => {
    if (!(process.platform === 'darwin' || process.platform === 'linux')) return
    expect(() => exchangePaths(join(dir, 'nope-a'), join(dir, 'nope-b'))).toThrow(/atomic exchange/)
  })
})
