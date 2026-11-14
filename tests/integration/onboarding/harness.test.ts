/**
 * The onboarding harness, tested: it runs the real CLI in a closed
 * environment, and the teeth below prove each isolation claim bites.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { createServer } from 'http'
import { join } from 'path'

import {
  assertIsolated,
  createOnboardingHome,
  diffTrees,
  expectedGap,
  isUnchanged,
  runBakin,
  runCommand,
  runScript,
  snapshotTree,
  trackHomes,
  type OnboardingHome,
} from './harness'

const PROBE = join(import.meta.dir, 'probe-resolvers.ts')
const CHILD_TIMEOUT = 60_000
const TEST_TIMEOUT = 90_000

interface ProbeOutput {
  paths: Record<string, string>
  envKeys: string[]
  env: { BAKIN_URL: string | null; HARNESS_PLANTED: string | null }
}

// Scenarios use trackHomes(): isolation is asserted for every home after
// every test. The teeth below build homes by hand because they breach on
// purpose and inspect the record themselves.
const homes = trackHomes()
const breachedHomes: OnboardingHome[] = []
async function breachableHome(): Promise<OnboardingHome> {
  const home = await createOnboardingHome()
  breachedHomes.push(home)
  return home
}

afterEach(async () => {
  for (const home of breachedHomes.splice(0)) {
    await home.cleanup()
    expect(existsSync(home.root)).toBe(false)
  }
  await homes.finish()
})

async function probe(home: OnboardingHome, options: Parameters<typeof runScript>[3] = {}): Promise<ProbeOutput> {
  const result = await runScript(home, PROBE, [], { timeoutMs: CHILD_TIMEOUT, ...options })
  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  return result.json as ProbeOutput
}

function outsideTree(home: OnboardingHome, paths: Record<string, string>): Array<[string, string]> {
  return Object.entries(paths).filter(([, path]) => path !== home.root && !path.startsWith(`${home.root}/`))
}

/** Write a one-off child script into the home and run it under the closed env. */
async function runInline(home: OnboardingHome, source: string) {
  const script = join(home.root, `inline-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`)
  writeFileSync(script, source)
  return runScript(home, script, [], { timeoutMs: CHILD_TIMEOUT })
}

describe('onboarding harness: running the CLI', () => {
  test('runs the real CLI and returns parsed output and an exit code', async () => {
    const home = await homes.create()
    const result = await runBakin(home, ['onboard', '--check', '--json'], { timeoutMs: CHILD_TIMEOUT })
    expect(result.timedOut).toBe(false)
    expect(typeof result.exitCode).toBe('number')
    expect(result.jsonLines.length).toBeGreaterThan(0)
    expect(result.jsonLines.map((line) => line.component)).toContain('mkdir')
  }, TEST_TIMEOUT)

  test('the deadline kills a child that does not exit', async () => {
    const home = await homes.create()
    const script = join(home.root, 'hang.ts')
    writeFileSync(script, 'setInterval(() => {}, 1000)\n')
    const result = await runScript(home, script, [], { timeoutMs: 1_500 })
    expect(result.timedOut).toBe(true)
    expect(result.signal).toBe('SIGKILL')
  }, TEST_TIMEOUT)

  test('snapshots see added, changed and removed files and ignore logs', async () => {
    const home = await homes.create()
    mkdirSync(join(home.bakinHome, 'logs'), { recursive: true })
    writeFileSync(join(home.bakinHome, 'keep.txt'), 'a')
    writeFileSync(join(home.bakinHome, 'gone.txt'), 'a')
    const before = snapshotTree(home.bakinHome)
    expect(isUnchanged(diffTrees(before, snapshotTree(home.bakinHome)))).toBe(true)

    writeFileSync(join(home.bakinHome, 'logs', 'server.log'), 'noise')
    expect(isUnchanged(diffTrees(before, snapshotTree(home.bakinHome)))).toBe(true)

    writeFileSync(join(home.bakinHome, 'keep.txt'), 'b')
    writeFileSync(join(home.bakinHome, 'new.txt'), 'a')
    mkdirSync(join(home.bakinHome, 'empty-dir'))
    rmSync(join(home.bakinHome, 'gone.txt'))
    const diff = diffTrees(before, snapshotTree(home.bakinHome))
    expect(diff.added).toEqual(['empty-dir/', 'new.txt'])
    expect(diff.changed).toEqual(['keep.txt'])
    expect(diff.removed).toEqual(['gone.txt'])
  })
})

