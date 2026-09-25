/**
 * S3 through the REST path: `POST /api/plugins/install?async=1` with the
 * accepted consent runs the commit as an install job, and the `bins` stage
 * is observable on the shared event bus (the same events Explore renders).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID, createHash } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-install-job-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
const paths = () => ({ root: testDir, home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db'), media: join(testDir, 'media') })
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: paths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }))
mock.module('../../../packages/host/src/plugin-host/user-plugin-builder', () => ({ buildUserPlugin: async () => {} }))
const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (payload: Record<string, unknown>) => { broadcasts.push(payload) } }))

import { post as installPOST } from '../../../packages/host/src/api/plugins/install'
import { getInstallJob } from '../../../src/core/agent-packages/install-progress'
import { readPluginLockfile } from '../../../packages/core/src/plugins/lockfile'
import { waitUntil } from '../../helpers/wait'

const SCRIPT = '#!/bin/sh\necho tool\n'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const platform = `${process.platform === 'darwin' ? 'darwin' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
let server: { port: number; stop: (f?: boolean) => void }
const source = join(testDir, 'source')
const request = (body: unknown, query = '') => new Request(`http://localhost/api/plugins/install${query}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

beforeAll(async () => {
  const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response
  server = (Bun as unknown as { serve: (o: unknown) => typeof server }).serve({ port: 0, fetch: () => new NativeResponse(SCRIPT) })
})
afterAll(() => { server.stop(true); rmSync(testDir, { recursive: true, force: true }) })
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(source, { recursive: true }); broadcasts.length = 0
  writeFileSync(join(source, 'bakin-plugin.json'), JSON.stringify({
    id: 'toolplug', name: 'toolplug', version: '1.0.0', bakin: '*', description: 'declares a binary',
    requires: { bins: [{ name: 'tool', version: '1.0.0', install: { [platform]: { url: `http://127.0.0.1:${server.port}/tool`, sha256: sha256(SCRIPT) } } }] },
  }))
  writeFileSync(join(source, 'index.ts'), "export default { id: 'toolplug', activate() {} }")
})

describe('plugin install as an install job', () => {
  it('the accepted commit returns 202 + jobId, emits a bins stage on the bus, and the job result is the install outcome', async () => {
    const pre = await (await installPOST(request({ source, type: 'local', accepted: false }), new URL('http://localhost/api/plugins/install'))).json() as { consentToken: string }
    const res = await installPOST(
      request({ source, type: 'local', accepted: true, consentToken: pre.consentToken }, '?async=1'),
      new URL('http://localhost/api/plugins/install?async=1'),
    )
    expect(res.status).toBe(202)
    const { jobId } = await res.json() as { jobId: string }
    expect(jobId).toBeTruthy()

    await waitUntil(() => getInstallJob(jobId)?.status !== 'running', { label: 'plugin install job settles' })
    const job = getInstallJob(jobId)!
    expect(job.kind).toBe('plugin')
    expect(job.status).toBe('done')
    expect((job.result as { ok?: boolean }).ok).toBe(true)

    const progress = broadcasts.filter((b) => b.event === 'packages.install_progress' && b.jobId === jobId)
    expect(progress.some((b) => b.stage === 'bins' && b.item === 'tool')).toBe(true)
    expect(broadcasts.some((b) => b.event === 'packages.install_done' && b.jobId === jobId)).toBe(true)
    expect(readPluginLockfile().plugins.toolplug?.installedBins).toEqual([{ name: 'tool', sha256: sha256(SCRIPT) }])
  })

  it('the preflight (consent) POST stays synchronous even with ?async=1 — the token must come back', async () => {
    const res = await installPOST(request({ source, type: 'local', accepted: false }, '?async=1'), new URL('http://localhost/api/plugins/install?async=1'))
    const body = await res.json() as { awaitingConsent?: boolean; consentToken?: string; jobId?: string }
    expect(body.awaitingConsent).toBe(true)
    expect(body.consentToken).toBeTruthy()
    expect(body.jobId).toBeUndefined()
  })
})
