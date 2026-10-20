import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { gitArgs } from '@bakin/core/net/git-args'

export interface AsyncGitRunner {
  /** Run `git <args>` and return stdout; throw on non-zero exit. An aborted `signal` kills the child and rejects with its reason. */
  (args: string[], opts?: { signal?: AbortSignal }): Promise<string>
}

/** The abort reason as an Error. */
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(typeof signal.reason === 'string' ? signal.reason : 'aborted')
}

/** `promise`, or the signal's rejection — whichever settles first; the listener never outlives the wait. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError(signal))
  let onAbort: (() => void) | null = null
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([promise, aborted]).finally(() => { if (onAbort) signal.removeEventListener('abort', onAbort) })
}

export interface CachedGithubCheckout {
  checkoutDir: string
  commitSha: string
}

interface CacheEntry {
  createdAt: number
  promise: Promise<CachedGithubCheckout>
}

const CACHE_TTL_MS = 5 * 60 * 1000

let cacheRoot: string | null = null
const cache = new Map<string, CacheEntry>()

// Foreground-only git (#978): cached checkouts are swept by TTL.
const realGitAsync: AsyncGitRunner = (args, opts = {}) => new Promise((resolvePromise, reject) => {
  const { signal } = opts
  if (signal?.aborted) { reject(abortError(signal)); return }
  const child = spawn('git', gitArgs(args), { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  const onAbort = (): void => { child.kill() }
  signal?.addEventListener('abort', onAbort, { once: true })

  child.stdout.setEncoding('utf-8')
  child.stderr.setEncoding('utf-8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', (err) => { signal?.removeEventListener('abort', onAbort); reject(err) })
  child.on('close', code => {
    signal?.removeEventListener('abort', onAbort)
    if (signal?.aborted) { reject(abortError(signal)); return }
    if (code === 0) {
      resolvePromise(stdout)
      return
    }
    reject(new Error(stderr.trim() || `git ${args.join(' ')} exited with code ${code}`))
  })
})

function getCacheRoot(): string {
  if (!cacheRoot) cacheRoot = mkdtempSync(join(tmpdir(), 'bakin-github-source-cache-'))
  return cacheRoot
}

function cacheKey(cloneUrl: string, ref: string): string {
  return `${cloneUrl}\0${ref}`
}

function formatGitError(err: unknown): string {
  if (err instanceof Error) return err.message.trim()
  return String(err).trim()
}

async function cloneIntoCache(
  cloneUrl: string,
  ref: string,
  git: AsyncGitRunner,
  signal?: AbortSignal,
): Promise<CachedGithubCheckout> {
  const checkoutDir = join(getCacheRoot(), randomUUID())
  const run = (args: string[]): Promise<string> => git(args, { signal })

  try {
    if (ref) {
      try {
        await run(['clone', '--depth', '1', '--branch', ref, '--', cloneUrl, checkoutDir])
      } catch (firstErr) {
        if (signal?.aborted) throw firstErr
        rmSync(checkoutDir, { recursive: true, force: true })
        await run(['clone', '--no-checkout', '--', cloneUrl, checkoutDir])
        try {
          await run(['-C', checkoutDir, 'checkout', '--detach', ref])
        } catch (fallbackErr) {
          if (signal?.aborted) throw fallbackErr
          const detail = formatGitError(fallbackErr) || formatGitError(firstErr)
          throw new Error(`failed to clone ${cloneUrl} at ref "${ref}": ${detail}`)
        }
      }
    } else {
      await run(['clone', '--depth', '1', '--', cloneUrl, checkoutDir])
    }

    const commitSha = (await run(['-C', checkoutDir, 'rev-parse', 'HEAD'])).trim().toLowerCase()
    return { checkoutDir, commitSha }
  } catch (err) {
    rmSync(checkoutDir, { recursive: true, force: true })
    throw err
  }
}

export async function getCachedGithubCheckout(args: {
  cloneUrl: string
  ref?: string
  git?: AsyncGitRunner
  /** Aborting stops THIS caller's wait and kills a clone it started; a clone other callers share keeps running for them. */
  signal?: AbortSignal
  /** Ignore a cached checkout and clone again (the caller knows the ref moved past it). */
  fresh?: boolean
}): Promise<CachedGithubCheckout> {
  const ref = args.ref?.trim() ?? ''
  const key = cacheKey(args.cloneUrl, ref)
  const now = Date.now()
  const existing = args.fresh ? undefined : cache.get(key)
  if (existing && now - existing.createdAt < CACHE_TTL_MS) {
    return await abortable(existing.promise, args.signal)
  }

  const promise = cloneIntoCache(args.cloneUrl, ref, args.git ?? realGitAsync, args.signal)
  cache.set(key, { createdAt: now, promise })
  try {
    return await promise
  } catch (err) {
    if (cache.get(key)?.promise === promise) cache.delete(key)
    throw err
  }
}

function resolveSubpath(checkoutDir: string, subpath: string): string {
  const checkoutRoot = resolve(checkoutDir)
  const subpathDir = resolve(checkoutDir, subpath)
  if (subpathDir !== checkoutRoot && !subpathDir.startsWith(checkoutRoot + sep)) {
    throw new Error(`Github source subpath "${subpath}" escapes the cloned repository`)
  }
  if (!existsSync(subpathDir) || !statSync(subpathDir).isDirectory()) {
    throw new Error(`Github source subpath "${subpath}" not found in repository`)
  }
  return subpathDir
}

export async function materializeCachedGithubSource(args: {
  cloneUrl: string
  ref?: string
  stagingDir: string
  subpath?: string
  git?: AsyncGitRunner
  signal?: AbortSignal
  fresh?: boolean
}): Promise<CachedGithubCheckout> {
  const checkout = await getCachedGithubCheckout({
    cloneUrl: args.cloneUrl,
    ref: args.ref,
    git: args.git,
    signal: args.signal,
    fresh: args.fresh,
  })
  const sourceDir = args.subpath
    ? resolveSubpath(checkout.checkoutDir, args.subpath)
    : checkout.checkoutDir

  rmSync(args.stagingDir, { recursive: true, force: true })
  mkdirSync(args.stagingDir, { recursive: true })
  cpSync(sourceDir, args.stagingDir, { recursive: true, dereference: false })
  return checkout
}

export function resetGithubSourceCacheForTests(): void {
  cache.clear()
  if (cacheRoot) {
    rmSync(cacheRoot, { recursive: true, force: true })
    cacheRoot = null
  }
}
