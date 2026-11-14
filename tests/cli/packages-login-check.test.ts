/**
 * `bakin packages login-check <id>` — the operator's explicit login trigger
 * (spec provider-integrations §4.1, plan 1.4c): prints one line per receipt,
 * exits 1 unless every login is ok.
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness, jsonResponse } from './helpers/tty-cli-harness'

const testDir = join(tmpdir(), `bakin-test-login-check-cli-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const { fetchMock, output } = setupTtyCliHarness({ defaultIsTTY: false })

async function run(...args: string[]): Promise<void> {
  const { main } = await import('../../cli/bakin')
  process.argv = ['bun', 'cli/bakin.ts', ...args]
  await main()
}

const receipt = (over: Record<string, unknown>) => ({ name: 'GitHub account (gh)', setup: 'gh auth login', checkedAt: '2026-11-13T10:00:00.000Z', status: 'ok', ...over })

describe('bakin packages login-check', () => {
  it('posts to the login-check route and prints the ok line', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, packId: 'github', key: 'github@1.1.0', receipts: [receipt({ account: 'markhayden' })] }))
    await run('packages', 'login-check', 'github')
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/login-check'))!
    expect(new URL(String(call[0])).pathname).toBe('/api/packages/github/login-check')
    expect((call[1] as RequestInit).method).toBe('POST')
    expect(output()).toContain('✓ GitHub account (gh): logged in as markhayden')
  })

  it('a missing login prints the setup command and exits 1', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, packId: 'github', key: 'github@1.1.0', receipts: [receipt({ status: 'missing', reason: 'exit' })] }))
    await expect(run('packages', 'login-check', 'github@1.1.0')).rejects.toThrow('exit:1')
    expect(output()).toContain('✗ GitHub account (gh): needs login — run: gh auth login')
  })

  it('--json prints the body and exits by status', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, packId: 'github', key: 'github@1.1.0', receipts: [receipt({ status: 'unknown', reason: 'timeout' })] }))
    await expect(run('packages', 'login-check', 'github', '--json')).rejects.toThrow('exit:1')
    expect(JSON.parse(output()).receipts[0].reason).toBe('timeout')
  })
})
