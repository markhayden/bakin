/**
 * `bakin packages install` consent and source resolution: the consent
 * screen names everything the pack declares (pinned binaries, logins) read
 * from the SAME absolute path the server installs from, the prompt asks
 * once, and every local install verb sends the server an absolute path —
 * the server's working directory is not the operator's.
 */
import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
// Load ink (and its layout wasm) before the harness replaces fetch.
import 'ink'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'
import { TEST_BOOT_ID, finishedOperation } from '../helpers/operation-fetch'

const testDir = join(tmpdir(), `bakin-test-pkg-consent-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

// The operator's answer to every y/N question, and each question as asked.
let answer = 'n'
const questions: string[] = []
mock.module('node:readline/promises', () => ({
  createInterface: () => ({
    question: async (q: string) => { questions.push(q); return answer },
    close: () => {},
  }),
}))

const harness = setupTtyCliHarness({ defaultIsTTY: true })
const { fetchMock, output } = harness

const sha = 'a'.repeat(64)
const install = Object.fromEntries(['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'].map((k) => [
  k, { url: 'https://downloads.example.com/tool.tar.gz', sha256: sha, archive: { format: 'tar.gz', member: 'tool', extractedSha256: sha } },
]))
const packDir = join(testDir, 'packs', 'demo-pack')
mkdirSync(packDir, { recursive: true })
writeFileSync(join(packDir, 'bakin-package.json'), JSON.stringify({
  id: 'demo-pack', kind: 'skill-pack', name: 'Demo Pack', version: '1.2.0', description: 'Lets agents use the demo tool.',
  capability: 'demo', runtimes: ['*'],
  contributions: { skills: ['skills/demo'] },
  requires: {
    bins: [{ name: 'tool', version: '3.1.0', install, verifyArgs: ['--version'] }],
    login: [{ name: 'Demo account', probe: ['tool', 'auth', 'status'], setup: 'tool auth login', help: 'https://example.com/help' }],
  },
}))
const workDir = join(testDir, 'work')
// macOS tmp is a symlink; the CLI resolves against the real cwd.
const realWork = () => process.cwd()
mkdirSync(workDir, { recursive: true })

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

let stderrSpy: ReturnType<typeof spyOn> | undefined
beforeEach(() => {
  answer = 'n'
  questions.length = 0
  stderrSpy?.mockRestore()
  stderrSpy = spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write)
})

const real = (payload: unknown, status: number) => new Response(JSON.stringify(payload), { status })
function queueOperation(id: string, body: unknown): void {
  fetchMock.mockResolvedValueOnce(real({ operationId: id, bootId: TEST_BOOT_ID }, 202))
  fetchMock.mockResolvedValueOnce(real({ bootId: TEST_BOOT_ID, operation: finishedOperation(id, { httpStatus: 200, body }), children: [] }, 200))
  fetchMock.mockResolvedValueOnce(real({ error: 'unavailable' }, 503))
}
function startedBodies(path: string): unknown[] {
  return fetchMock.mock.calls
    .filter(([url, init]) => new URL(String(url)).pathname === path && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

async function run(...args: string[]): Promise<void> {
  const { main } = await import('../../cli/bakin')
  process.argv = ['bun', 'cli/bakin.ts', ...args]
  await main()
}

describe('bakin packages install consent', () => {
  it('a relative path from another folder reads the right manifest and asks once', async () => {
    process.chdir(workDir)
    await run('packages', 'install', '../packs/demo-pack')
    const screen = output()
    expect(screen).toContain('Install Demo Pack')
    expect(screen).toContain('tool 3.1.0')
    expect(screen).toContain('downloads.example.com')
    expect(screen).toContain('tool auth status')
    // The pack's own binary lives in Bakin's bin dir, not on the operator's PATH.
    expect(screen).toContain(`Log in with: ${join(testDir, 'bin', 'tool')} auth login`)
    expect(questions).toHaveLength(1)
    expect(questions[0]!.match(/\[y\/N\]/g)).toHaveLength(1)
    expect(screen).toContain('Aborted — nothing installed.')
    expect(startedBodies('/api/packages/install')).toEqual([])
  })

  it('an accepted install sends the absolute path the consent screen read', async () => {
    process.chdir(workDir)
    answer = 'y'
    queueOperation('op-install', { ok: true, result: { packageId: 'demo-pack' } })
    await run('packages', 'install', '../packs/demo-pack')
    expect(startedBodies('/api/packages/install')).toEqual([{ source: resolve(realWork(), '../packs/demo-pack') }])
  })

  it('an unreadable manifest is said on the consent screen, never silently dropped', async () => {
    process.chdir(workDir)
    await run('packages', 'install', './no-such-pack')
    expect(output()).toContain('Could not read the manifest')
  })

  it('a remote source says its requirements are listed after install', async () => {
    await run('packages', 'install', 'github:x/y')
    expect(output()).toContain('listed after install')
  })
})

describe('local install sources resolve against the operator\'s folder', () => {
  it('agents install sends an absolute path', async () => {
    process.chdir(workDir)
    queueOperation('op-agent', { ok: true, result: { packageId: 'pixel', kind: 'agent' } })
    await run('agents', 'install', './pixel', '--json')
    expect(startedBodies('/api/agent-packages/install')).toEqual([{ source: resolve(realWork(), 'pixel') }])
  })

  it('a catalog name and a github ref pass through unchanged', async () => {
    queueOperation('op-a', { ok: true, result: { packageId: 'web-search' } })
    await run('packages', 'install', 'web-search', '--json')
    queueOperation('op-b', { ok: true, result: { packageId: 'y' } })
    await run('packages', 'install', 'github:x/y', '--json')
    expect(startedBodies('/api/packages/install')).toEqual([{ source: 'web-search' }, { source: 'github:x/y' }])
  })
})
