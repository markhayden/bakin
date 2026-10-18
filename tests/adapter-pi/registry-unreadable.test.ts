/**
 * Pi's agent registry (#898 review r5): only a missing file is an empty
 * roster. One that exists but cannot be read (EACCES) fails loudly like a
 * corrupt one — an empty roster would read as "no agent workspaces" and let
 * an agent's `--as human` through (and would orphan every workspace).
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const piHome = mkdtempSync(join(tmpdir(), 'bakin-test-pi-registry-'))
process.env.PI_HOME = piHome

import { getPiRegistryPath, resetPiHome } from '../../packages/adapter-pi/src/home'
import { readRegistry } from '../../packages/adapter-pi/src/registry'

resetPiHome()
afterAll(() => rmSync(piHome, { recursive: true, force: true }))

describe('readRegistry', () => {
  it('a missing registry is an empty roster', () => {
    expect(readRegistry().agents).toEqual([])
  })

  it('a registry that cannot be read throws', () => {
    const path = getPiRegistryPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ version: 1, agents: [] }))
    chmodSync(dirname(path), 0o000)
    try {
      expect(() => readRegistry()).toThrow('registry unreadable')
    } finally {
      chmodSync(dirname(path), 0o755)
    }
  })
})
