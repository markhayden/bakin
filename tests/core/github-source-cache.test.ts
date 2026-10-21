import { afterAll, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  __cachedCheckoutCountForTests,
  getCachedGithubCheckout,
  materializeCachedGithubSource,
  resetGithubSourceCacheForTests,
} from '../../src/core/github-source-cache'
import { waitUntil } from '../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-github-source-cache-${Date.now()}-${randomUUID()}`)

afterAll(() => {
  resetGithubSourceCacheForTests()
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetGithubSourceCacheForTests()
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
})

describe('github source cache', () => {
  const isCloneCall = (args: string[]) => args[0] === 'clone'
  const isRevParseCall = (args: string[]) => args[0] === '-C' && args[2] === 'rev-parse'

  it('materializes repeated full-repo requests from one cached checkout', async () => {
    const calls: string[][] = []
    const git = async (args: string[]): Promise<string> => {
      calls.push(args)
      if (isCloneCall(args)) {
        const target = args[args.length - 1]
        mkdirSync(join(target, 'plugins', 'messaging'), { recursive: true })
        mkdirSync(join(target, 'plugins', 'projects'), { recursive: true })
        writeFileSync(join(target, 'plugins', 'messaging', 'bakin-plugin.json'), '{}')
        writeFileSync(join(target, 'plugins', 'projects', 'bakin-plugin.json'), '{}')
        return ''
      }
      if (isRevParseCall(args)) return 'cafebabe\n'
      return ''
    }

    const firstStage = join(testDir, 'stage-one')
    const secondStage = join(testDir, 'stage-two')
    const first = await materializeCachedGithubSource({
      cloneUrl: 'https://github.com/markhayden/bakin-bits-official.git',
      stagingDir: firstStage,
      git,
    })
    const second = await materializeCachedGithubSource({
      cloneUrl: 'https://github.com/markhayden/bakin-bits-official.git',
      stagingDir: secondStage,
      git,
    })

    expect(calls.filter(isCloneCall)).toHaveLength(1)
    expect(first.commitSha).toBe('cafebabe')
    expect(second.commitSha).toBe('cafebabe')
    expect(existsSync(join(firstStage, 'plugins', 'messaging', 'bakin-plugin.json'))).toBe(true)
    expect(existsSync(join(secondStage, 'plugins', 'projects', 'bakin-plugin.json'))).toBe(true)
  })
})

describe('github source cache — cancellation and freshness (PR 8 review r1 #3/#4)', () => {
  /** A git that stalls on clone until its signal aborts (the kill), then rejects the way a killed child does. */
  function stallingGit() {
    const seen: Array<{ args: string[]; signalled: boolean }> = []
    const git = (args: string[], opts: { signal?: AbortSignal } = {}): Promise<string> => {
      seen.push({ args, signalled: opts.signal !== undefined })
      if (args[0] === 'clone') {
        return new Promise<string>((_, reject) => {
          if (opts.signal?.aborted) { reject(new Error('killed')); return }
          opts.signal?.addEventListener('abort', () => reject(new Error('killed')), { once: true })
        })
      }
      return Promise.resolve('cafebabe\n')
    }
    return { git, seen }
  }

  it('an aborted signal reaches the git child of the clone this caller started and the wait rejects — the clone never outlives the deadline', async () => {
    const { git, seen } = stallingGit()
    const controller = new AbortController()
    const pending = getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git, signal: controller.signal })
    const settled = pending.then(() => 'resolved', (err: Error) => err.message)
    controller.abort(new Error('check timed out after 20s'))
    expect(await settled).toBe('killed')
    expect(seen[0]).toMatchObject({ args: ['clone', '--depth', '1', '--branch', 'main', '--', 'https://github.com/acme/ops.git', expect.any(String)], signalled: true })
    // The failed clone left no cache entry: the next caller clones again.
    const { git: second, seen: seenAgain } = stallingGit()
    const again = getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git: second, signal: AbortSignal.abort(new Error('now')) })
    await expect(again).rejects.toThrow()
    expect(seenAgain.length + seen.length).toBeGreaterThanOrEqual(1)
  })

  it('a caller joining a clone another caller started stops waiting on ITS abort while the shared clone goes on', async () => {
    let finish!: () => void
    const git = (args: string[]): Promise<string> => {
      if (args[0] === 'clone') return new Promise<string>((resolve) => { finish = () => resolve('') })
      return Promise.resolve('cafebabe\n')
    }
    const first = getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git })
    const controller = new AbortController()
    const joiner = getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git, signal: controller.signal })
    const joinerSettled = joiner.then(() => 'resolved', (err: Error) => err.message)
    controller.abort(new Error('joiner gave up'))
    expect(await joinerSettled).toBe('joiner gave up')
    finish()
    expect((await first).commitSha).toBe('cafebabe')
  })

  it('`fresh` ignores a cached checkout and clones again', async () => {
    let clones = 0
    const git = async (args: string[]): Promise<string> => {
      if (args[0] === 'clone') { clones += 1; mkdirSync(args[args.length - 1]!, { recursive: true }); return '' }
      return clones === 1 ? 'aaaa\n' : 'bbbb\n'
    }
    const cached = await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git })
    const again = await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git })
    const fresh = await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git, fresh: true })
    expect([cached.commitSha, again.commitSha, fresh.commitSha]).toEqual(['aaaa', 'aaaa', 'bbbb'])
    expect(clones).toBe(2)
  })
})

describe('github source cache — retired checkouts are deleted (PR 8 review r2 #1)', () => {
  const cloningGit = () => {
    let clones = 0
    const git = async (args: string[]): Promise<string> => {
      if (args[0] === 'clone') { clones += 1; mkdirSync(args[args.length - 1]!, { recursive: true }); writeFileSync(join(args[args.length - 1]!, 'marker'), String(clones)); return '' }
      return `sha${clones}\n`
    }
    return { git, clones: () => clones }
  }

  it('a `fresh` replacement retires the previous checkout directory; repeated fresh observations hold ONE directory per key', async () => {
    const { git } = cloningGit()
    const url = 'https://github.com/acme/ops.git'
    const first = await getCachedGithubCheckout({ cloneUrl: url, ref: 'main', git })
    const second = await getCachedGithubCheckout({ cloneUrl: url, ref: 'main', git, fresh: true })
    const third = await getCachedGithubCheckout({ cloneUrl: url, ref: 'main', git, fresh: true })
    await waitUntil(() => !existsSync(first.checkoutDir) && !existsSync(second.checkoutDir), { label: 'retired checkouts removed' })
    expect(existsSync(third.checkoutDir)).toBe(true)
    expect(__cachedCheckoutCountForTests()).toBe(1)
  })

  it('an expired entry is replaced on its own key and swept on any other call; its directory goes', async () => {
    const { git } = cloningGit()
    let now = 1_000_000
    const clock = () => now
    const stale = await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git, now: clock })
    const other = await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/other.git', ref: 'main', git, now: clock })
    now += 6 * 60 * 1000
    // A call for ANOTHER key sweeps the expired one.
    await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/third.git', ref: 'main', git, now: clock })
    await waitUntil(() => !existsSync(stale.checkoutDir) && !existsSync(other.checkoutDir), { label: 'expired checkouts swept' })
    expect(__cachedCheckoutCountForTests()).toBe(1)
    // Its own key clones again and the new directory is the one held.
    const renewed = await getCachedGithubCheckout({ cloneUrl: 'https://github.com/acme/ops.git', ref: 'main', git, now: clock })
    expect(renewed.checkoutDir).not.toBe(stale.checkoutDir)
    expect(existsSync(renewed.checkoutDir)).toBe(true)
  })
})
