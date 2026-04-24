/**
 * Tests for the buildOnePlugin helper (scripts/dev-build-one-plugin.ts).
 *
 * The helper is a thin wrapper around two `bun build` subprocess spawns
 * (server-side index.ts, optional client-side client.tsx). This test
 * exercises both the happy path and the error path using a tiny
 * fixture tree — separate from tests/fixtures/sample-user-plugin/
 * (which covers buildUserPlugin, a different helper) — so failures here
 * point at this file and not the shared fixture.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('../../src/core/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-dev-buildone-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', async () => {
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const base = join(tmpdir(), 'bakin-test-dev-buildone-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})

import { buildOnePlugin } from '../../scripts/dev-build-one-plugin'

const EXTERNAL = [
  'react', 'react-dom', 'react-dom/client',
  'react/jsx-runtime', 'react/jsx-dev-runtime',
  '@tanstack/react-router',
  '@bakin/sdk', '@bakin/sdk/ui', '@bakin/sdk/hooks',
  '@bakin/sdk/components', '@bakin/sdk/slots',
  '@bakin/sdk/types', '@bakin/sdk/utils',
]

const testRoot = join(tmpdir(), `bakin-test-buildone-${Date.now()}`)
const pluginsDir = join(testRoot, 'plugins')

beforeAll(() => {
  mkdirSync(pluginsDir, { recursive: true })

  // Happy-path plugin: server + client entry.
  const okDir = join(pluginsDir, 'ok-plugin')
  mkdirSync(okDir, { recursive: true })
  writeFileSync(join(okDir, 'bakin-plugin.json'), JSON.stringify({ id: 'ok-plugin', name: 'OK', version: '0.0.1' }))
  writeFileSync(join(okDir, 'index.ts'), `
export default {
  id: 'ok-plugin',
  async activate() { /* no-op */ },
}
`)
  writeFileSync(join(okDir, 'client.tsx'), `
import { registerPlugin } from '@bakin/sdk'
registerPlugin({ id: 'ok-plugin', navItems: [] })
`)

  // Server-only plugin (no client.tsx) — hits the `if (existsSync(clientEntry))` false branch.
  const serverOnlyDir = join(pluginsDir, 'server-only')
  mkdirSync(serverOnlyDir, { recursive: true })
  writeFileSync(join(serverOnlyDir, 'index.ts'), `
export default {
  id: 'server-only',
  async activate() { /* no-op */ },
}
`)

  // Error-path plugin: server entry has a syntax error.
  const brokenDir = join(pluginsDir, 'broken')
  mkdirSync(brokenDir, { recursive: true })
  writeFileSync(join(brokenDir, 'index.ts'), `
this is not valid typescript {{{
`)
})

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

describe('buildOnePlugin — happy path', () => {
  it('builds server + client entries to plugins/<id>/dist/', async () => {
    const result = await buildOnePlugin('ok-plugin', {
      external: EXTERNAL,
      pluginsDir,
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(pluginsDir, 'ok-plugin', 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(pluginsDir, 'ok-plugin', 'dist', 'client.js'))).toBe(true)
  }, 60_000)

  it('builds just the server entry when client.tsx is absent', async () => {
    const result = await buildOnePlugin('server-only', {
      external: EXTERNAL,
      pluginsDir,
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(pluginsDir, 'server-only', 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(pluginsDir, 'server-only', 'dist', 'client.js'))).toBe(false)
  }, 60_000)
})

describe('buildOnePlugin — error path', () => {
  it('returns { ok: false, stderr } when the server entry fails to compile', async () => {
    const result = await buildOnePlugin('broken', {
      external: EXTERNAL,
      pluginsDir,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.stderr).toMatch(/server entry for broken/)
      expect(result.stderr.length).toBeGreaterThan(0)
    }
  }, 60_000)
})
