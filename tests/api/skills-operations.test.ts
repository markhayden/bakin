/**
 * Hub-skill preview as an operation (#895, PLAN 4.5): only the body is
 * validated synchronously. A stalled hub never holds the request — the route
 * answers 202 at once, the stall is visible on the operation's fetch stage,
 * and a refusal that arrives later is preserved as a failed outcome carrying
 * today's 403 body (the trust gate still fails closed).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-skills-ops-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { rmSync } from 'fs'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// A stalled hub: the fetch (which carries the hub verdict) hangs until the
// test answers it — with a refusal, as a blocked skill would.
let answerFetch!: (outcome: { refuse: string }) => void
const realFetcher = await import('../../src/core/agent-packages/source-fetcher')
const { SkillRefusalError } = await import('../../src/core/agent-packages/errors')
mock.module('../../src/core/agent-packages/source-fetcher', () => ({
  ...realFetcher,
  fetchSourceAsync: () => new Promise((_resolve, reject) => {
    answerFetch = ({ refuse }) => reject(new SkillRefusalError(refuse, 'hub-verdict'))
  }),
}))

import { operationQuietState } from '../../packages/sdk/src/types/operations'
import { mapApply, preview } from '../../packages/host/src/api/skills'
import { holdNow } from '../../packages/core/src/operations'
import { _resetOperationRegistryForTests, getOperationRegistry } from '../../src/core/operations'
import { waitUntil } from '../helpers/wait'

afterAll(() => {
  _resetOperationRegistryForTests()
  rmSync(testDir, { recursive: true, force: true })
})
beforeEach(() => _resetOperationRegistryForTests())

const post = (body: unknown) => new Request('http://localhost/api/skills/preview', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('hub-skill preview over a stalled hub', () => {
  it('answers 202 at once, shows the stall on its fetch stage, and keeps a later refusal as a 403 outcome', async () => {
    const started = Date.now()
    const res = await preview(post({ ref: 'clawhub:@someone/stalled-skill' }))
    expect(Date.now() - started).toBeLessThan(500)
    expect(res.status).toBe(202)
    const { operationId } = await res.json() as { operationId: string }

    await waitUntil(() => getOperationRegistry().get(operationId)?.stages[0]?.status === 'active', { label: 'preview fetching' })
    const stalled = getOperationRegistry().get(operationId)!
    expect(stalled.status).toBe('running')
    expect(stalled.resources).toEqual([])
    // Nothing has progressed since the fetch began: past the stage's stuck
    // window the view reads as stuck on `fetch` — the stall is visible.
    const fetchStage = stalled.stages[0]!
    expect(operationQuietState(stalled, Date.parse(stalled.lastProgressAt) + 31_000)).toMatchObject({ state: 'stuck', stageId: fetchStage.id })

    answerFetch({ refuse: 'ClawHub has blocked this skill as malware' })
    const view = await getOperationRegistry().await(operationId)
    expect(view.status).toBe('failed')
    expect(view.outcome?.code).toBe('refused')
    expect(view.result?.httpStatus).toBe(403)
    expect(view.result?.body).toEqual({ ok: false, refused: true, error: 'ClawHub has blocked this skill as malware' })
  })

  it('an invalid body is still a synchronous 400 — no operation', async () => {
    const res = await preview(post({ nope: true }))
    expect(res.status).toBe(400)
    expect(getOperationRegistry().list()).toEqual([])
  })
})

describe('skill-map apply never waits', () => {
  it('busy → 409 install_busy naming the holder; the mapping is never applied', async () => {
    let release!: () => void
    let ready!: () => void
    const heldReady = new Promise<void>((resolve) => { ready = resolve })
    void holdNow(['install-state'], { title: 'Install skill weather' }, () => new Promise<void>((resolve) => { release = resolve; ready() }))
    await heldReady

    const res = await mapApply(new Request('http://localhost/api/skills/map/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'weather', mapping: { addSecrets: [], addPrereqs: [], dropped: [] } }),
    }))
    release()

    expect(res.status).toBe(409)
    const body = await res.json() as { error: string; holder: { title: string } }
    expect(body.error).toBe('install_busy')
    expect(body.holder.title).toBe('Install skill weather')
  })
})
