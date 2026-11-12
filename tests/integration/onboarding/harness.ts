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
 *
 * Two recorders watch every child, and a scenario FAILS when either holds
 * anything, whatever the child's exit status (`assertIsolated`, run from an
 * `afterEach`, and for a pinned gap from `expectedGap` — see there for why
 * `test.failing` is never used here):
 *  - command shims first on `PATH` stand in for `launchctl` / `systemctl`:
 *    they record their arguments and exit non-zero, so the machine's
 *    service supervisor is never reached;
 *  - a recording deny proxy receives every HTTP(S) request the child makes
 *    to anything but the scenario's own declared endpoints, logs it and
 *    answers 403. Git is confined to local files, so ssh/git transports are
 *    refused by git itself instead of slipping past the proxy.
 */
import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { createServer, type Server } from 'http'
import { createServer as createNetServer } from 'net'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'bakin.ts')
const SERVER_ENTRY = join(REPO_ROOT, 'server.ts')

/** Reserved-and-never-served ports: a connect is refused immediately. */
export const DEAD_SEARCH_URL = 'http://127.0.0.1:39998'
export const DEAD_GATEWAY_PORT = 39997

/**
 * Where the product points when no settings file says otherwise: its own
 * search engine and the OpenClaw gateway. On a developer machine either may
 * be a real, running service.
 */
export const PRODUCT_DEFAULT_ENDPOINTS = ['127.0.0.1:3738', 'localhost:3738', '127.0.0.1:18789', 'localhost:18789'] as const

/** `host:port` of a proxy record such as `GET http://127.0.0.1:18789/health` or `CONNECT host:443`. */
function recordTarget(record: string): string {
  const target = record.slice(record.indexOf(' ') + 1)
  if (!target.includes('://')) return target
  try {
    const url = new URL(target)
    return url.port ? url.host : `${url.hostname}:${url.protocol === 'https:' ? 443 : 80}`
  } catch {
    return target
  }
}

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
  /** The deny proxy's address (what the child's proxy variables hold). */
  proxyUrl: string
  /**
   * Let the child reach one of the scenario's OWN local endpoints directly
   * (a fixture gateway, a harness-booted server). `hostPort` is e.g.
   * `127.0.0.1:4123`. Everything else still goes to the deny proxy.
   */
  allowEndpoint(hostPort: string): void
  /**
   * For scenarios that start WITHOUT the settings scaffold (an absent,
   * empty or unreadable settings file): the product then runs on its real
   * default endpoints. Requests to those are still sent to the deny proxy
   * and still answered 403 — nothing reaches a real service — but they are
   * the product's own defaults, expected here, and not counted as a breach.
   */
  blackholeProductDefaults(): void
  /** What the recorders hold: supervisor commands run and outside requests made. */
  violations(): { commands: string[]; network: string[] }
  /** Every request the deny proxy refused, including blackholed defaults. */
  deniedRequests(): string[]
  /** The complete environment a child gets. Mutate to add scenario vars. */
  env: Record<string, string>
  readSettings(): Record<string, unknown>
  writeSettings(settings: Record<string, unknown>): void
  /** Stop the proxy and remove the tree. Call only after every child has exited. */
  cleanup(): Promise<void>
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

const SHIMMED_COMMANDS = ['launchctl', 'systemctl'] as const

/** Stand-ins that record the call and refuse, so no real supervisor is reached. */
function writeCommandShims(binDir: string, recordPath: string): void {
  for (const name of SHIMMED_COMMANDS) {
    const path = join(binDir, name)
    writeFileSync(path, `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> '${recordPath}'\nexit 1\n`)
    chmodSync(path, 0o755)
  }
}

interface DenyProxy {
  url: string
  records: string[]
  stop(): Promise<void>
}

/** A local listener that logs every request or CONNECT and answers 403. */
function startDenyProxy(): Promise<DenyProxy> {
  const records: string[] = []
  const server: Server = createServer((req, res) => {
    records.push(`${req.method ?? 'GET'} ${req.url ?? ''}`)
    res.writeHead(403, { 'content-type': 'text/plain', connection: 'close' })
    res.end('denied by the onboarding harness\n')
  })
  server.on('connect', (req, socket) => {
    records.push(`CONNECT ${req.url ?? ''}`)
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        records,
        stop: () => new Promise<void>((done) => {
          server.closeAllConnections()
          server.close(() => done())
        }),
      })
    })
  })
}

