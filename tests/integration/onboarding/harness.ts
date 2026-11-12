/**
 * Child-process harness for onboarding scenarios.
 *
 * Every scenario runs the REAL CLI (`bun --no-env-file cli/bakin.ts …`) in
 * its own process against a throwaway tree that holds every home the CLI
 * can resolve: the Bakin home, the Pi home, the OpenClaw home, the search
 * engine's home and `HOME` itself. Isolation is by RESOLVER: the child's
 * environment is built from nothing (an allowlist, never the parent's env),
 * so no resolver can fall back to this machine's real homes.
 *
 * This is the documented exception to the "mock the content-dir resolvers"
 * rule (CLAUDE.md § Testing Rules): the test files import no app modules,
 * and the app only ever runs in the child.
 *
 * What the scaffold pins, and why:
 *  - a GUEST search URL: a non-default URL keeps the search adapter from
 *    ever inspecting or provisioning the machine-global search service;
 *  - an explicit, dead OpenClaw gateway port: the adapter's default port
 *    (18789) may belong to a real gateway on a developer machine. Fixtures
 *    that want a live gateway point this at their own health endpoint.
 *  It deliberately stores NO `runtime.adapter` — a fresh home is undecided.
 */
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'bakin.ts')

/** Reserved-and-never-served ports: a connect is refused immediately. */
export const DEAD_SEARCH_URL = 'http://127.0.0.1:39998'
export const DEAD_GATEWAY_PORT = 39997

const TRANSPILER_CACHE = join(tmpdir(), 'bakin-onboard-harness-transpiler-cache')

export interface OnboardingHome {
  /** The throwaway tree; everything below lives inside it. */
  root: string
  bakinHome: string
  piHome: string
  openclawHome: string
  searchHome: string
  /** The child's `HOME`. */
  userHome: string
  /** First on the child's `PATH` — command shims go here. */
  binDir: string
  settingsPath: string
  /** The complete environment a child gets. Mutate to add scenario vars. */
  env: Record<string, string>
  readSettings(): Record<string, unknown>
  writeSettings(settings: Record<string, unknown>): void
  /** Remove the tree. Call only after every child has exited. */
  cleanup(): void
}

export interface CreateHomeOptions {
  /**
   * `scaffold` (default) writes the isolation settings; `absent` creates no
   * Bakin home at all. A scenario that needs a different settings file
   * rewrites it and owns keeping the isolation keys.
   */
  bakinHome?: 'scaffold' | 'absent'
}

export function scaffoldSettings(): Record<string, unknown> {
  return {
    search: { settings: { url: DEAD_SEARCH_URL } },
    runtime: { settings: { gatewayPort: DEAD_GATEWAY_PORT } },
  }
}

export function createOnboardingHome(options: CreateHomeOptions = {}): OnboardingHome {
  // realpath: macOS tmpdir is a symlink (/var → /private/var); containment
  // checks compare against what the child's resolvers actually return.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bakin-onboard-')))
  const bakinHome = join(root, 'bakin')
  const piHome = join(root, 'pi')
  const openclawHome = join(root, 'openclaw')
  const searchHome = join(root, 'antfly')
  const userHome = join(root, 'home')
  const binDir = join(root, 'bin')
  const childTmp = join(root, 'tmp')
  for (const dir of [userHome, binDir, childTmp]) mkdirSync(dir, { recursive: true })
  const settingsPath = join(bakinHome, 'settings.json')

  const home: OnboardingHome = {
    root, bakinHome, piHome, openclawHome, searchHome, userHome, binDir, settingsPath,
    env: {
      // The allowlist. Nothing is inherited: no BAKIN_URL from the test
      // preload, no developer shell state, no proxy or token variables.
      PATH: [binDir, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      HOME: userHome,
      TMPDIR: childTmp,
      BAKIN_HOME: bakinHome,
      PI_HOME: piHome,
      OPENCLAW_HOME: openclawHome,
      ANTFLY_HOME: searchHome,
      LANG: 'en_US.UTF-8',
      NO_COLOR: '1',
      // Bun keeps its transpiler cache under HOME; a throwaway HOME would
      // re-transpile the whole app in every child. One shared cache (code
      // only, keyed by content) keeps children fast and the tree clean.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE,
    },
    readSettings: () => JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>,
    writeSettings: (settings) => {
      mkdirSync(bakinHome, { recursive: true })
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
  if ((options.bakinHome ?? 'scaffold') === 'scaffold') home.writeSettings(scaffoldSettings())
  return home
}

export interface ChildResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  /** True when the deadline killed the child. */
  timedOut: boolean
  /** Every stdout line that parses as a JSON object, in order. */
  jsonLines: Array<Record<string, unknown>>
  /** The whole of stdout parsed as one JSON value, when it is one. */
  json: unknown
}

export interface RunOptions {
  /** Extra env for this child only (merged over the home's env). */
  env?: Record<string, string>
  /** Deadline; the whole process group is killed when it passes. */
  timeoutMs?: number
  /** Working directory. Defaults to the repo root. */
  cwd?: string
  /** Extra `bun` flags. Tests of the harness itself use this; scenarios never do. */
  bunArgs?: string[]
  /** Send this signal once `when` first returns true (interrupt scenarios). */
  signalWhen?: { signal: NodeJS.Signals; when: (soFar: { stdout: string; stderr: string }) => boolean }
}

function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const line of stdout.split('\n')) {
    const text = line.trim()
    if (!text.startsWith('{')) continue
    try {
      const value: unknown = JSON.parse(text)
      if (value && typeof value === 'object' && !Array.isArray(value)) out.push(value as Record<string, unknown>)
    } catch {
      // not a JSON line — pretty-printed output is read through `json`
    }
  }
  return out
}

