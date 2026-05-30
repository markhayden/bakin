/**
 * Bounded npm registry availability gate.
 *
 * Polls `npm view <pkg>@<version> version --json` until the exact version
 * resolves on the registry, using exponential backoff under a total deadline.
 * Exists to close the read-after-write propagation race between publishing a
 * package and installing it (e.g. the release `smoke-sdk` job's `bun add`).
 *
 * Resolves silently once the version is visible; throws (and exits non-zero)
 * on a real npm error or when the version is still unavailable at the deadline.
 */
import { resolve } from 'node:path'
import { PUBLIC_SDK_PACKAGE_NAME } from './build-sdk-package'
import {
  type CommandResult,
  type CommandRunner,
  npmViewArgs,
  runCommand,
  versionResolves,
} from './lib/npm-registry'

const REPO_ROOT = resolve(import.meta.dir, '..')
const RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/
// Hard cap per `npm view` so a stalled registry call can never hang the gate
// past its deadline; a killed call surfaces as status null → loud failure.
const NPM_VIEW_TIMEOUT_MS = 30_000

export { PUBLIC_SDK_PACKAGE_NAME }

export interface WaitOptions {
  package: string
  version: string
  timeoutMs: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface WaitDeps {
  runner?: CommandRunner
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

function realSleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export function parseArgs(argv: string[]): WaitOptions {
  let pkg = ''
  let version = ''
  let timeoutSeconds = 120
  let baseDelaySeconds = 2
  let maxDelaySeconds = 30

  const takeValue = (index: number, name: string): string => {
    const value = argv[index + 1] ?? ''
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return value
  }

  const takeSeconds = (index: number, name: string): number => {
    const value = Number(takeValue(index, name))
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number of seconds`)
    return value
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--package') {
      pkg = takeValue(i, '--package')
      i += 1
    } else if (arg === '--version') {
      version = takeValue(i, '--version')
      i += 1
    } else if (arg === '--timeout') {
      timeoutSeconds = takeSeconds(i, '--timeout')
      i += 1
    } else if (arg === '--base-delay') {
      baseDelaySeconds = takeSeconds(i, '--base-delay')
      i += 1
    } else if (arg === '--max-delay') {
      maxDelaySeconds = takeSeconds(i, '--max-delay')
      i += 1
    } else {
      throw new Error(`Unexpected argument: ${arg}`)
    }
  }

  if (!RELEASE_VERSION_RE.test(version)) {
    throw new Error('version must be MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N')
  }

  return {
    package: pkg || PUBLIC_SDK_PACKAGE_NAME,
    version,
    timeoutMs: timeoutSeconds * 1000,
    baseDelayMs: baseDelaySeconds * 1000,
    maxDelayMs: maxDelaySeconds * 1000,
  }
}

function echoResult(result: CommandResult): void {
  const trailingNewline = (text: string): string => (text.endsWith('\n') ? text : `${text}\n`)
  if (result.stdout) process.stdout.write(trailingNewline(result.stdout))
  if (result.stderr) process.stderr.write(trailingNewline(result.stderr))
}

/**
 * Poll npm until `package@version` resolves. Resolves on visibility; throws on
 * a real npm error or when the version is still unavailable at the deadline.
 */
export async function waitForNpmVersion(opts: WaitOptions, deps: WaitDeps = {}): Promise<void> {
  const runner = deps.runner ?? ((cmd, args, cwd) => runCommand(cmd, args, cwd, { timeoutMs: NPM_VIEW_TIMEOUT_MS }))
  const sleep = deps.sleep ?? realSleep
  const now = deps.now ?? Date.now

  const target = `${opts.package}@${opts.version}`
  const viewArgs = npmViewArgs(opts.package, opts.version)
  const start = now()
  const secs = (ms: number): number => Math.round(ms / 1000)

  for (let attempt = 0; ; attempt++) {
    const result = runner('npm', viewArgs, REPO_ROOT)
    const resolved = versionResolves(result)
    const elapsed = now() - start

    if (resolved === true) {
      console.log(`${target} is resolvable on npm (attempt ${attempt + 1}, ${secs(elapsed)}s elapsed)`)
      return
    }
    if (resolved === null) {
      echoResult(result)
      throw new Error(`Could not check npm package version ${target}`)
    }

    // Clamp the backoff to the remaining budget so the full --timeout is used;
    // give up only once there is no time left for another check.
    const remaining = opts.timeoutMs - elapsed
    const delay = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs, remaining)
    if (delay <= 0) {
      throw new Error(
        `${target} did not become resolvable on npm within ${secs(opts.timeoutMs)}s ` +
          `(${attempt + 1} attempts, ${secs(elapsed)}s elapsed)`,
      )
    }

    console.log(
      `${target} not visible on npm yet (attempt ${attempt + 1}, ${secs(elapsed)}s elapsed); ` +
        `retrying in ${secs(delay)}s`,
    )
    await sleep(delay)
  }
}

async function main(): Promise<void> {
  await waitForNpmVersion(parseArgs(process.argv.slice(2)))
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
