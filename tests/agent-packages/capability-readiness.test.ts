/**
 * Capability readiness engine (T2.3): the none → content → +bin → +key
 * transition ladder, with honest per-leg remediation at every rung.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-cap-readiness-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('@/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const projectedSkills = new Set<string>()
mock.module('@/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      skills: {
        get: async (name: string) => (projectedSkills.has(name) ? { name, instructions: '#' } : null),
      },
    },
  }),
}))

import { listCapabilities } from '../../src/core/agent-packages/capability-readiness'
import { binPlatformKey } from '../../src/core/agent-packages/bin-installer'
import { setStoredSecret } from '../../packages/core/src/media/secret-store'
import { resetContentDir } from '../../src/core/content-dir'

const key = binPlatformKey()!

function seedInstalledPack(opts: { withBin?: boolean } = {}): void {
  // Install dir with the manifest, exactly where the installer commits it.
  const dir = join(testDir, 'packages', 'skill-packs', 'web-search-brave@1.0.0')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify({
    id: 'web-search-brave',
    kind: 'skill-pack',
    name: 'Web Search (Brave)',
    version: '1.0.0',
    capability: 'web-search',
    contributions: { skills: ['skills/bx-search'] },
    ...(opts.withBin === false ? {} : {
      requires: { bins: [{ name: 'bx', version: '1.4.0', install: { [key]: { url: 'https://example.com/bx', sha256: 'a'.repeat(64) } } }] },
    }),
    secrets: [{ name: 'BRAVE_SEARCH_API_KEY', description: 'key', required: true, secretSlot: 'brave.apiKey', help: 'https://api-dashboard.search.brave.com' }],
  }))
  // Lockfile entry with the skill (+bin) projections.
  mkdirSync(join(testDir, 'packages'), { recursive: true })
  writeFileSync(join(testDir, 'packages', 'lock.json'), JSON.stringify({
    version: 1,
    packages: {
      'web-search-brave@1.0.0': {
        kind: 'skill-pack',
        version: '1.0.0',
        source: 'github:markhayden/bakin-bits-official#packs/web-search-brave',
        ref: 'main',
        commitSha: 'c'.repeat(40),
        installedAt: new Date().toISOString(),
        projections: [
          { kind: 'skill', target: 'runtime:global-skill:bx-search', sha256: 'd'.repeat(64) },
          ...(opts.withBin === false ? [] : [{ kind: 'bin', target: join(testDir, 'bin', 'bx'), sha256: 'a'.repeat(64) }]),
        ],
      },
    },
  }))
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetContentDir()
  projectedSkills.clear()
  delete process.env.BRAVE_SEARCH_API_KEY
})

afterAll(() => {
  delete process.env.BRAVE_SEARCH_API_KEY
  rmSync(testDir, { recursive: true, force: true })
})

describe('listCapabilities', () => {
  it('returns nothing with no installed capability packs', async () => {
    expect(await listCapabilities()).toEqual([])
  })

  it('walks the readiness ladder: content missing → bin missing → key missing → ready', async () => {
    seedInstalledPack()

    // Rung 1: nothing projected, no bin, no key — every leg missing.
    let [cap] = await listCapabilities()
    expect(cap.capability).toBe('web-search')
    expect(cap.ready).toBe(false)
    expect(cap.skills[0].status).toBe('missing')
    expect(cap.bins[0].status).toBe('missing')
    expect(cap.secrets[0].status).toBe('missing')
    expect(cap.missing.join('\n')).toContain('bakin packages sync')
    expect(cap.missing.join('\n')).toContain('Integrations & Keys')

    // Rung 2: content projected.
    projectedSkills.add('bx-search')
    ;[cap] = await listCapabilities()
    expect(cap.skills[0].status).toBe('ok')
    expect(cap.ready).toBe(false)

    // Rung 3: bin installed.
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(join(testDir, 'bin', 'bx'), '#!/bin/sh\n')
    ;[cap] = await listCapabilities()
    expect(cap.bins[0].status).toBe('ok')
    expect(cap.ready).toBe(false)
    expect(cap.missing).toHaveLength(1)

    // Rung 4: key stored — READY.
    setStoredSecret('brave', 'apiKey', 'bsk-1')
    ;[cap] = await listCapabilities()
    expect(cap.secrets[0].status).toBe('store')
    expect(cap.ready).toBe(true)
    expect(cap.missing).toEqual([])
  })

  it('an env var beats the store and reports source env', async () => {
    seedInstalledPack({ withBin: false })
    projectedSkills.add('bx-search')
    process.env.BRAVE_SEARCH_API_KEY = 'bsk-env'
    const [cap] = await listCapabilities()
    expect(cap.secrets[0].status).toBe('env')
    expect(cap.ready).toBe(true)
  })

  it('skill-packs without a capability slug are not capabilities', async () => {
    seedInstalledPack()
    const dir = join(testDir, 'packages', 'skill-packs', 'web-search-brave@1.0.0')
    const manifest = JSON.parse(require('fs').readFileSync(join(dir, 'bakin-package.json'), 'utf-8'))
    delete manifest.capability
    writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify(manifest))
    expect(await listCapabilities()).toEqual([])
  })
})