describe('onboarding harness: closed environment', () => {
  test('every resolver answers inside the throwaway tree', async () => {
    const home = await homes.create()
    const out = await probe(home)
    expect(outsideTree(home, out.paths)).toEqual([])
    expect(out.paths.contentDir).toBe(home.bakinHome)
    expect(out.paths.piHome).toBe(home.piHome)
    expect(out.paths.openclawHome).toBe(home.openclawHome)
    expect(out.paths.searchHome).toBe(home.searchHome)
    expect(out.paths.homedir).toBe(home.userHome)
  }, TEST_TIMEOUT)

  test('teeth: a resolver pointed outside the tree is caught by the containment check', async () => {
    const home = await homes.create()
    const out = await probe(home, { env: { PI_HOME: '/nonexistent-outside-the-tree' } })
    expect(outsideTree(home, out.paths)).toEqual([['piHome', '/nonexistent-outside-the-tree']])
  }, TEST_TIMEOUT)

  test('the child sees only the allowlisted environment', async () => {
    // The suite preload forces BAKIN_URL for every test process; the child
    // must not inherit it (onboarding refuses to run when it is set).
    expect(process.env.BAKIN_URL).toBeTruthy()
    const home = await homes.create()
    const out = await probe(home)
    expect(out.env.BAKIN_URL).toBeNull()
    expect(out.envKeys.filter((key) => !(key in home.env))).toEqual([])
  }, TEST_TIMEOUT)

  test('a dotenv file in the working directory does not reach the child', async () => {
    const home = await homes.create()
    const cwd = join(home.root, 'cwd')
    mkdirSync(cwd)
    writeFileSync(join(cwd, '.env'), 'HARNESS_PLANTED=from-dotenv\nBAKIN_URL=http://127.0.0.1:1\n')
    const out = await probe(home, { cwd })
    expect(out.env.HARNESS_PLANTED).toBeNull()
    expect(out.env.BAKIN_URL).toBeNull()
  }, TEST_TIMEOUT)

  test('teeth: without --no-env-file the same dotenv file DOES reach the child', async () => {
    const home = await homes.create()
    const cwd = join(home.root, 'cwd')
    mkdirSync(cwd)
    writeFileSync(join(cwd, '.env'), 'HARNESS_PLANTED=from-dotenv\n')
    const out = await probe(home, { cwd, bunArgs: [] })
    expect(out.env.HARNESS_PLANTED).toBe('from-dotenv')
  }, TEST_TIMEOUT)
})

describe('onboarding harness: supervisor shims', () => {
  test('a quiet child leaves both records empty', async () => {
    const home = await homes.create()
    await runInline(home, 'console.log("quiet")\n')
    expect(home.violations()).toEqual({ commands: [], network: [] })
    expect(() => assertIsolated(home)).not.toThrow()
  }, TEST_TIMEOUT)

  test.each(['launchctl', 'systemctl'])('teeth: a child that runs %s is recorded and refused', async (command) => {
    const home = await breachableHome()
    const result = await runCommand(home, command, ['print', 'gui/501/io.bakin.antfly'])
    expect(result.exitCode).toBe(1)
    expect(home.violations().commands).toEqual([`${command} print gui/501/io.bakin.antfly`])
    expect(() => assertIsolated(home)).toThrow(/supervisor command/)
  }, TEST_TIMEOUT)

  test('teeth: the app resolves the shim, not the real supervisor', async () => {
    const home = await breachableHome()
    const result = await runInline(home, [
      'const found = Bun.which("launchctl")',
      'Bun.spawnSync(["launchctl", "list"])',
      'console.log(JSON.stringify({ found }))',
    ].join('\n'))
    expect((result.json as { found: string }).found).toBe(join(home.binDir, 'launchctl'))
    expect(home.violations().commands).toEqual(['launchctl list'])
  }, TEST_TIMEOUT)
})

