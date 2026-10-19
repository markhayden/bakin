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
mock.module('@/core/app-services', () => {
  const services = {
    runtime: {
      skills: {
        get: async (name: string) => (projectedSkills.has(name) ? { name, instructions: '#' } : null),
      },
    },
  }
  return {
    getAppServices: () => services,
    maybeGetAppServices: () => services,
    createAppServices: async () => services,
  }
})

import { listCapabilities } from '../../src/core/agent-packages/capability-readiness'
import { binPlatformKey } from '../../src/core/agent-packages/bin-installer'
import { setStoredSecret } from '../../packages/core/src/media/secret-store'
import { resetContentDir } from '../../src/core/content-dir'

const key = binPlatformKey()!
const BX_BYTES = '#!/bin/sh\n'
const BX_SHA = require('crypto').createHash('sha256').update(BX_BYTES).digest('hex') as string

function seedInstalledPack(opts: { withBin?: boolean; binDownload?: Record<string, unknown> } = {}): void {
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
      requires: { bins: [{ name: 'bx', version: '1.4.0', install: { [key]: opts.binDownload ?? { url: 'https://example.com/bx', sha256: BX_SHA } } }] },
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
    writeFileSync(join(testDir, 'bin', 'bx'), BX_BYTES)
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

  it('a present binary whose bytes do not match the pin is drifted, never ok (#898 D)', async () => {
    seedInstalledPack()
    projectedSkills.add('bx-search')
    setStoredSecret('brave', 'apiKey', 'bsk-1')
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(join(testDir, 'bin', 'bx'), '#!/bin/sh\necho swapped\n')
    const [cap] = await listCapabilities()
    expect(cap.bins[0].status).toBe('drifted')
    expect(cap.ready).toBe(false)
    expect(cap.missing.join('\n')).toContain('does not match the sha256')
  })

  it('an archive binary forged together with its marker is drifted — the marker is never the pin (#898 D)', async () => {
    seedInstalledPack({ binDownload: { url: 'https://example.com/bx.tar.gz', sha256: 'a'.repeat(64), archive: { format: 'tar.gz', member: 'bx', extractedSha256: BX_SHA } } })
    projectedSkills.add('bx-search')
    setStoredSecret('brave', 'apiKey', 'bsk-1')
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    const forged = '#!/bin/sh\necho forged\n'
    writeFileSync(join(testDir, 'bin', 'bx'), forged)
    writeFileSync(join(testDir, 'bin', 'bx.installedBy'), JSON.stringify({
      package: 'web-search-brave', version: '1.0.0', ref: '', commitSha: '', installedAt: new Date().toISOString(),
      sha256: 'a'.repeat(64), member: 'bx', extractedSha256: require('crypto').createHash('sha256').update(forged).digest('hex'),
    }))
    const [cap] = await listCapabilities()
    expect(cap.bins[0].status).toBe('drifted')
    expect(cap.ready).toBe(false)
  })

  it('an installed manifest that no longer validates stays visible as NOT ready — never green, never "no bins"', async () => {
    // An archive bin installed before extractedSha256 was required.
    seedInstalledPack({ binDownload: { url: 'https://example.com/bx.tar.gz', sha256: 'a'.repeat(64), archive: { format: 'tar.gz', member: 'bx' } } })
    projectedSkills.add('bx-search')
    setStoredSecret('brave', 'apiKey', 'bsk-1')
    mkdirSync(join(testDir, 'bin'), { recursive: true })
    writeFileSync(join(testDir, 'bin', 'bx'), BX_BYTES)
    const [cap] = await listCapabilities()
    expect(cap).toMatchObject({ capability: 'web-search', packageId: 'web-search-brave', ready: false })
    expect(cap.missing.join('\n')).toMatch(/installed manifest is invalid.*extractedSha256.*bakin packages install web-search-brave/)
  })

  it('an unreadable or missing installed manifest keeps the pack visible as NOT ready — never a healthy "no packs" (#898 D)', async () => {
    seedInstalledPack()
    const manifestPath = join(testDir, 'packages', 'skill-packs', 'web-search-brave@1.0.0', 'bakin-package.json')
    writeFileSync(manifestPath, '{ not json')
    let [cap] = await listCapabilities()
    expect(cap).toMatchObject({ capability: 'web-search-brave', packageId: 'web-search-brave', ready: false })
    expect(cap.missing.join('\n')).toMatch(/unreadable.*bakin packages install web-search-brave/)
    rmSync(manifestPath)
    ;[cap] = await listCapabilities()
    expect(cap.ready).toBe(false)
    expect(cap.missing.join('\n')).toMatch(/missing.*bakin packages install web-search-brave/)
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
