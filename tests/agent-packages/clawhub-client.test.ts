/**
 * ClawHub client HTTP-boundary pins (#687): ambiguity surfaces as the
 * owner-picker error from ANY endpoint, scan unreachability is null
 * (honest 'unverified') while a reachable-but-unrecognized scan THROWS
 * (fail closed), and latest-version resolution walks its fallbacks.
 */
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-clawhub-client-${Date.now()}`)

import { describe, expect, it, mock } from 'bun:test'
import { readFileSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import {
  AmbiguousClawhubSlugError,
  createClawhubClient,
} from '../../src/core/agent-packages/clawhub-client'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'skill-bundles', 'clawhub-api')
const ambiguousBody = readFileSync(join(FIXTURES, 'ambiguous-matches.json'), 'utf-8')
const scanClean = readFileSync(join(FIXTURES, 'scan-clean.json'), 'utf-8')

function clientWith(routes: Record<string, { status?: number; body: string }>) {
  return createClawhubClient({
    baseUrl: 'https://hub.test',
    fetcher: async (url) => {
      for (const [suffix, res] of Object.entries(routes)) {
        if (url.includes(suffix)) return new Response(res.body, { status: res.status ?? 200 })
      }
      throw new Error(`network down: ${url}`)
    },
  })
}

describe('clawhub client HTTP boundary', () => {
  it('ambiguous slugs throw the owner-picker error with qualified refs', async () => {
    const client = clientWith({ '/api/v1/skills/skill-vetter': { body: ambiguousBody } })
    await expect(client.getDetail('skill-vetter')).rejects.toThrow(AmbiguousClawhubSlugError)
    await expect(client.getDetail('skill-vetter')).rejects.toThrow(/clawhub:@spclaudehome\/skill-vetter/)
  })

  it('scan unreachable → null (honest unverified); unrecognized scan shape → THROW (fail closed)', async () => {
    const unreachable = clientWith({})
    expect(await unreachable.getScan('weather')).toBeNull()

    const weird = clientWith({ '/scan': { body: JSON.stringify({ moderation: 'not-an-object' }) } })
    await expect(weird.getScan('weather')).rejects.toThrow(/fail closed/)

    const clean = clientWith({ '/scan': { body: scanClean } })
    expect((await clean.getScan('weather'))?.security?.status).toBe('clean')
  })

  it('resolveLatestVersion: tags.latest → latestVersion → versions list → honest error', async () => {
    const tagged = clientWith({ '/api/v1/skills/x': { body: JSON.stringify({ skill: { slug: 'x', tags: { latest: '3.0.0' } } }) } })
    expect(await tagged.resolveLatestVersion('x')).toBe('3.0.0')

    const viaVersions = clientWith({
      '/versions': { body: JSON.stringify({ items: [{ version: '1.2.3' }] }) },
      '/api/v1/skills/x': { body: JSON.stringify({ skill: { slug: 'x' } }) },
    })
    expect(await viaVersions.resolveLatestVersion('x')).toBe('1.2.3')

    const none = clientWith({
      '/versions': { body: JSON.stringify({ items: [] }) },
      '/api/v1/skills/x': { body: JSON.stringify({ skill: { slug: 'x' } }) },
    })
    await expect(none.resolveLatestVersion('x')).rejects.toThrow(/no versions/)
  })

  it('non-OK responses carry status + body context; owner rides as a query param', async () => {
    const calls: string[] = []
    const client = createClawhubClient({
      baseUrl: 'https://hub.test',
      fetcher: async (url) => {
        calls.push(url)
        return new Response('nope', { status: 404 })
      },
    })
    await expect(client.getDetail('gone', 'steipete')).rejects.toThrow(/404/)
    expect(calls[0]).toContain('owner=steipete')
  })
})
