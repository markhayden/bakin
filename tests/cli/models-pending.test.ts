/**
 * `bakin models pending [--ack <document>]` — lists the adapter writes the
 * ONE write path could not confirm, and is the operator's recovery for a
 * CONFLICT: `--ack` posts the acknowledgement, everything else is read-only.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = join(tmpdir(), `bakin-cli-models-pending-${Date.now()}`)
process.env.BAKIN_HOME = testHome
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: () => ({ home: testHome, db: join(testHome, 'bakin.db') }) }))

let pending: Array<{ document: string; refs: string[]; state: string; detail?: string }> = []
mock.module('../../src/cli/http', () => ({
  BASE_URL: 'http://bakin.test',
  apiGet: mock(async () => ({ revision: 'rev-1', states: [], pending })),
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
let postResponse: { status: number; body: Record<string, unknown> } = { status: 200, body: { ok: true, document: 'agent:patch', refs: ['agent:patch:model'], pending: [] } }
const originalFetch = globalThis.fetch
const logs: string[] = []
const originalLog = console.log

beforeEach(() => {
  pending = []
  posts.length = 0
  logs.length = 0
  printSpy.mockClear()
  postResponse = { status: 200, body: { ok: true, document: 'agent:patch', refs: ['agent:patch:model'], pending: [] } }
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    posts.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> })
    return new Response(JSON.stringify(postResponse.body), { status: postResponse.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
})
afterEach(() => {
  globalThis.fetch = originalFetch
  console.log = originalLog
})

describe('bakin models pending', () => {
  it('lists every pending write with its state and points a conflict at --ack; never writes', async () => {
    pending = [
      { document: 'policy', refs: ['policy:defaultModel'], state: 'unsettled' },
      { document: 'agent:patch', refs: ['agent:patch:model'], state: 'conflict', detail: 'changed outside Bakin while a write was pending' },
    ]
    await run(['models', 'pending'])
    expect(posts).toEqual([])
    const out = logs.join('\n')
    expect(out).toContain('unsettled  policy  policy:defaultModel')
    expect(out).toContain('conflict   agent:patch  agent:patch:model — changed outside Bakin')
    expect(out).not.toContain('unsettled policy')
    expect(out).toContain('bakin models pending --ack <document>')
  })

  it('says so when nothing is pending; --json prints the list verbatim', async () => {
    await run(['models', 'pending'])
    expect(logs.join('\n')).toContain('No pending model writes.')
    pending = [{ document: 'routing', refs: ['route:relay'], state: 'failed', detail: 'gateway timeout' }]
    await run(['models', 'pending', '--json'])
    expect(printSpy).toHaveBeenCalledWith(pending)
  })

  it('--ack posts the acknowledgement for that document and reports the freed refs', async () => {
    await run(['models', 'pending', '--ack', 'agent:patch'])
    expect(posts).toEqual([{ url: 'http://bakin.test/api/plugins/models/selections/pending/acknowledge', body: { document: 'agent:patch' } }])
    expect(logs.join('\n')).toContain('Acknowledged the conflicted write on agent:patch (agent:patch:model)')
  })

  it('--ack on a document with nothing to acknowledge exits 1 with the server\'s reason', async () => {
    postResponse = { status: 404, body: { error: 'no_conflict', message: 'agent:patch has no conflicted pending write to acknowledge' } }
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new ExitCalled(`exit ${code}`) }) as never)
    const errors: string[] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')) }
    try {
      await expect(run(['models', 'pending', '--ack', 'agent:patch'])).rejects.toThrow('exit 1')
      expect(errors.join('\n')).toContain('no conflicted pending write')
    } finally {
      exitSpy.mockRestore()
      console.error = originalError
    }
  })
})
