/**
 * Pi extension discovery has a deadline (#895 PLAN § 6.4): the allow/revoke
 * and list routes are synchronous, so a package-manager resolve that never
 * settles must surface as an error, never a hung request.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-ext-deadline-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.PI_HOME = join(testDir, 'pi')

import { afterAll, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'

mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

// A resolve that never settles — the hung package manager.
let resolveCalls = 0
mock.module('../../packages/adapter-pi/src/messaging', () => ({
  extensionsPolicy: () => ({ mode: 'allowlist', allow: [] }),
  extensionApproved: () => false,
  resolveExtensionResources: () => {
    resolveCalls += 1
    return new Promise(() => {})
  },
}))

import { createExtensionsSurface, EXTENSION_DISCOVERY_DEADLINE_MS } from '../../packages/adapter-pi/src/extensions'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('Pi extension discovery deadline', () => {
  it('is 15 seconds by default', () => {
    expect(EXTENSION_DISCOVERY_DEADLINE_MS).toBe(15_000)
  })

  it('a hung discovery rejects at the deadline instead of hanging the caller', async () => {
    const surface = createExtensionsSurface(() => ({}), { discoveryDeadlineMs: 40 })
    const started = Date.now()
    await expect(surface.list()).rejects.toThrow('did not finish within')
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(resolveCalls).toBe(1)
  })
})
