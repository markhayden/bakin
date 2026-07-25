/**
 * End-to-end coverage for `bakin plugins install --ref <ref>` / shorthand
 * `@ref` support. Uses file:// bare repos so the install flow exercises
 * real git clone/checkout behavior without network.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-ref-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module(
  '../../../packages/host/src/plugin-host/user-plugin-builder',
  () => ({ buildUserPlugin: async () => {} }),
)

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { createBareRepo, gitAvailable, pushCommit, runGit } from '../../fixtures/plugins/hermetic-git'

function manifest(id: string, version: string): string {
  return JSON.stringify(
    {
      id,
      name: id,
      version,
      bakin: '*',
      description: `${id} fixture`,
            permissions: [],
    },
    null,
    2,
  )
}

function pluginFiles(id: string, version: string): Record<string, string> {
  return {
    [`plugins/${id}/bakin-plugin.json`]: manifest(id, version),
    [`plugins/${id}/index.ts`]: `export default { id: '${id}', activate() {} }`,
  }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plugins/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function invoke(body: unknown) {
  const res = await installPOST(makeRequest(body), new URL('http://localhost/api/plugins/install'))
  return { res, body: await res.json() }
}

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(join(testDir, 'plugins'), { recursive: true, force: true })
})

describe.skipIf(!gitAvailable())('plugin install refs', () => {
  it('installs a monorepo plugin at a requested tag and records the resolved sha', async () => {
    const repoRoot = join(testDir, 'tag-repo')
    const { cloneUrl, workingClonePath } = createBareRepo(repoRoot, 'official', pluginFiles('tagged', '1.0.0'))
    const tagSha = runGit(['rev-parse', 'HEAD'], workingClonePath).toLowerCase()
    runGit(['tag', 'tagged-v1.0.0'], workingClonePath)
    runGit(['push', 'origin', 'tagged-v1.0.0'], workingClonePath)
    pushCommit(workingClonePath, pluginFiles('tagged', '2.0.0'), 'main moves past tag')

    const { res, body } = await invoke({
      source: `${cloneUrl}#plugins/tagged`,
      type: 'github',
      ref: 'tagged-v1.0.0',
    })

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const installedManifest = JSON.parse(readFileSync(
      join(testDir, 'plugins', 'tagged', 'bakin-plugin.json'),
      'utf-8',
    ))
    expect(installedManifest.version).toBe('1.0.0')

    const lock = readPluginLockfile()
    expect(lock.plugins.tagged!.ref).toBe('tagged-v1.0.0')
    expect(lock.plugins.tagged!.commitSha).toBe(tagSha)
  })

  it('falls back to full clone for exact commit refs', async () => {
    const repoRoot = join(testDir, 'sha-repo')
    const { cloneUrl, workingClonePath } = createBareRepo(repoRoot, 'official', pluginFiles('shaed', '1.0.0'))
    const initialSha = runGit(['rev-parse', 'HEAD'], workingClonePath).toLowerCase()
    pushCommit(workingClonePath, pluginFiles('shaed', '2.0.0'), 'main moves past sha')

    const { res, body } = await invoke({
      source: `${cloneUrl}#plugins/shaed`,
      type: 'github',
      ref: initialSha,
    })

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    const installedManifest = JSON.parse(readFileSync(
      join(testDir, 'plugins', 'shaed', 'bakin-plugin.json'),
      'utf-8',
    ))
    expect(installedManifest.version).toBe('1.0.0')

    const lock = readPluginLockfile()
    expect(lock.plugins.shaed!.ref).toBe(initialSha)
    expect(lock.plugins.shaed!.commitSha).toBe(initialSha)
  })

  it('rejects conflicting source and request-body refs before cloning', async () => {
    const { res, body } = await invoke({
      source: 'github:owner/repo@v1.0.0#plugins/foo',
      type: 'github',
      ref: 'v2.0.0',
    })

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/conflicting refs/i)
  })

  it('rejects invalid refs before cloning', async () => {
    const { res, body } = await invoke({
      source: 'github:owner/repo#plugins/foo',
      type: 'github',
      ref: '-bad',
    })

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/ref must match/i)
  })
})
