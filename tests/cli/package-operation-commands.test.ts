/**
 * `bakin packages|agents install|remove|sync` follow their operations
 * (#895, PLAN 4.2): each verb starts the route, follows the operation to its
 * outcome, prints the body the route used to answer, and exits with the
 * outcome — 0 succeeded, 1 failed. Piped stdout keeps carrying exactly that
 * body (progress goes to stderr); `--json` stays one document.
 */
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import { TEST_BOOT_ID, finishedOperation } from '../helpers/operation-fetch'

const testDir = join(tmpdir(), `bakin-test-pkg-op-cli-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultIsTTY: false })
const { fetchMock, output } = harness

let stderrWrites: string[] = []
let stderrSpy: ReturnType<typeof spyOn> | undefined
beforeEach(() => {
  stderrWrites = []
  stderrSpy = spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrWrites.push(String(chunk))
    return true
  }) as typeof process.stderr.write)
})
afterEach(() => { stderrSpy?.mockRestore() })

const real = (payload: unknown, status: number) => new Response(JSON.stringify(payload), { status })

/** A converted route as the CLI meets it: 202 start, snapshot read (finished), events unavailable. */
function queueOperation(id: string, body: unknown, httpStatus = 200): void {
  fetchMock.mockResolvedValueOnce(real({ operationId: id, bootId: TEST_BOOT_ID }, 202))
  fetchMock.mockResolvedValueOnce(real({ bootId: TEST_BOOT_ID, operation: finishedOperation(id, { httpStatus, body }), children: [] }, 200))
  fetchMock.mockResolvedValueOnce(real({ error: 'unavailable' }, 503))
}

/** The operation-starting requests the CLI made, in order. */
function starts(): Array<{ path: string; method: string; body: unknown }> {
  return fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), init: init as RequestInit | undefined }))
    .filter(({ url, init }) => !url.includes('/api/operations/') && !url.endsWith('/api/events') && init?.method !== undefined && init.method !== 'GET')
    .map(({ url, init }) => ({ path: new URL(url).pathname, method: init!.method!, body: init!.body ? JSON.parse(String(init!.body)) : undefined }))
}

async function run(...args: string[]): Promise<void> {
  const { main } = await import('../../cli/bakin')
  process.argv = ['bun', 'cli/bakin.ts', ...args]
  await main()
}

describe('package verbs follow their operations', () => {
  it('packages install --json: one document — the install body — and exit 0', async () => {
    queueOperation('op-install', { ok: true, resolvedSource: 'github:x/y', result: { packageId: 'y' } })
    await run('packages', 'install', 'github:x/y', '--json')
    expect(starts()).toEqual([{ path: '/api/packages/install', method: 'POST', body: { source: 'github:x/y' } }])
    expect(JSON.parse(output())).toEqual({ ok: true, resolvedSource: 'github:x/y', result: { packageId: 'y' } })
  })

  it('packages remove: a refused removal prints its body and exits 1', async () => {
    queueOperation('op-remove', { ok: false, error: 'Refusing to remove "y@1.0.0" — still required by [z].' }, 409)
    await expect(run('packages', 'remove', 'y@1.0.0')).rejects.toThrow('exit:1')
    expect(starts()).toEqual([{ path: `/api/packages/${encodeURIComponent('y@1.0.0')}`, method: 'DELETE', body: {} }])
    expect(JSON.parse(output()).error).toContain('still required')
  })

  it('packages sync piped: stdout is the receipt body, progress went to stderr', async () => {
    queueOperation('op-sync', { ok: true, receipt: { packageId: 'y@1.0.0', changed: false } })
    await run('packages', 'sync', 'y@1.0.0')
    expect(JSON.parse(output())).toEqual({ ok: true, receipt: { packageId: 'y@1.0.0', changed: false } })
    expect(stderrWrites.join('')).toContain('Test operation finished')
  })

  it('agents install --json follows the install operation', async () => {
    queueOperation('op-agent', { ok: true, result: { packageId: 'pixel', kind: 'agent', createdAgent: true } })
    await run('agents', 'install', 'github:x/pixel', '--json')
    expect(starts()).toEqual([{ path: '/api/agent-packages/install', method: 'POST', body: { source: 'github:x/pixel' } }])
    expect(JSON.parse(output()).result.packageId).toBe('pixel')
  })

  it('agents remove: a failed removal exits 1', async () => {
    queueOperation('op-agent-remove', { ok: false, error: 'boom' }, 500)
    await expect(run('agents', 'remove', 'pixel', '--json')).rejects.toThrow('exit:1')
    expect(starts()[0]).toMatchObject({ path: '/api/agent-packages/pixel', method: 'DELETE' })
  })

  it('agents sync: migration required → migrate (its own operation) → sync again, under --yes', async () => {
    queueOperation('op-sync-1', { ok: false, migrationRequired: true, error: 'legacy' }, 409)
    queueOperation('op-migrate', { ok: true, result: { alreadyMigrated: false, agents: [] } })
    queueOperation('op-sync-2', { ok: true, receipt: { agentId: 'pixel', verification: { status: 'ok' } } })
    await run('agents', 'sync', 'pixel', '--yes', '--json')
    expect(starts().map((s) => s.path)).toEqual([
      '/api/agent-packages/pixel/sync',
      '/api/agent-packages/migrate',
      '/api/agent-packages/pixel/sync',
    ])
    expect(JSON.parse(output()).receipt.agentId).toBe('pixel')
  })
})
