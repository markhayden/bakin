/**
 * `bakin plugins import` follows every plugin's preview → commit operations
 * to a terminal outcome before reporting it installed (#895, PLAN 4.3). A
 * plugin whose preview asks for consent installs only under --yes; one with
 * nothing to consent to commits straight away.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import { TEST_BOOT_ID, finishedOperation } from '../helpers/operation-fetch'

const testDir = join(tmpdir(), `bakin-test-plugin-import-ops-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultIsTTY: false })
const { fetchMock, output } = harness

let stderrSpy: ReturnType<typeof spyOn> | undefined
beforeEach(() => { stderrSpy = spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write) })
afterEach(() => { stderrSpy?.mockRestore() })

/**
 * Answers the install route per call — each POST becomes a finished operation
 * whose result is `answer(body)` — and serves those operations' reads.
 */
function routeFetch(answer: (body: Record<string, unknown>) => Record<string, unknown>): Array<Record<string, unknown>> {
  const posts: Array<Record<string, unknown>> = []
  const operations = new Map<string, ReturnType<typeof finishedOperation>>()
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const read = /\/api\/operations\/([^/?]+)/.exec(url)
    if (read) return new Response(JSON.stringify({ bootId: TEST_BOOT_ID, operation: operations.get(read[1]!), children: [] }), { status: 200 })
    if (url.endsWith('/api/events')) return new Response('{}', { status: 503 })
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    posts.push(body)
    const id = `op-${posts.length}`
    operations.set(id, finishedOperation(id, { httpStatus: 200, body: answer(body) }))
    return new Response(JSON.stringify({ operationId: id, bootId: TEST_BOOT_ID }), { status: 202 })
  })
  return posts
}

const consentFree = (body: Record<string, unknown>) => body.accepted === true
  ? { ok: true, id: 'projects', message: 'Installed "projects".' }
  : { ok: true, awaitingConsent: false, ready: true, id: 'projects', version: '1.0.0', permissions: [], bins: [] }
const needsConsent = (body: Record<string, unknown>) => body.accepted === true
  ? { ok: true, id: 'terminal', message: 'Installed "terminal".' }
  : { ok: false, awaitingConsent: true, id: 'terminal', version: '0.2.0', permissions: [], bins: [{ name: 'tmux' }], consentToken: 'tok-terminal' }

function writeManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bakin-import-ops-'))
  const file = join(dir, 'plugins.json')
  writeFileSync(file, JSON.stringify({
    version: 1,
    plugins: [
      { id: 'projects', source: 'github:markhayden/bakin-bits-official#plugins/projects', type: 'github', ref: '', commitSha: '' },
      { id: 'terminal', source: 'github:markhayden/bakin-bits-official#plugins/terminal', type: 'github', ref: '', commitSha: '' },
    ],
  }))
  return file
}

async function run(...args: string[]): Promise<void> {
  const { main } = await import('../../cli/bakin')
  process.argv = ['bun', 'cli/bakin.ts', ...args]
  await main()
}

describe('plugins import over operations', () => {
  it('--yes: the consent-free plugin commits after its ready preview; the other commits with its consent token', async () => {
    const posts = routeFetch((body) => String(body.source).endsWith('projects') ? consentFree(body) : needsConsent(body))
    await run('plugins', 'import', writeManifest(), '--yes', '--json')

    const result = JSON.parse(output()) as { ok: boolean; installed: string[]; failed: unknown[] }
    expect(result.ok).toBe(true)
    expect(result.installed).toEqual(['projects', 'terminal'])
    expect(posts.map((p) => [String(p.source).split('/').pop(), p.accepted, p.consentToken ?? null])).toEqual([
      ['projects', false, null],
      ['projects', true, null],
      ['terminal', false, null],
      ['terminal', true, 'tok-terminal'],
    ])
  })

  it('without --yes the consent-needing plugin fails (never committed) while the other installs', async () => {
    const posts = routeFetch((body) => String(body.source).endsWith('projects') ? consentFree(body) : needsConsent(body))
    await expect(run('plugins', 'import', writeManifest(), '--json')).rejects.toThrow('exit:1')

    const result = JSON.parse(output()) as { ok: boolean; installed: string[]; failed: Array<{ id: string; error: string }> }
    expect(result.installed).toEqual(['projects'])
    expect(result.failed.map((f) => f.id)).toEqual(['terminal'])
    expect(result.failed[0]!.error).toContain('requires consent')
    expect(posts.filter((p) => String(p.source).endsWith('terminal') && p.accepted === true)).toEqual([])
  })
})
