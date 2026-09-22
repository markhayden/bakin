/**
 * `bakin models plan [--apply] [--json]` — reads GET /plan, prints the two
 * lanes + changes, and ONLY with --apply submits the plan's ops through
 * POST /selections under the plan's revision (one retry on a stale
 * revision). Never writes without the flag.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-cli-models-plan-${Date.now()}`)
process.env.BAKIN_HOME = testHome
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }) }))

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'
let ops: Array<{ ref: string; set: { model: string | null } }> = []
let revision = 'rev-1'
const getCalls: string[] = []
mock.module('../../src/cli/http', () => ({
  BASE_URL: 'http://bakin.test',
  apiGet: mock(async (path: string) => {
    getCalls.push(path)
    return {
      revision,
      current: { agent: LUNA, chores: { model: LUNA, models: [LUNA], mixed: false }, enrichmentEnabled: true },
      candidates: 2,
      recommended: {
        agent: { model: LUNA, why: 'Your current default model — it can run here.', suitability: 'known' },
        chores: { model: MINI, why: 'included in your plan · lightest tier that can do these jobs', suitability: 'known' },
        routes: [],
        enrichment: 'agent',
        ops,
        notes: [`${MINI} cannot see images, so enrichment (captions, OCR, tags) runs on ${LUNA} instead.`],
      },
    }
  }),
}))
const printSpy = mock((_v: unknown) => {})
mock.module('../../src/cli/output', () => ({ print: printSpy }))
class ExitCalled extends Error {}
mock.module('../../src/cli/help', () => ({
  exitUsage: mock(async (): Promise<never> => { throw new ExitCalled('usage') }),
  exitUnknownSubcommand: mock(async (): Promise<never> => { throw new ExitCalled('unknown') }),
}))

import { run } from '../../src/cli/commands/models'

const posts: Array<{ url: string; body: Record<string, unknown> }> = []
let postResponses: Array<{ status: number; body: Record<string, unknown> }> = []
const originalFetch = globalThis.fetch
const logs: string[] = []
const originalLog = console.log

beforeEach(() => {
  ops = [{ ref: 'route:auto-title', set: { model: MINI } }, { ref: 'route:enrichment', set: { model: LUNA } }]
  revision = 'rev-1'
  getCalls.length = 0
  posts.length = 0
  logs.length = 0
  printSpy.mockClear()
  postResponses = [{ status: 200, body: { applied: ops.map((o) => o.ref), failed: [], pending: [] } }]
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    const next = postResponses.shift() ?? { status: 200, body: { applied: [], failed: [], pending: [] } }
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
})
afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalLog
})

describe('bakin models plan', () => {
  it('prints both lanes, the enrichment placement, the notes and the changes — and writes NOTHING', async () => {
    await run(['models', 'plan'])
    expect(getCalls).toEqual(['/api/plugins/models/plan'])
    expect(posts).toEqual([])
    const out = logs.join('\n')
    expect(out).toContain(`Agent model   ${LUNA}`)
    expect(out).toContain(`Chores model  ${MINI}`)
    expect(out).toContain('runs on the agent model')
    expect(out).toContain('cannot see images')
    expect(out).toContain('Changes (2)')
    expect(out).toContain(`route:auto-title → ${MINI}`)
    expect(out).toContain('--apply')
  })

  it('--json prints the payload verbatim', async () => {
    await run(['models', 'plan', '--json'])
    expect(posts).toEqual([])
    expect(printSpy).toHaveBeenCalledTimes(1)
    expect((printSpy.mock.calls[0]![0] as { revision: string }).revision).toBe('rev-1')
  })

  it('--apply posts the plan ops under the plan revision through POST /selections', async () => {
    await run(['models', 'plan', '--apply'])
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe('http://bakin.test/api/plugins/models/selections')
    expect(posts[0]!.body).toEqual({ revision: 'rev-1', ops })
    expect(logs.join('\n')).toContain('Applied 2 of 2 changes')
  })

  it('--apply retries ONCE on a stale revision with a fresh plan', async () => {
    postResponses = [
      { status: 409, body: { error: 'stale_revision' } },
      { status: 200, body: { applied: ops.map((o) => o.ref), failed: [], pending: [] } },
    ]
    await run(['models', 'plan', '--apply'])
    expect(getCalls).toHaveLength(2)
    expect(posts).toHaveLength(2)
  })

  it('--apply with nothing to change says so and never posts', async () => {
    ops = []
    await run(['models', 'plan', '--apply'])
    expect(posts).toEqual([])
    expect(logs.join('\n')).toContain('already on the recommended plan')
  })
})
