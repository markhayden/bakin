/**
 * Dev-mode coordinator — `bun run dev` entry point.
 *
 * Sets BAKIN_DEV=1, primes the dist/ tree with a one-shot build, compiles
 * the dev-client bundle into packages/host/public/__bakin-dev/, wires
 * chokidar watchers for shell / plugin / SDK source + Tailwind output,
 * then imports server.ts in-process. Rebuilds broadcast to connected
 * browsers via the in-process broadcastDev() from dev/events.ts — no
 * HTTP round-trip.
 *
 * v1 skeleton (commit 4): dev client is a stub that logs every event.
 * Commit 5 wires CSS hot-swap, full reload, and the error overlay.
 */
process.env.BAKIN_DEV = '1'
process.env.BAKIN_DEV_HOTRELOAD = '1'

interface DevOptions {
  verbose: boolean
  noColor: boolean
}

function parseDevOptions(args: string[]): DevOptions {
  const options: DevOptions = { verbose: false, noColor: false }
  for (const arg of args) {
    if (arg === '--verbose') {
      options.verbose = true
    } else if (arg === '--no-color') {
      options.noColor = true
    } else {
      console.error(`Unknown dev option: ${arg}`)
      console.error('Usage: bakin dev [--verbose] [--no-color]')
      process.exit(1)
    }
  }
  return options
}

const DEV_OPTIONS = parseDevOptions(process.argv.slice(2))
// scripts/dev.ts runs server.ts in-process. Consume dev-only flags here and
// hand the CLI dispatcher an explicit `serve` command so it boots the server
// in the foreground. A bare argv now defaults to `help` (cli.ts), which would
// print the command reference and exit instead of starting the dev server.
process.argv.splice(2, Infinity, 'serve')
const DEV_VERBOSE = DEV_OPTIONS.verbose
  || process.env.BAKIN_DEV_VERBOSE === '1'
  || process.env.BAKIN_CONSOLE_FORMAT === 'verbose'
if (DEV_OPTIONS.noColor) process.env.NO_COLOR = '1'
if (DEV_VERBOSE) {
  process.env.BAKIN_CONSOLE_FORMAT = 'verbose'
} else if (!process.env.BAKIN_CONSOLE_FORMAT) {
  process.env.BAKIN_CONSOLE_FORMAT = 'pretty'
}
if (DEV_VERBOSE && !process.env.BAKIN_LOG_LEVEL) {
  process.env.BAKIN_LOG_LEVEL = 'debug'
}

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import chokidar from 'chokidar'

import { broadcastDev, type DevEvent, type DevScope } from '../packages/host/src/api/dev/events'
import { PLUGIN_CLIENT_EXTERNALS } from '../src/core/whiskit/externals'
import { CORE_PLUGIN_IDS } from '../src/lib/core-plugin-ids'
import { buildOnePlugin } from './dev-build-one-plugin'
import { isBenignTailwindLine } from './dev-log-classifier'
import { registerDevShutdown } from './dev-shutdown'

const REPO_ROOT = resolve(import.meta.dir, '..')
const PLUGINS_DIR = join(REPO_ROOT, 'plugins')
const DEV_CLIENT_ENTRY = join(REPO_ROOT, 'packages/host/src/dev-client/client.ts')
const DEV_CLIENT_OUTDIR = join(REPO_ROOT, 'packages/host/public/__bakin-dev')
const TAILWIND_BIN = join(REPO_ROOT, 'node_modules/.bin/tailwindcss')

// Single source for the core plugin set — see src/lib/core-plugin-ids.ts.
const CORE_PLUGINS = CORE_PLUGIN_IDS

// Single source for the externals contract — see src/core/whiskit/externals.ts.
const EXTERNAL = PLUGIN_CLIENT_EXTERNALS

const DEFAULT_PLUGIN_DEV_WATCH = [
  'client.tsx', 'components/**', 'lib/**', '*.ts',
]

const DEBOUNCE_MS = 50

const COLOR_RESET = '\x1b[0m'
const DEV_COLORS = {
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
} as const

type DevLevel = 'debug' | 'build' | 'info' | 'ready' | 'warn' | 'error'

