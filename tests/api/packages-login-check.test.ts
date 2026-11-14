/**
 * POST /api/packages/{id}/login-check — the explicit "Check login" trigger
 * (spec provider-integrations §4.1, plan 1.4c).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-login-check-route-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'fs'

const paths = () => ({ home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') })
mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths, isUsingBakinHome: () => true }))
mock.module('@bakin/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths, isUsingBakinHome: () => true }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => join(testDir, 'openclaw'), getOpenClawPath: (...p: string[]) => join(testDir, 'openclaw', ...p), resetOpenClawHome: () => {} }))
mock.module('@/core/logger', () => ({ createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) }))

import { handler } from '../../packages/host/src/api/packages/dynamic'

const pathDir = join(testDir, 'onpath')
const originalPath = process.env.PATH

function seed(): void {
  mkdirSync(pathDir, { recursive: true })
  writeFileSync(join(pathDir, 'ghprobe'), '#!/bin/sh\necho "Logged in to github.com account markhayden"\nexit 0\n')
  chmodSync(join(pathDir, 'ghprobe'), 0o755)
  process.env.PATH = `${pathDir}:${originalPath}`
  const packs: Record<string, unknown> = {}
  for (const [id, manifest] of Object.entries({
    gh: {
      id: 'gh', kind: 'skill-pack', name: 'GitHub', version: '1.1.0', capability: 'github', contributions: { skills: ['skills/x'] },
      requires: {
        prereqs: [{ name: 'GitHub CLI (gh)', kind: 'binary', probe: 'ghprobe', help: 'https://cli.github.com/' }],
        login: [{ name: 'GitHub account (gh)', probe: ['ghprobe', 'auth', 'status'], setup: 'gh auth login', help: 'https://cli.github.com/' }],
      },
    },
    plain: { id: 'plain', kind: 'skill-pack', name: 'Plain', version: '1.0.0', capability: 'plain', contributions: { skills: ['skills/x'] } },
  })) {
    const version = (manifest as { version: string }).version
    const dir = join(testDir, 'packages', 'skill-packs', `${id}@${version}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'bakin-package.json'), JSON.stringify(manifest))
    packs[`${id}@${version}`] = { kind: 'skill-pack', version, source: `github:x/y#packs/${id}`, ref: 'main', commitSha: 'c'.repeat(40), installedAt: new Date().toISOString(), projections: [] }
  }
  writeFileSync(join(testDir, 'packages', 'lock.json'), JSON.stringify({ version: 1, packages: packs }))
}

const post = (id: string) => {
  const url = new URL(`http://localhost/api/packages/${encodeURIComponent(id)}/login-check`)
  return handler(new Request(url, { method: 'POST' }), url)
}

beforeAll(seed)
afterAll(() => {
  process.env.PATH = originalPath
  rmSync(testDir, { recursive: true, force: true })
})

describe('POST /api/packages/{id}/login-check', () => {
  it('404 for a pack that is not installed', async () => {
    expect((await post('nope@1.0.0')).status).toBe(404)
  })

  it('400 no_login_requirement for an installed pack without login', async () => {
    const res = await post('plain@1.0.0')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ ok: false, code: 'no_login_requirement' })
  })

  it('runs the probe and answers the receipts, by key or bare id', async () => {
    const byKey = await (await post('gh@1.1.0')).json()
    expect(byKey).toMatchObject({ ok: true, packId: 'gh', key: 'gh@1.1.0' })
    expect(byKey.receipts).toEqual([expect.objectContaining({ name: 'GitHub account (gh)', setup: 'gh auth login', status: 'ok', account: 'Logged in to github.com account markhayden' })])
    const byId = await (await post('gh')).json()
    expect(byId.receipts[0].status).toBe('ok')
  })
})
