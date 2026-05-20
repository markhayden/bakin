import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { spawn } from 'child_process'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { randomUUID } from 'crypto'

export interface AsyncGitRunner {
  /** Run `git <args>` and return stdout; throw on non-zero exit. */
  (args: string[]): Promise<string>
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

const realGitAsync: AsyncGitRunner = (args) => new Promise((resolvePromise, reject) => {
  const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''

  child.stdout.setEncoding('utf-8')
  child.stderr.setEncoding('utf-8')
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', reject)
  child.on('close', code => {
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
): Promise<CachedGithubCheckout> {
  const checkoutDir = join(getCacheRoot(), randomUUID())

  try {
    if (ref) {
      try {
        await git(['clone', '--depth', '1', '--branch', ref, '--', cloneUrl, checkoutDir])
      } catch (firstErr) {
        rmSync(checkoutDir, { recursive: true, force: true })
        await git(['clone', '--no-checkout', '--', cloneUrl, checkoutDir])
        try {
          await git(['-C', checkoutDir, 'checkout', '--detach', ref])
        } catch (fallbackErr) {
          const detail = formatGitError(fallbackErr) || formatGitError(firstErr)
          throw new Error(`failed to clone ${cloneUrl} at ref "${ref}": ${detail}`)
        }
      }
    } else {
      await git(['clone', '--depth', '1', '--', cloneUrl, checkoutDir])
    }

    const commitSha = (await git(['-C', checkoutDir, 'rev-parse', 'HEAD'])).trim().toLowerCase()
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
}): Promise<CachedGithubCheckout> {
  const ref = args.ref?.trim() ?? ''
  const key = cacheKey(args.cloneUrl, ref)
  const now = Date.now()
  const existing = cache.get(key)
  if (existing && now - existing.createdAt < CACHE_TTL_MS) {
    return await existing.promise
  }

  const promise = cloneIntoCache(args.cloneUrl, ref, args.git ?? realGitAsync)
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
}): Promise<CachedGithubCheckout> {
  const checkout = await getCachedGithubCheckout({
    cloneUrl: args.cloneUrl,
    ref: args.ref,
    git: args.git,
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