function devColorEnabled(): boolean {
  if (process.env.NO_COLOR || process.env.BAKIN_NO_COLOR === '1') return false
  return process.stdout.isTTY === true
}

function devColor(text: string, color: keyof typeof DEV_COLORS): string {
  return devColorEnabled() ? `${DEV_COLORS[color]}${text}${COLOR_RESET}` : text
}

function devLevelColor(level: DevLevel): keyof typeof DEV_COLORS {
  if (level === 'build') return 'cyan'
  if (level === 'ready') return 'green'
  if (level === 'warn') return 'yellow'
  if (level === 'error') return 'red'
  if (level === 'debug') return 'dim'
  return 'blue'
}

function devLog(level: DevLevel, source: string, message: string): void {
  if (level === 'debug' && !DEV_VERBOSE) return
  const time = new Date().toTimeString().slice(0, 8)
  const levelPart = devColor(level.padEnd(5), devLevelColor(level))
  const sourcePart = devColor(source.padEnd(18), source === 'dev' ? 'cyan' : 'dim')
  const line = `${devColor(time, 'dim')}  ${levelPart}  ${sourcePart}  ${message}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function summarizeBuildOutput(output: string): string | null {
  const summaries = [
    /(\d+ bundles built)/,
    /(\d+ plugins built)/,
    /(wrote \d+ entries)/,
  ]
  for (const pattern of summaries) {
    const match = pattern.exec(output)
    if (match) return match[1]
  }
  return null
}

async function readSpawnOutput(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return ''
  return await new Response(stream).text()
}

function printCapturedOutput(output: string): void {
  const trimmed = output.trim()
  if (!trimmed) return
  for (const line of trimmed.split(/\r?\n/)) {
    console.error(`  ${line}`)
  }
}

// ---------- Initial build ------------------------------------------------

async function runStep(label: string, cmd: string[]): Promise<void> {
  const started = Date.now()
  devLog('build', 'dev', `${label}...`)
  if (DEV_VERBOSE) devLog('debug', 'dev', `$ ${cmd.join(' ')}`)
  const proc = Bun.spawn(cmd, {
    stdout: DEV_VERBOSE ? 'inherit' : 'pipe',
    stderr: DEV_VERBOSE ? 'inherit' : 'pipe',
    cwd: REPO_ROOT,
  })
  const stdoutPromise = DEV_VERBOSE ? Promise.resolve('') : readSpawnOutput(proc.stdout)
  const stderrPromise = DEV_VERBOSE ? Promise.resolve('') : readSpawnOutput(proc.stderr)
  const code = await proc.exited
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  if (code !== 0) {
    devLog('error', 'dev', `${label} failed (exit ${code})`)
    if (!DEV_VERBOSE) {
      printCapturedOutput(stdout)
      printCapturedOutput(stderr)
    }
    process.exit(1)
  }
  const summary = summarizeBuildOutput(`${stdout}\n${stderr}`)
  const summaryText = summary ? ` (${summary})` : ''
  devLog('ready', 'dev', `${label} completed in ${formatDuration(Date.now() - started)}${summaryText}`)
}

async function buildDevClient(): Promise<void> {
  const started = Date.now()
  devLog('build', 'dev', 'building dev-client...')
  const result = await Bun.build({
    entrypoints: [DEV_CLIENT_ENTRY],
    outdir: DEV_CLIENT_OUTDIR,
    target: 'browser',
    format: 'esm',
    sourcemap: 'inline',
    minify: false,
    naming: 'client.[ext]',
  })
  if (!result.success) {
    devLog('error', 'dev', 'dev-client build failed')
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  devLog('ready', 'dev', `dev-client completed in ${formatDuration(Date.now() - started)}`)
}

// ---------- Tailwind child process --------------------------------------

let tailwindChild: ChildProcess | null = null

function startTailwindWatch(): void {
  devLog('build', 'tailwind', 'starting --watch=always...')
  // --watch=always keeps the watcher alive when stdin is closed (we use
  // stdio:'ignore' for stdin). Plain --watch exits on stdin close and
  // silently stops emitting output.
  // Spawn the lockfile-pinned local bin directly under bun: the child pid
  // IS the tailwind process, so kill('SIGTERM') reaches it. bunx added a
  // wrapper chain that ate the signal (orphaned node grandchild) and
  // downloaded floating @tailwindcss/cli@latest instead of the devDep.
  tailwindChild = nodeSpawn(
    'bun',
    [
      TAILWIND_BIN,
      '-i', './packages/host/src/globals.css',
      '-o', './packages/sdk/styles.css',
      '--minify',
      '--watch=always',
    ],
    { stdio: ['ignore', DEV_VERBOSE ? 'inherit' : 'pipe', DEV_VERBOSE ? 'inherit' : 'pipe'], cwd: REPO_ROOT },
  )
  if (!DEV_VERBOSE) {
    tailwindChild.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        const trimmed = line.trim()
        if (isBenignTailwindLine(trimmed)) continue
        devLog('info', 'tailwind', trimmed)
      }
    })
    tailwindChild.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        const trimmed = line.trim()
        if (isBenignTailwindLine(trimmed)) continue
        devLog('warn', 'tailwind', trimmed)
      }
    })
  }
  tailwindChild.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      devLog('warn', 'tailwind', `--watch exited with code ${code}`)
    }
  })
}

// ---------- Debounced scope queue ---------------------------------------

type Scope = DevScope | `plugin:${string}`

const inFlight = new Set<Scope>()
const pending = new Set<Scope>()
const debounceTimers = new Map<Scope, NodeJS.Timeout>()

function scheduleRebuild(scope: Scope, runner: () => Promise<void>): void {
  const existing = debounceTimers.get(scope)
  if (existing) clearTimeout(existing)
  debounceTimers.set(scope, setTimeout(() => {
    debounceTimers.delete(scope)
    triggerRebuild(scope, runner)
  }, DEBOUNCE_MS))
}

async function triggerRebuild(scope: Scope, runner: () => Promise<void>): Promise<void> {
  if (inFlight.has(scope)) {
    pending.add(scope)
    return
  }
  inFlight.add(scope)
  try {
    await runner()
  } finally {
    inFlight.delete(scope)
    if (pending.delete(scope)) {
      triggerRebuild(scope, runner)
    }
  }
}

// ---------- Rebuild runners ---------------------------------------------

function broadcast(event: DevEvent): void {
  broadcastDev(event)
}

// Track per-scope "last was error" so we can emit dev:recover before the
// dev:reload that clears the browser overlay.
const erroredScopes = new Set<DevScope>()

function emitSuccess(scope: DevScope, successEvent: DevEvent): void {
  if (erroredScopes.delete(scope)) {
    broadcast({ type: 'dev:recover', scope })
  }
  broadcast(successEvent)
}

function emitError(scope: DevScope, message: string, stderr: string): void {
  erroredScopes.add(scope)
  broadcast({ type: 'dev:error', scope, message, stderr })
}

async function rebuildShell(): Promise<void> {
  broadcast({ type: 'dev:building', scope: 'shell' })
  const proc = Bun.spawn(['bun', 'run', 'packages/host/build.ts'], {
    stdout: 'inherit', stderr: 'pipe', cwd: REPO_ROOT,
  })
  const code = await proc.exited
  if (code === 0) {
    emitSuccess('shell', { type: 'dev:reload', scope: 'shell' })
    devLog('ready', 'dev', 'shell rebuilt')
  } else {
    const stderr = await new Response(proc.stderr).text()
    emitError('shell', 'shell build failed', stderr)
    devLog('error', 'dev', 'shell rebuild failed')
    printCapturedOutput(stderr)
  }
}

async function rebuildPlugin(id: string): Promise<void> {
  broadcast({ type: 'dev:building', scope: 'plugin' })
  // serverEntry: false — core plugin server code is statically imported from
  // source; the dev loop only needs fresh client assets for hot-swap (#421).
  const result = await buildOnePlugin(id, { external: EXTERNAL, serverEntry: false })
  if (result.ok) {
    // v2: emit dev:hot-swap with the new client.js's mtime as the cache-bust
    // version. v1 clients would fall through to location.reload(); v2 dev
    // client (packages/host/src/dev-client/client.ts) calls
    // window.__bakinHotSwapPlugin to remount just this plugin's subtree.
    const clientJs = join(PLUGINS_DIR, id, 'dist', 'client.js')
    const version = existsSync(clientJs)
      ? String(statSync(clientJs).mtimeMs)
      : String(Date.now())
    if (erroredScopes.delete('plugin')) {
      broadcast({ type: 'dev:recover', scope: 'plugin' })
    }
    broadcast({ type: 'dev:hot-swap', scope: 'plugin', id, version })
    devLog('ready', `plugin:${id}`, `rebuilt, hot-swap ${version}`)
  } else {
    emitError('plugin', `plugin ${id} build failed`, result.stderr)
    devLog('error', `plugin:${id}`, 'rebuild failed')
    printCapturedOutput(result.stderr)
  }
}

async function rebuildSdk(): Promise<void> {
  broadcast({ type: 'dev:building', scope: 'sdk' })
  const proc = Bun.spawn(['bun', 'run', 'scripts/build-vendors.ts'], {
    stdout: 'inherit', stderr: 'pipe', cwd: REPO_ROOT,
  })
  const code = await proc.exited
  if (code === 0) {
    emitSuccess('sdk', { type: 'dev:reload', scope: 'sdk' })
    devLog('ready', 'sdk', 'vendor bundles rebuilt')
  } else {
    const stderr = await new Response(proc.stderr).text()
    emitError('sdk', 'sdk build failed', stderr)
    devLog('error', 'sdk', 'rebuild failed')
    printCapturedOutput(stderr)
  }
}

// ---------- Watcher wiring ----------------------------------------------

interface PluginManifest {
  id?: string
  devWatch?: string[]
}

function readPluginDevWatch(id: string): string[] {
  const manifestPath = join(PLUGINS_DIR, id, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) return DEFAULT_PLUGIN_DEV_WATCH
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
    if (!manifest.devWatch) return DEFAULT_PLUGIN_DEV_WATCH
    if (!Array.isArray(manifest.devWatch) || !manifest.devWatch.every((g) => typeof g === 'string')) {
      console.warn(`[bakin-dev] plugin ${id}: devWatch must be string[] — falling back to default`)
      return DEFAULT_PLUGIN_DEV_WATCH
    }
    for (const glob of manifest.devWatch) {
      if (glob.includes('..')) {
        console.warn(`[bakin-dev] plugin ${id}: invalid devWatch entry ${glob} — falling back to default`)
        return DEFAULT_PLUGIN_DEV_WATCH
      }
    }
    return manifest.devWatch
  } catch (err) {
    console.warn(`[bakin-dev] plugin ${id}: failed to read manifest, using default devWatch:`, err)
    return DEFAULT_PLUGIN_DEV_WATCH
  }
}

// chokidar v5 dropped native glob support in .watch() — watch directories
// and filter in the handler. We watch wide, filter narrow.

// CSS is intentionally excluded — .css edits go through tailwind --watch → CSS
// watcher → dev:css link-swap (no reload). Including .css here would race the
// shell rebuild ahead of the link-swap and reload the page.
const SHELL_SRC_RE = /\.(ts|tsx)$/
const SDK_SRC_RE = /\.(ts|tsx)$/
const DEV_CLIENT_RE = /dev-client[\\/]/
const IGNORED_RE = /(node_modules|[\\/]\.git[\\/]|[\\/]dist[\\/])/

function matchesAny(rel: string, globs: readonly string[]): boolean {
  // Lightweight glob matcher — handles the shapes we emit from
  // readPluginDevWatch: 'client.tsx', 'components/**', 'lib/**', '*.ts'.
  // Normalize separators then test each.
  const path = rel.replace(/\\/g, '/')
  for (const g of globs) {
    const pattern = g.replace(/\\/g, '/')
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3)
      if (path === prefix || path.startsWith(prefix + '/')) return true
    } else if (pattern.startsWith('*.')) {
      const ext = pattern.slice(1)
      if (!path.includes('/') && path.endsWith(ext)) return true
    } else if (path === pattern) {
      return true
    }
  }
  return false
}

function startShellWatcher(): void {
  const root = join(REPO_ROOT, 'packages/host/src')
  const watcher = chokidar.watch(root, { ignoreInitial: true })
  watcher.on('all', (_event, path) => {
    if (IGNORED_RE.test(path)) return
    if (DEV_CLIENT_RE.test(path)) return
    if (!SHELL_SRC_RE.test(path)) return
    scheduleRebuild('shell', rebuildShell)
  })
}

function startPluginWatchers(): void {
  for (const id of CORE_PLUGINS) {
    const pluginDir = join(PLUGINS_DIR, id)
    if (!existsSync(pluginDir)) continue
    const globs = readPluginDevWatch(id)
    const watcher = chokidar.watch(pluginDir, { ignoreInitial: true })
    const scope: Scope = `plugin:${id}`
    watcher.on('all', (_event, path) => {
      if (IGNORED_RE.test(path)) return
      // Reject the server-entry (index.ts at plugin root) — server-side
      // rebuilds don't hot-reload the running process in v1.
      const rel = path.slice(pluginDir.length + 1)
      if (rel === 'index.ts') return
      if (!matchesAny(rel, globs)) return
      scheduleRebuild(scope, () => rebuildPlugin(id))
    })
  }
}

function startSdkWatcher(): void {
  const root = join(REPO_ROOT, 'packages/sdk/src')
  const watcher = chokidar.watch(root, { ignoreInitial: true })
  watcher.on('all', (_event, path) => {
    if (IGNORED_RE.test(path)) return
    if (!SDK_SRC_RE.test(path)) return
    scheduleRebuild('sdk', rebuildSdk)
  })
}

function startCssWatcher(): void {
  // Watch the parent directory + filter by path; watching a single file
  // directly misses atomic-rename writes that Tailwind's --watch produces.
  const sdkDir = join(REPO_ROOT, 'packages/sdk')
  const cssOutput = join(sdkDir, 'styles.css')
  let lastMtime = existsSync(cssOutput) ? statSync(cssOutput).mtimeMs : 0
  const watcher = chokidar.watch(sdkDir, { ignoreInitial: true, depth: 0 })
  watcher.on('all', (event, path) => {
    if (path !== cssOutput) return
    if (event !== 'change' && event !== 'add') return
    if (!existsSync(cssOutput)) return
    const m = statSync(cssOutput).mtimeMs
    if (m === lastMtime) return
    lastMtime = m
    broadcast({ type: 'dev:css' })
    devLog('ready', 'css', 'updated')
  })
}

// ---------- Shutdown ----------------------------------------------------

// Signal handling lives in dev-shutdown.ts: we register before server.ts
// imports, so we must NOT call process.exit once lifecycle.ts's handlers
// exist on the same signals — that preempted the graceful chain and
// orphaned the antfly child (#459 defect 1).
function registerShutdown(): void {
  registerDevShutdown({
    proc: process,
    killTailwind: () => {
      if (tailwindChild && !tailwindChild.killed) tailwindChild.kill('SIGTERM')
    },
    warn: (message) => devLog('warn', 'dev', message),
  })
}

// ---------- Main --------------------------------------------------------

async function main(): Promise<void> {
  registerShutdown()

  // Prime the tree — same as the production prestart. assets-manifest must
  // run too: server.ts imports _embedded-assets-static.ts at the top level,
  // and stale entries pointing to removed plugins fail Bun's file-typed
  // import resolution before the disk fallback in _static.ts ever runs.
  await runStep('build:css', ['bun', 'run', 'build:css'])
  await runStep('build:vendors', ['bun', 'run', 'build:vendors'])
  await runStep('build:plugins', ['bun', 'run', 'build:plugins'])
  await runStep('build:host-shell', ['bun', 'run', 'build:host-shell'])
  await runStep('build:assets-manifest', ['bun', 'run', 'build:assets-manifest'])

  await buildDevClient()

  startTailwindWatch()
  startShellWatcher()
  startPluginWatchers()
  startSdkWatcher()
  startCssWatcher()

  devLog('ready', 'dev', 'watchers ready - starting server...')
  await import('../server')
}

await main()

export {}
