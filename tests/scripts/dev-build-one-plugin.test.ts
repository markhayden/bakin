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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

mock.module('../../src/core/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
  const base = join(tmpdir(), 'bakin-test-dev-buildone-noop')
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base }),
  }
})
mock.module('../../packages/core/src/content-dir', () => {
  const { join } = require('path') as typeof import('path')
  const { tmpdir } = require('os') as typeof import('os')
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
  '@makinbakin/sdk', '@makinbakin/sdk/ui', '@makinbakin/sdk/hooks',
  '@makinbakin/sdk/slots',
  '@makinbakin/sdk/types', '@makinbakin/sdk/utils',
  '@makinbakin/sdk/metadata', '@makinbakin/sdk/routing',
  '@makinbakin/sdk', '@makinbakin/sdk/ui', '@makinbakin/sdk/hooks',
  '@makinbakin/sdk/slots',
  '@makinbakin/sdk/types', '@makinbakin/sdk/utils',
  '@makinbakin/sdk/metadata', '@makinbakin/sdk/routing',
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
import './domain.css'
import { registerPlugin } from '@makinbakin/sdk'
const Badge = () => <span>OK</span>
void Badge
registerPlugin({ id: 'ok-plugin', navItems: [] })
`)
  writeFileSync(join(okDir, 'domain.css'), '.card{display:grid}\n')

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

  const unsafeCssDir = join(pluginsDir, 'unsafe-css')
  mkdirSync(unsafeCssDir, { recursive: true })
  writeFileSync(join(unsafeCssDir, 'index.ts'), 'export default { id: "unsafe-css", activate() {} }\n')
  writeFileSync(join(unsafeCssDir, 'client.tsx'), "import './domain.css'\n")
  writeFileSync(join(unsafeCssDir, 'domain.css'), 'body .card{display:grid}\n')
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

  it('serverEntry: false skips the server bundle and builds only client assets (#421)', async () => {
    const result = await buildOnePlugin('ok-plugin', {
      external: EXTERNAL,
      pluginsDir,
      serverEntry: false,
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(pluginsDir, 'ok-plugin', 'dist', 'index.js'))).toBe(false)
    expect(existsSync(join(pluginsDir, 'ok-plugin', 'dist', 'client.js'))).toBe(true)
  }, 60_000)

  it('serverEntry: false on a client-less plugin produces an empty dist (git/images shape)', async () => {
    const result = await buildOnePlugin('server-only', {
      external: EXTERNAL,
      pluginsDir,
      serverEntry: false,
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(pluginsDir, 'server-only', 'dist', 'index.js'))).toBe(false)
    expect(existsSync(join(pluginsDir, 'server-only', 'dist', 'client.js'))).toBe(false)
  }, 60_000)

  it('builds production client entries without JSX dev runtime output', async () => {
    const result = await buildOnePlugin('ok-plugin', {
      external: EXTERNAL,
      pluginsDir,
      production: true,
    })
    expect(result.ok).toBe(true)
    const client = readFileSync(join(pluginsDir, 'ok-plugin', 'dist', 'client.js'), 'utf-8')
    expect(client).not.toContain('jsxDEV')
    expect(client).not.toContain('react/jsx-dev-runtime')
  }, 60_000)

  it('scopes emitted client CSS to the plugin owner', async () => {
    const result = await buildOnePlugin('ok-plugin', {
      external: EXTERNAL,
      pluginsDir,
    })
    expect(result.ok).toBe(true)
    expect(readFileSync(join(pluginsDir, 'ok-plugin', 'dist', 'client.css'), 'utf-8')).toContain(
      ':where([data-bakin-plugin="ok-plugin"]) .card',
    )
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

  it('returns an actionable failure and removes unsafe client CSS', async () => {
    const result = await buildOnePlugin('unsafe-css', {
      external: EXTERNAL,
      pluginsDir,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.stderr).toContain('domain.css:1:1')
      expect(result.stderr).toContain('document selector "body"')
    }
    expect(existsSync(join(pluginsDir, 'unsafe-css', 'dist', 'client.css'))).toBe(false)
    expect(existsSync(join(pluginsDir, 'unsafe-css', 'dist', 'client.js'))).toBe(false)
  }, 60_000)
})