describe('onboarding harness: network', () => {
  test('teeth: an outside http fetch is recorded and denied', async () => {
    const home = await breachableHome()
    const result = await runInline(home, 'const res = await fetch("http://outside.invalid/path"); console.log(JSON.stringify({ status: res.status }))\n')
    expect((result.json as { status: number }).status).toBe(403)
    expect(home.violations().network).toEqual(['GET http://outside.invalid/path'])
    expect(() => assertIsolated(home)).toThrow(/outside request/)
  }, TEST_TIMEOUT)

  test('teeth: an outside https fetch is recorded even though the child swallows the failure', async () => {
    const home = await breachableHome()
    const result = await runInline(home, 'try { await fetch("https://outside.invalid/") } catch { /* swallowed, as app code may */ }\n')
    expect(result.exitCode).toBe(0)
    expect(home.violations().network).toEqual(['CONNECT outside.invalid:443'])
  }, TEST_TIMEOUT)

  test('teeth: another service on this machine is not exempt', async () => {
    const home = await breachableHome()
    await runInline(home, 'try { await fetch("http://127.0.0.1:9/unrelated") } catch { /* refused */ }\n')
    expect(home.violations().network).toEqual(['GET http://127.0.0.1:9/unrelated'])
  }, TEST_TIMEOUT)

  test('blackholed product defaults are denied but are not a breach; anything else still is', async () => {
    const home = await breachableHome()
    home.blackholeProductDefaults()
    const result = await runInline(home, [
      'const gateway = await fetch("http://127.0.0.1:18789/health")',
      'const search = await fetch("http://127.0.0.1:3738/db/v1/tables")',
      'await fetch("http://outside.invalid/")',
      'console.log(JSON.stringify({ gateway: gateway.status, search: search.status }))',
    ].join('\n'))
    // Denied by the proxy: neither request reached a real service.
    expect(result.json).toEqual({ gateway: 403, search: 403 })
    expect(home.deniedRequests()).toEqual([
      'GET http://127.0.0.1:18789/health',
      'GET http://127.0.0.1:3738/db/v1/tables',
      'GET http://outside.invalid/',
    ])
    expect(home.violations().network).toEqual(['GET http://outside.invalid/'])
  }, TEST_TIMEOUT)

  test('a request aimed at the proxy\'s own port is a stray, not a breach: it reached nothing outside', async () => {
    const home = await homes.create()
    // What a client with a stale target does when its port was recycled into this proxy:
    // a direct request with a bare path, never proxied.
    // Real HTTP: the test preload replaces global fetch with a browser emulation.
    const realFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
    const res = await realFetch(`${home.proxyUrl}/api/channels`)
    expect(res.status).toBe(403)
    expect(home.strayRequests()).toEqual(['GET /api/channels'])
    expect(home.violations().network).toEqual([])
    expect(() => assertIsolated(home)).not.toThrow()
  }, TEST_TIMEOUT)

  test('a declared fixture endpoint is reached directly and not recorded', async () => {
    const home = await homes.create()
    const server = createServer((_req, res) => { res.end('fixture') })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      home.allowEndpoint(`127.0.0.1:${port}`)
      const result = await runInline(home, `const res = await fetch("http://127.0.0.1:${port}/"); console.log(JSON.stringify({ status: res.status, body: await res.text() }))\n`)
      expect(result.json).toEqual({ status: 200, body: 'fixture' })
      expect(home.violations().network).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }, TEST_TIMEOUT)

  test.each([
    ['https', 'https://outside.invalid/repo.git'],
    ['ssh', 'ssh://git@outside.invalid/repo.git'],
    ['scp-style ssh', 'git@outside.invalid:repo.git'],
    ['git', 'git://outside.invalid/repo.git'],
  ])('teeth: git refuses a clone over %s', async (_label, url) => {
    const home = await homes.create()
    const target = join(home.root, 'cloned')
    const result = await runCommand(home, 'git', ['clone', url, target], { timeoutMs: 20_000 })
    expect(result.timedOut).toBe(false)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/not allowed/)
    expect(existsSync(join(target, '.git'))).toBe(false)
  }, TEST_TIMEOUT)

  test('git still clones a local repository', async () => {
    const home = await homes.create()
    const source = join(home.root, 'source-repo')
    mkdirSync(source)
    for (const args of [['init', '-q'], ['-c', 'user.name=h', '-c', 'user.email=h@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']]) {
      const made = await runCommand(home, 'git', args, { cwd: source })
      expect(made.stderr).toBe('')
      expect(made.exitCode).toBe(0)
    }
    const result = await runCommand(home, 'git', ['clone', '-q', source, join(home.root, 'cloned')])
    expect(result.exitCode).toBe(0)
    expect(existsSync(join(home.root, 'cloned', '.git'))).toBe(true)
  }, TEST_TIMEOUT)
})

describe('onboarding harness: pinned gaps', () => {
  test('a body that fails, with no breach, is the expected gap', async () => {
    const tracker = trackHomes()
    await expect(expectedGap(tracker, async () => {
      await tracker.create()
      throw new Error('the gap')
    })()).resolves.toBeUndefined()
  }, TEST_TIMEOUT)

  test('teeth: a breach inside an expected-failure body still fails', async () => {
    const tracker = trackHomes()
    let root = ''
    await expect(expectedGap(tracker, async () => {
      const home = await tracker.create()
      root = home.root
      await runCommand(home, 'launchctl', ['print', 'gui/0/teeth'])
      throw new Error('the gap')
    })()).rejects.toThrow(/isolation breach[\s\S]*supervisor command: launchctl print gui\/0\/teeth/)
    expect(existsSync(root)).toBe(false)
  }, TEST_TIMEOUT)

  test('teeth: a pinned gap whose body passes fails, so a fix cannot leave it pinned', async () => {
    const tracker = trackHomes()
    await expect(expectedGap(tracker, async () => {
      await tracker.create()
    })()).rejects.toThrow(/now passes/)
  }, TEST_TIMEOUT)
})
