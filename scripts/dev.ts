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

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import chokidar from 'chokidar'

import { broadcastDev, type DevEvent, type DevScope } from '../packages/host/src/api/dev/events'
import { buildOnePlugin } from './dev-build-one-plugin'

const REPO_ROOT = resolve(import.meta.dir, '..')
const PLUGINS_DIR = join(REPO_ROOT, 'plugins')
const DEV_CLIENT_ENTRY = join(REPO_ROOT, 'packages/host/src/dev-client/client.ts')
const DEV_CLIENT_OUTDIR = join(REPO_ROOT, 'packages/host/public/__bakin-dev')

const CORE_PLUGINS = [
  'tasks', 'team', 'workflows', 'assets',
  'schedule', 'memory', 'models', 'health',
]

const EXTERNAL = [
  'react', 'react-dom', 'react-dom/client',
  'react/jsx-runtime', 'react/jsx-dev-runtime',
  '@tanstack/react-router',
  '@bakin/sdk', '@bakin/sdk/ui', '@bakin/sdk/hooks',
  '@bakin/sdk/components', '@bakin/sdk/slots',
  '@bakin/sdk/types', '@bakin/sdk/utils',
]

const DEFAULT_PLUGIN_DEV_WATCH = [
  'client.tsx', 'components/**', 'lib/**', '*.ts',
]

const DEBOUNCE_MS = 50

// ---------- Initial build ------------------------------------------------

async function runStep(label: string, cmd: string[]): Promise<void> {
  console.log(`[dev] ${label}...`)
  const proc = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', cwd: REPO_ROOT })
  const code = await proc.exited
  if (code !== 0) {
    console.error(`[dev] ${label} failed (exit ${code})`)
    process.exit(1)
  }
}

async function buildDevClient(): Promise<void> {
  console.log('[dev] building dev-client...')
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
    console.error('[dev] dev-client build failed:')
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}

// ---------- Tailwind child process --------------------------------------

let tailwindChild: ChildProcess | null = null

function startTailwindWatch(): void {
  console.log('[dev] starting tailwind --watch=always...')
  // --watch=always keeps the watcher alive when stdin is closed (we use
  // stdio:'ignore' for stdin). Plain --watch exits on stdin close and
  // silently stops emitting output.
  tailwindChild = nodeSpawn(
    'bunx',
    [
      '@tailwindcss/cli',
      '-i', './packages/host/src/globals.css',
      '-o', './packages/host/public/globals.css',
      '--watch=always',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'], cwd: REPO_ROOT },
  )
  tailwindChild.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.warn(`[dev] tailwind --watch exited with code ${code}`)
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
    console.log('[dev] shell rebuilt')
  } else {
    const stderr = await new Response(proc.stderr).text()
    emitError('shell', 'shell build failed', stderr)
    console.error('[dev] shell rebuild failed:\n' + stderr)
  }
}

async function rebuildPlugin(id: string): Promise<void> {
  broadcast({ type: 'dev:building', scope: 'plugin' })
  const result = await buildOnePlugin(id, { external: EXTERNAL })
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
    console.log(`[dev] plugin ${id} rebuilt → hot-swap ${version}`)
  } else {
    emitError('plugin', `plugin ${id} build failed`, result.stderr)
    console.error(`[dev] plugin ${id} rebuild failed:\n${result.stderr}`)
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
    console.log('[dev] sdk (vendor bundles) rebuilt')
  } else {
    const stderr = await new Response(proc.stderr).text()
    emitError('sdk', 'sdk build failed', stderr)
    console.error('[dev] sdk rebuild failed:\n' + stderr)
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
  const publicDir = join(REPO_ROOT, 'packages/host/public')
  const cssOutput = join(publicDir, 'globals.css')
  let lastMtime = existsSync(cssOutput) ? statSync(cssOutput).mtimeMs : 0
  const watcher = chokidar.watch(publicDir, { ignoreInitial: true, depth: 0 })
  watcher.on('all', (event, path) => {
    if (path !== cssOutput) return
    if (event !== 'change' && event !== 'add') return
    if (!existsSync(cssOutput)) return
    const m = statSync(cssOutput).mtimeMs
    if (m === lastMtime) return
    lastMtime = m
    broadcast({ type: 'dev:css' })
    console.log('[dev] css updated')
  })
}

// ---------- Shutdown ----------------------------------------------------

function registerShutdown(): void {
  const cleanup = () => {
    if (tailwindChild && !tailwindChild.killed) tailwindChild.kill('SIGTERM')
  }
  process.on('SIGINT', () => { cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { cleanup(); process.exit(0) })
  process.on('exit', cleanup)
}

// ---------- Main --------------------------------------------------------

async function main(): Promise<void> {
  registerShutdown()

  // Prime the tree — same as the production prestart minus assets-manifest
  // (disk fallback in _static.ts covers dev).
  await runStep('build:css', ['bun', 'run', 'build:css'])
  await runStep('build:vendors', ['bun', 'run', 'build:vendors'])
  await runStep('build:plugins', ['bun', 'run', 'build:plugins'])
  await runStep('build:host-shell', ['bun', 'run', 'build:host-shell'])

  await buildDevClient()

  startTailwindWatch()
  startShellWatcher()
  startPluginWatchers()
  startSdkWatcher()
  startCssWatcher()

  console.log('[dev] watchers ready — starting server...')
  await import('../server')
}

await main()

export {}
