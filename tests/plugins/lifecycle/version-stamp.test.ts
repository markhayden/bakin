/**
 * Coverage for src/core/plugin-host/version-stamp.ts (Phase 2 P2.C5).
 *
 * The module is small and side-effect-free other than its globalThis-
 * backed registry; a focused test catches the contract that the
 * downstream client-side detector (P2.C6) and the reload pipeline
 * (P2.C7) depend on.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-version-stamp-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  bumpVersion,
  getVersion,
  pluginVersionHeader,
  stampPluginResponse,
  __resetVersionsForTest,
  PLUGIN_VERSION_HEADER,
} from '../../../src/core/plugin-host/version-stamp'

beforeEach(() => {
  __resetVersionsForTest()
})

describe('version-stamp registry', () => {
  it('getVersion defaults to 0 for unknown ids', () => {
    expect(getVersion('never-seen')).toBe(0)
  })

  it('bumpVersion returns monotonic sequence per plugin', () => {
    expect(bumpVersion('foo')).toBe(1)
    expect(bumpVersion('foo')).toBe(2)
    expect(bumpVersion('foo')).toBe(3)
    expect(getVersion('foo')).toBe(3)
  })

  it('bumpVersion is independent per plugin id', () => {
    bumpVersion('a')
    bumpVersion('a')
    bumpVersion('b')
    expect(getVersion('a')).toBe(2)
    expect(getVersion('b')).toBe(1)
  })
})

describe('pluginVersionHeader', () => {
  it('returns <pluginId>:<version>', () => {
    expect(pluginVersionHeader('foo')).toBe('foo:0')
    bumpVersion('foo')
    expect(pluginVersionHeader('foo')).toBe('foo:1')
  })
})

describe('stampPluginResponse', () => {
  it('adds the version header without losing existing headers', async () => {
    const original = new Response('hello', {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' },
    })
    bumpVersion('foo')
    bumpVersion('foo') // → version 2

    const stamped = stampPluginResponse('foo', original)
    expect(stamped.headers.get(PLUGIN_VERSION_HEADER)).toBe('foo:2')
    expect(stamped.headers.get('Content-Type')).toBe('text/plain')
    expect(stamped.headers.get('Cache-Control')).toBe('no-store')
    expect(stamped.status).toBe(200)
    expect(await stamped.text()).toBe('hello')
  })

  it('preserves status / statusText', () => {
    const stamped = stampPluginResponse(
      'bar',
      new Response('bad', { status: 404, statusText: 'Not Found' }),
    )
    expect(stamped.status).toBe(404)
    expect(stamped.headers.get(PLUGIN_VERSION_HEADER)).toBe('bar:0')
  })

  it('does not bump the version itself — caller controls bump cadence', () => {
    expect(getVersion('zap')).toBe(0)
    stampPluginResponse('zap', new Response('x'))
    stampPluginResponse('zap', new Response('y'))
    stampPluginResponse('zap', new Response('z'))
    // Three responses stamped, version stays at 0 because nobody called bumpVersion.
    expect(getVersion('zap')).toBe(0)
  })
})