function parseWhole(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}

/** Kill a child's whole process group (it is spawned detached, as a group leader). */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // already gone
  }
}

/**
 * Run any script under the harness's closed environment. `runBakin` is the
 * scenario entry; this exists so a probe can be spawned the same way.
 */
export function runScript(home: OnboardingHome, script: string, args: string[], options: RunOptions = {}): Promise<ChildResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...(options.bunArgs ?? ['--no-env-file']), script, ...args], {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...home.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let signalled = false
    const maybeSignal = () => {
      const plan = options.signalWhen
      if (!plan || signalled || child.pid === undefined) return
      if (!plan.when({ stdout, stderr })) return
      signalled = true
      child.kill(plan.signal)
    }
    child.stdout.setEncoding('utf-8').on('data', (chunk: string) => { stdout += chunk; maybeSignal() })
    child.stderr.setEncoding('utf-8').on('data', (chunk: string) => { stderr += chunk; maybeSignal() })
    const deadline = setTimeout(() => {
      timedOut = true
      if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL')
    }, timeoutMs)
    child.once('error', (err) => {
      clearTimeout(deadline)
      reject(err)
    })
    // 'close' (not 'exit'): both pipes have drained, so the output is complete.
    child.once('close', (exitCode, signal) => {
      clearTimeout(deadline)
      // Anything the child left running in its group dies with it, so the
      // tree can be removed safely.
      if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL')
      resolve({ exitCode, signal, stdout, stderr, timedOut, jsonLines: parseJsonLines(stdout), json: parseWhole(stdout) })
    })
  })
}

/** Run the real CLI: `bakin <args>` from source, in its own process. */
export function runBakin(home: OnboardingHome, args: string[], options: RunOptions = {}): Promise<ChildResult> {
  return runScript(home, CLI_ENTRY, args, options)
}

export type TreeSnapshot = Record<string, string>

/**
 * Every regular file under `root` → sha256 of its bytes, plus every
 * directory (value `dir`), so a created empty directory is a difference
 * too. `logs/` is excluded at any depth: log lines are not state.
 */
export function snapshotTree(root: string): TreeSnapshot {
  const out: TreeSnapshot = {}
  if (!existsSync(root)) return out
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'logs') continue
      const full = join(dir, entry.name)
      const rel = relative(root, full)
      if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir'
        walk(full)
      } else if (entry.isFile()) {
        out[rel] = createHash('sha256').update(readFileSync(full)).digest('hex')
      } else {
        out[rel] = 'other'
      }
    }
  }
  walk(root)
  return out
}

export interface TreeDiff {
  added: string[]
  removed: string[]
  changed: string[]
}

export function diffTrees(before: TreeSnapshot, after: TreeSnapshot): TreeDiff {
  const added = Object.keys(after).filter((key) => !(key in before)).sort()
  const removed = Object.keys(before).filter((key) => !(key in after)).sort()
  const changed = Object.keys(after).filter((key) => key in before && before[key] !== after[key]).sort()
  return { added, removed, changed }
}

export function isUnchanged(diff: TreeDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
}
