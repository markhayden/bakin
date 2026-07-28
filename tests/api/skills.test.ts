/**
 * T10 (#687): /api/skills routes — list join (managed + unmanaged),
 * preview/consent/install round-trip, drift bounce, refusal statuses.
 * Direct handler invocation over local fixture sources; no network.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-api-skills-${Date.now()}-${randomUUID()}`)
const openClawDir = pathJoin(testDir, 'openclaw')
process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cpSync, rmSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: pathJoin(testDir, 'bin'), db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: 'pi' } }),
}))

const skillStore = new Map<string, { name: string; files?: Record<string, string>; metadata?: Record<string, unknown> }>()
mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      agents: { list: async () => [], get: async () => null },
      skills: {
        list: async () => Array.from(skillStore.values()),
        get: async (name: string) => skillStore.get(name) ?? null,
        write: async (skill: { name: string; metadata?: Record<string, unknown> }) => {
          skillStore.set(skill.name, skill as never)
        },
        remove: async (name: string) => {
          skillStore.delete(name)
        },
      },
    },
  }),
  maybeGetAppServices: () => undefined,
}))

import { get, install, preview } from '../../packages/host/src/api/skills'

const FIXTURES = join(import.meta.dir, '..', 'fixtures', 'skill-bundles')
const apiUrl = (path: string) => new URL(`http://localhost${path}`)

function seedSource(fixture: string, name: string): string {
  const dir = join(testDir, 'sources', name)
  rmSync(dir, { recursive: true, force: true })
  cpSync(join(FIXTURES, fixture), dir, { recursive: true })
  return dir
}

function postJson(path: string, body: unknown): Request {
  return new Request(apiUrl(path), { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  skillStore.clear()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('POST /api/skills/preview + /api/skills/install', () => {
  it('preview → consent → install → list shows the managed hub skill', async () => {
    const src = seedSource('clawhub-style', 'flow-a')

    const previewRes = await preview(postJson('/api/skills/preview', { ref: src }), apiUrl('/api/skills/preview'))
    expect(previewRes.status).toBe(200)
    const previewBody = await previewRes.json() as { ok: boolean; preview: { consentToken: string; packageId: string; requirements: { secrets: Array<{ name: string }> } } }
    expect(previewBody.ok).toBe(true)
    expect(previewBody.preview.packageId).toBe('hub-ebay-research')
    expect(previewBody.preview.requirements.secrets.map((s) => s.name)).toContain('EBAY_API_KEY')

    const installRes = await install(
      postJson('/api/skills/install', { ref: src, consentToken: previewBody.preview.consentToken }),
      apiUrl('/api/skills/install'),
    )
    expect(installRes.status).toBe(200)
    const installBody = await installRes.json() as { ok: boolean; installed: { packageId: string } }
    expect(installBody.installed.packageId).toBe('hub-ebay-research')
    expect(skillStore.has('ebay-research')).toBe(true)

    const listRes = await get(new Request(apiUrl('/api/skills')), apiUrl('/api/skills'))
    const listBody = await listRes.json() as { managed: Array<{ skillName: string; hub: boolean; upstream?: { source: string } }> }
    const row = listBody.managed.find((r) => r.skillName === 'ebay-research')
    expect(row?.hub).toBe(true)
    expect(row?.upstream?.source).toBe(src)
  })

  it('install without a valid token is refused with 400', async () => {
    const src = seedSource('bare-style', 'flow-b')
    const res = await install(postJson('/api/skills/install', { ref: src, consentToken: 'nope' }), apiUrl('/api/skills/install'))
    expect(res.status).toBe(400)
    expect(skillStore.size).toBe(0)
  })

  it('binary bundles preview as an audited 403 refusal', async () => {
    const src = seedSource('binary-file', 'flow-c')
    const res = await preview(postJson('/api/skills/preview', { ref: src }), apiUrl('/api/skills/preview'))
    expect(res.status).toBe(403)
    const body = await res.json() as { refused: boolean }
    expect(body.refused).toBe(true)
  })

  it('garbage refs 400 with the normalizer message', async () => {
    const res = await preview(postJson('/api/skills/preview', { ref: 'https://example.com/nope' }), apiUrl('/api/skills/preview'))
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toContain('clawhub')
  })
})

describe('GET /api/skills — unmanaged join', () => {
  it('labels runtime skills without markers as unmanaged, hides marker-carrying ones', async () => {
    skillStore.set('hand-rolled', { name: 'hand-rolled', metadata: { scope: 'global' } })
    skillStore.set('plugin-installed', { name: 'plugin-installed', metadata: { installedBy: { pluginId: 'images' } } })
    const res = await get(new Request(apiUrl('/api/skills')), apiUrl('/api/skills'))
    const body = await res.json() as { managed: unknown[]; unmanaged: Array<{ name: string }> }
    expect(body.unmanaged.map((u) => u.name)).toEqual(['hand-rolled'])
  })
})
