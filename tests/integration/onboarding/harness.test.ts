/**
 * The onboarding harness, tested: it runs the real CLI in a closed
 * environment, and the teeth below prove each isolation claim bites.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import {
  createOnboardingHome,
  diffTrees,
  isUnchanged,
  runBakin,
  runScript,
  snapshotTree,
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

const homes: OnboardingHome[] = []
function newHome(): OnboardingHome {
  const home = createOnboardingHome()
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    home.cleanup()
    expect(existsSync(home.root)).toBe(false)
  }
})

async function probe(home: OnboardingHome, options: Parameters<typeof runScript>[3] = {}): Promise<ProbeOutput> {
  const result = await runScript(home, PROBE, [], { timeoutMs: CHILD_TIMEOUT, ...options })
  expect(result.stderr).toBe('')
  expect(result.exitCode).toBe(0)
  return result.json as ProbeOutput
}

describe('onboarding harness', () => {
  test('runs the real CLI and returns parsed output and an exit code', async () => {
    const home = newHome()
    const result = await runBakin(home, ['onboard', '--check', '--json'], { timeoutMs: CHILD_TIMEOUT })
    expect(result.timedOut).toBe(false)
    expect(typeof result.exitCode).toBe('number')
    expect(result.jsonLines.length).toBeGreaterThan(0)
    for (const line of result.jsonLines) expect(typeof line).toBe('object')
  }, TEST_TIMEOUT)

  test('every resolver answers inside the throwaway tree', async () => {
    const home = newHome()
    const out = await probe(home)
    const outside = Object.entries(out.paths).filter(([, path]) => path !== home.root && !path.startsWith(`${home.root}/`))
    expect(outside).toEqual([])
    expect(out.paths.contentDir).toBe(home.bakinHome)
    expect(out.paths.piHome).toBe(home.piHome)
    expect(out.paths.openclawHome).toBe(home.openclawHome)
    expect(out.paths.searchHome).toBe(home.searchHome)
    expect(out.paths.homedir).toBe(home.userHome)
  }, TEST_TIMEOUT)

  test('the child sees only the allowlisted environment', async () => {
    // The suite preload forces BAKIN_URL for every test process; the child
    // must not inherit it (onboarding refuses to run when it is set).
    expect(process.env.BAKIN_URL).toBeTruthy()
    const home = newHome()
    const out = await probe(home)
    expect(out.env.BAKIN_URL).toBeNull()
    const unexpected = out.envKeys.filter((key) => !(key in home.env))
    expect(unexpected).toEqual([])
  }, TEST_TIMEOUT)

  test('a dotenv file in the working directory does not reach the child', async () => {
    const home = newHome()
    const cwd = join(home.root, 'cwd')
    mkdirSync(cwd)
    writeFileSync(join(cwd, '.env'), 'HARNESS_PLANTED=from-dotenv\nBAKIN_URL=http://127.0.0.1:1\n')
    const out = await probe(home, { cwd })
    expect(out.env.HARNESS_PLANTED).toBeNull()
    expect(out.env.BAKIN_URL).toBeNull()
  }, TEST_TIMEOUT)

  test('teeth: without --no-env-file the same dotenv file DOES reach the child', async () => {
    const home = newHome()
    const cwd = join(home.root, 'cwd')
    mkdirSync(cwd)
    writeFileSync(join(cwd, '.env'), 'HARNESS_PLANTED=from-dotenv\n')
    const out = await probe(home, { cwd, bunArgs: [] })
    expect(out.env.HARNESS_PLANTED).toBe('from-dotenv')
  }, TEST_TIMEOUT)

  test('teeth: a resolver pointed outside the tree is caught by the containment check', async () => {
    const home = newHome()
    const out = await probe(home, { env: { PI_HOME: '/nonexistent-outside-the-tree' } })
    const outside = Object.entries(out.paths).filter(([, path]) => path !== home.root && !path.startsWith(`${home.root}/`))
    expect(outside).toEqual([['piHome', '/nonexistent-outside-the-tree']])
  }, TEST_TIMEOUT)

  test('the deadline kills a child that does not exit', async () => {
    const home = newHome()
    const script = join(home.root, 'hang.ts')
    writeFileSync(script, 'setInterval(() => {}, 1000)\n')
    const result = await runScript(home, script, [], { timeoutMs: 1_500 })
    expect(result.timedOut).toBe(true)
    expect(result.signal).toBe('SIGKILL')
  }, TEST_TIMEOUT)

  test('snapshots see added, changed and removed files and ignore logs', () => {
    const home = newHome()
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