export async function createOnboardingHome(options: CreateHomeOptions = {}): Promise<OnboardingHome> {
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
  const recordDir = join(root, 'harness-record')
  for (const dir of [userHome, binDir, childTmp, recordDir]) mkdirSync(dir, { recursive: true })
  const settingsPath = join(bakinHome, 'settings.json')
  const commandRecord = join(recordDir, 'commands.log')
  writeCommandShims(binDir, commandRecord)
  const proxy = await startDenyProxy()
  const allowed: string[] = []
  const blackholed = new Set<string>()

  const home: OnboardingHome = {
    root, bakinHome, piHome, openclawHome, searchHome, userHome, binDir, settingsPath,
    proxyUrl: proxy.url,
    allowEndpoint: (hostPort) => {
      allowed.push(hostPort)
      home.env.NO_PROXY = allowed.join(',')
      home.env.no_proxy = home.env.NO_PROXY
    },
    blackholeProductDefaults: () => {
      for (const endpoint of PRODUCT_DEFAULT_ENDPOINTS) blackholed.add(endpoint)
    },
    violations: () => ({
      commands: existsSync(commandRecord) ? readFileSync(commandRecord, 'utf-8').split('\n').filter(Boolean) : [],
      network: proxy.records.filter((record) => !blackholed.has(recordTarget(record))),
    }),
    deniedRequests: () => [...proxy.records],
    env: {
      // The allowlist. Nothing is inherited: no BAKIN_URL from the test
      // preload, no developer shell state, no proxy or token variables.
      PATH: [binDir, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      HOME: userHome,
      TMPDIR: childTmp,
      BAKIN_HOME: bakinHome,
      PI_HOME: piHome,
      // The Pi SDK's own home override; aligned with PI_HOME so the SDK and
      // the adapter agree on one agent dir inside the tree.
      PI_CODING_AGENT_DIR: join(piHome, 'agent'),
      OPENCLAW_HOME: openclawHome,
      // The adapter runs the OpenClaw CLI from here. Only the OpenClaw
      // fixture installs a stand-in at this path; without one, nothing on
      // PATH resolves either.
      OPENCLAW_PATH: join(binDir, 'openclaw'),
      ANTFLY_HOME: searchHome,
      LANG: 'en_US.UTF-8',
      NO_COLOR: '1',
      // Bun keeps its transpiler cache under HOME; a throwaway HOME would
      // re-transpile the whole app in every child. One shared cache (code
      // only, keyed by content) keeps children fast and the tree clean.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE,
      // Everything goes to the deny proxy. Both spellings: Bun's fetch reads
      // either, git's HTTP transport reads only the lowercase http_proxy.
      // There is deliberately no NO_PROXY until a scenario declares one of
      // its own endpoints — a blanket localhost exemption would let a child
      // reach unrelated services on this machine unrecorded.
      HTTP_PROXY: proxy.url,
      HTTPS_PROXY: proxy.url,
      http_proxy: proxy.url,
      https_proxy: proxy.url,
      // Git may only read local files: ssh:// and git:// are refused by git
      // itself (they would bypass an HTTP proxy), no user or system config
      // can re-enable them, and nothing ever waits on a credential prompt.
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    readSettings: () => JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>,
    writeSettings: (settings) => {
      mkdirSync(bakinHome, { recursive: true })
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    },
    cleanup: async () => {
      await proxy.stop()
      rmSync(root, { recursive: true, force: true })
    },
  }
  // The scaffold's two dead endpoints are the scenario's own: a connect to
  // them is refused locally and is not an outside request.
  home.allowEndpoint(new URL(DEAD_SEARCH_URL).host)
  home.allowEndpoint(`127.0.0.1:${DEAD_GATEWAY_PORT}`)
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

/** Run any executable under the harness's closed environment. */
export function runCommand(home: OnboardingHome, command: string, args: string[], options: RunOptions = {}): Promise<ChildResult> {
  const timeoutMs = options.timeoutMs ?? 60_000
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
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

/**
 * Run a TypeScript file with Bun under the closed environment. `runBakin`
 * is the scenario entry; this exists so a probe is spawned the same way.
 */
export function runScript(home: OnboardingHome, script: string, args: string[], options: RunOptions = {}): Promise<ChildResult> {
  return runCommand(home, process.execPath, [...(options.bunArgs ?? ['--no-env-file']), script, ...args], options)
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

/**
 * The isolation verdict for one home: throws when a child ran a supervisor
 * command or made a request outside the scenario's declared endpoints.
 */
export function assertIsolated(home: OnboardingHome): void {
  const { commands, network } = home.violations()
  if (commands.length === 0 && network.length === 0) return
  throw new Error([
    'onboarding harness: isolation breach',
    ...commands.map((line) => `  supervisor command: ${line}`),
    ...network.map((line) => `  outside request: ${line}`),
  ].join('\n'))
}

export interface HomeTracker {
  create(options?: CreateHomeOptions): Promise<OnboardingHome>
  /** Assert isolation for every home made since the last call, then remove them. */
  finish(): Promise<void>
}

/**
 * Scenario files call `trackHomes()` once and `afterEach(() => homes.finish())`,
 * so isolation is asserted after every test, outside its body.
 */
export function trackHomes(): HomeTracker {
  const live: OnboardingHome[] = []
  return {
    create: async (options) => {
      const home = await createOnboardingHome(options)
      live.push(home)
      return home
    },
    finish: async () => {
      const homes = live.splice(0)
      const breaches: string[] = []
      for (const home of homes) {
        try {
          assertIsolated(home)
        } catch (err) {
          breaches.push(err instanceof Error ? err.message : String(err))
        }
        await home.cleanup()
        if (existsSync(home.root)) breaches.push(`onboarding harness: ${home.root} was not removed`)
      }
      if (breaches.length > 0) throw new Error(breaches.join('\n'))
    },
  }
}

/**
 * A scenario that pins a KNOWN gap: the body asserts the behaviour the spec
 * wants and is expected to fail on today's code. Use it as the test
 * function of a plain `test(...)`:
 *
 *   test('… (pinned: flipped by task 3.7)', expectedGap(homes, async () => { … }))
 *
 * `test.failing` is deliberately not used. Under bun 1.4.3 an `afterEach`
 * that throws after a `test.failing` body is reported and then counted as a
 * PASS — the expected failure absorbs it — so an isolation breach inside a
 * pinned scenario would go green. Here the body's failure is caught, the
 * isolation verdict runs outside that catch and fails the test for real,
 * and a body that passes fails too (the gap is closed: make it a plain test
 * in the commit that closed it).
 */
export function expectedGap(homes: HomeTracker, body: () => Promise<void>): () => Promise<void> {
  return async () => {
    let failed = false
    try {
      await body()
    } catch (err) {
      failed = true
      // A pinned gap must fail for the reason it pins, not for a typo in
      // the scenario. ONBOARDING_GAP_REASONS=1 prints each one for review.
      if (process.env.ONBOARDING_GAP_REASONS) {
        console.error(`[pinned gap] ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    await homes.finish()
    if (!failed) {
      throw new Error('onboarding harness: this pinned gap now passes — turn it into a plain test in the commit that fixed it')
    }
  }
}

// ---------------------------------------------------------------------------
// Server mode
// ---------------------------------------------------------------------------

/** The suite preload swaps global fetch for a browser emulation; real sockets need Bun's. */
const realFetch: typeof fetch = (Bun as unknown as { fetch?: typeof fetch }).fetch ?? fetch

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

export interface HarnessServer {
  port: number
  baseUrl: string
  /** Everything the server wrote to stdout and stderr so far. */
  logs(): string
  /** Stop the server's process group and wait for it to exit. */
  stop(): Promise<void>
}

/**
 * Boot the real server from source for this home, under the same closed
 * environment as the CLI. The CLI then finds it through the home's own
 * `server.lock`, so `bakin onboard` runs its installs as operations on the
 * server instead of in-process. The server's address is declared as the
 * scenario's own endpoint; anything else it requests is recorded.
 */
export async function startServer(home: OnboardingHome, options: { env?: Record<string, string>; bootTimeoutMs?: number } = {}): Promise<HarnessServer> {
  const port = await freePort()
  // The CLI addresses its home's server as `localhost`; the harness polls 127.0.0.1.
  home.allowEndpoint(`127.0.0.1:${port}`)
  home.allowEndpoint(`localhost:${port}`)
  const child: ChildProcess = spawn(process.execPath, ['--no-env-file', SERVER_ENTRY, 'serve'], {
    cwd: REPO_ROOT,
    env: {
      ...home.env,
      PORT: String(port),
      // The scenario onboards a home that is not onboarded yet; the gate
      // that refuses to serve such a home is not what is under test.
      BAKIN_SKIP_ONBOARDING_CHECK: '1',
      BAKIN_CONSOLE_FORMAT: 'json',
      ...(options.env ?? {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let output = ''
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null
  child.stdout?.setEncoding('utf-8').on('data', (chunk: string) => { output += chunk })
  child.stderr?.setEncoding('utf-8').on('data', (chunk: string) => { output += chunk })
  const closed = new Promise<void>((resolve) => {
    child.once('close', (code, signal) => {
      exited = { code, signal }
      resolve()
    })
  })
  const stop = async (): Promise<void> => {
    if (child.pid !== undefined && !exited) {
      killGroup(child.pid, 'SIGTERM')
      const hard = setTimeout(() => { if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL') }, 5_000)
      await closed
      clearTimeout(hard)
    }
    if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL')
  }

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + (options.bootTimeoutMs ?? 60_000)
  for (;;) {
    try {
      const res = await realFetch(`${baseUrl}/api/operations`, { signal: AbortSignal.timeout(2_000) })
      if (res.ok) break
    } catch {
      // not listening yet
    }
    if (exited) throw new Error(`onboarding harness: server exited before boot:\n${output.slice(-3000)}`)
    if (Date.now() > deadline) {
      await stop()
      throw new Error(`onboarding harness: server did not boot within the deadline:\n${output.slice(-3000)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return { port, baseUrl, logs: () => output, stop }
}
