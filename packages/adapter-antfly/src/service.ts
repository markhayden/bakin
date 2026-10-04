/**
 * OS-supervised antfly lifecycle (spec D3, plan A6). Bakin stops being a
 * part-time process supervisor: the OS owns start/keep-alive/crash-restart.
 *
 *   - macOS: a LaunchAgent (`~/Library/LaunchAgents/io.bakin.antfly.plist`,
 *     KeepAlive=true) managed via launchctl bootstrap/kickstart/bootout
 *     with ownership checked before all lifecycle changes.
 *   - Linux: a systemd user unit (`~/.config/systemd/user/bakin-antfly.service`,
 *     Restart=always) via systemctl --user.
 *   - No service manager (Docker rig, CI, tests): strict attached child —
 *     spawn on start, kill on shutdown. No adoption, no sidecar, no ladder.
 *   - Guest mode (non-default URL): the engine is externally managed —
 *     never provision, never spawn, never touch disk.
 *
 * Provisioning is idempotent by construction: the rendered unit file IS the
 * settings fingerprint. `ensureProvisioned` byte-compares desired vs
 * on-disk; identical → nothing to do; drift (pin bump, embedder change →
 * different --preload-model args) → rewrite + restart. This replaces the
 * old sidecar fingerprint + adoption lattice wholesale.
 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, openSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { createConnection } from 'net'
import { dirname, join, resolve } from 'path'
import { createLogger } from '@bakin/core/logger'
import { getBakinPaths } from '@bakin/core/content-dir'
import { atomicWriteText } from '@bakin/core/storage/atomic-write'
import { canonicalPath, evaluateOwnership, type ServiceOwnership, type OwnershipKind } from './service-ownership'
import { withServiceLock, serviceLockBusy } from './service-lock'
import { antflyBinaryPath, antflyHome, inferenceModelsRoot } from './paths'
import { modelStructurallyComplete } from './model-pins'
import type { AntflySettings } from './defaults'

const log = createLogger('antfly-service')

export type ServiceMode = 'launchd' | 'systemd' | 'child' | 'guest'

export const LAUNCHD_LABEL = 'io.bakin.antfly'
export const SYSTEMD_UNIT = 'bakin-antfly.service'

/** Command runner seam — tests inject a recorder; prod shells out. */
export type ExecRunner = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>

export interface ServiceIo {
  platform: NodeJS.Platform
  exec: ExecRunner
  hasCommand: (cmd: string) => boolean
  env: Record<string, string | undefined>
  /** Preload pre-check probe (structural model-distribution completeness).
   *  Injectable so unit-rendering tests are independent of local model
   *  state; defaults to the real on-disk check. */
  modelReady?: (model: string) => boolean
  tempRoots?: readonly string[]
  portsReleased?: () => Promise<boolean>
}

async function realExec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', () => resolve({ code: 127, stdout, stderr }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

function realHasCommand(cmd: string): boolean {
  const dirs = (process.env.PATH ?? '').split(':')
  return dirs.some((dir) => dir.length > 0 && existsSync(join(dir, cmd)))
}

export function defaultServiceIo(): ServiceIo {
  return { platform: process.platform, exec: realExec, hasCommand: realHasCommand, env: process.env }
}

/**
 * Installed binary path, or null. ANTFLY_PATH overrides discovery (dev
 * builds, tests); the installer version-guards overridden binaries.
 */
export function findAntflyBinary(): string | null {
  const candidates = [process.env.ANTFLY_PATH, antflyBinaryPath()]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

export function isAntflyInstalled(): boolean {
  return findAntflyBinary() !== null
}

/** The default private-instance URL — anything else is guest mode. */
export function isLocalDefaultUrl(url: string): boolean {
  const origin = new URL(url).origin
  return origin === 'http://127.0.0.1:3738' || origin === 'http://localhost:3738'
}

export function detectServiceMode(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): ServiceMode {
  if (!isLocalDefaultUrl(settings.url)) return 'guest'
  const override = io.env.BAKIN_SEARCH_SERVICE_MODE
  if (override === 'launchd' || override === 'systemd' || override === 'child') return override
  // Test runs must NEVER reach the machine-global service unit: a test that
  // misses one io-injection seam otherwise rewrites the REAL LaunchAgent to
  // point at its temp dir and bounces production search (it happened —
  // 2026-07-22, second incident of this class after 2026-07-11). bun test
  // sets NODE_ENV=test; an explicit BAKIN_SEARCH_SERVICE_MODE override
  // above still wins for integration tests that genuinely need a unit.
  if (io.env.NODE_ENV === 'test' || io.env.VITEST) return 'child'
  if (io.platform === 'darwin' && io.hasCommand('launchctl')) return 'launchd'
  if (io.platform === 'linux' && io.hasCommand('systemctl')) return 'systemd'
  return 'child'
}

// ---------------------------------------------------------------------------
// Argv + unit rendering (pure)
// ---------------------------------------------------------------------------

export interface ServicePaths {
  binary: string
  dataDir: string
  modelsDir: string
  logFile: string
}

export function servicePaths(): ServicePaths {
  const home = canonicalPath(getBakinPaths().home)
  return {
    binary: resolve(antflyBinaryPath()),
    dataDir: join(home, 'antfly'),
    modelsDir: resolve(inferenceModelsRoot()),
    // Same file the log-tail annotation pipeline (server-logs.ts) reads.
    logFile: join(home, 'logs', 'antfly.log'),
  }
}

/**
 * The server argv — identical across launchd/systemd/child so behavior never
 * depends on the supervisor. Preloads every antfly-provider embedder so the
 * first embed doesn't hit a cold-model-load-vs-timeout wedge.
 * (`standalone` is the single-process server subcommand since rc.19 renamed
 * `swarm`; the 0.2.0 pin requires it — `swarm` no longer exists.)
 *
 * Preload pre-check: the engine EXITS on a preload it cannot load instead
 * of degrading, and the supervisor's respawn turns one broken model into
 * an invisible crash loop (161 respawns before diagnosis, 2026-07-21).
 * Models failing the structural distribution check are left OFF the argv —
 * the engine boots, that leg degrades honestly, and the models health
 * check names the broken model. `modelReady` is injectable for tests.
 */
export function buildServiceArgv(
  settings: AntflySettings,
  paths: ServicePaths,
  opts?: { modelReady?: (model: string) => boolean },
): string[] {
  const url = new URL(settings.url)
  const port = Number(url.port || 3738)
  const modelReady = opts?.modelReady ?? ((model: string) => modelStructurallyComplete(model).ok)
  const preloads = [...new Set(
    Object.values(settings.embedders)
      .filter((e) => e.provider === 'antfly')
      .filter((e) => modelReady(e.model))
      .map((e) => `embedder:${e.model}`),
  )]
  return [
    paths.binary, 'standalone',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--health-port', String(port + 1),
    '--data-dir', paths.dataDir,
    '--models-dir', paths.modelsDir,
    ...preloads.flatMap((p) => ['--preload-model', p]),
  ]
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

// NumberOfFiles/LimitNOFILE: launchd/systemd services get the OS default
// fd limit (macOS soft limit is 256!) — nothing like the shell limits the
// old child spawn inherited. An LSM engine with N tables x shards x
// segment files exhausts 256 instantly (ProcessFdQuotaExceeded, observed
// at the rc.17 cutover as boot-wide flakiness + an exit-6 crash).
export function renderLaunchdPlist(argv: string[], logFile: string): string {
  const args = argv.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>65536</integer>
  </dict>
  <key>HardResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>65536</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logFile)}</string>
</dict>
</plist>
`
}

export function renderSystemdUnit(argv: string[], logFile: string): string {
  // systemd.service(5): $$ and %% preserve literal expansion characters.
  const exec = argv.map((a) => {
    if (/[\r\n\0]/.test(a)) throw new Error('Unsupported control character in service argument')
    const escaped = a.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', () => '$$').replaceAll('%', '%%')
    return /[\s"'\\$%]/.test(a) ? `"${escaped}"` : escaped
  }).join(' ')
  return `# Managed by Bakin — do not edit (bakin install search rewrites this file).
[Unit]
Description=Bakin private antfly search engine

[Service]
ExecStart=${exec}
Restart=always
RestartSec=2
LimitNOFILE=65536
StandardOutput=append:${logFile.replaceAll('%', '%%')}
StandardError=append:${logFile.replaceAll('%', '%%')}

[Install]
WantedBy=default.target
`
}

export function launchdPlistPath(io: ServiceIo = defaultServiceIo()): string {
  return join(io.env.HOME ?? homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)
}

export function systemdUnitPath(io: ServiceIo = defaultServiceIo()): string {
  return join(io.env.HOME ?? homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT)
}

// ---------------------------------------------------------------------------
// Provisioning + control
// ---------------------------------------------------------------------------

export interface ServiceAccess {
  mode: ServiceMode
  allowed: boolean
  ownership?: ServiceOwnership
  reason?: OwnershipKind | 'busy'
  detail: string
  remediation?: 'install' | 'configure-endpoint' | 'retry'
  unitPath?: string
}
export interface ServiceIntent { intent?: 'install' | 'setup' }

function supervisedMode(io: ServiceIo): 'launchd' | 'systemd' | undefined {
  if (io.env.BAKIN_SEARCH_SERVICE_MODE === 'launchd') return 'launchd'
  if (io.env.BAKIN_SEARCH_SERVICE_MODE === 'systemd') return 'systemd'
  // Unit tests must inject a native mode explicitly; never inspect real units.
  if (io.env.NODE_ENV === 'test' || io.env.VITEST) return undefined
  if (io.platform === 'darwin' && io.hasCommand('launchctl')) return 'launchd'
  if (io.platform === 'linux' && io.hasCommand('systemctl')) return 'systemd'
  return undefined
}

export function getServiceAccess(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): ServiceAccess {
  const mode = detectServiceMode(settings, io)
  if (mode === 'guest') return { mode, allowed: true, detail: `Externally managed (${settings.url}).` }
  const supervisor = supervisedMode(io)
  const unitPath = supervisor === 'launchd' ? launchdPlistPath(io) : supervisor === 'systemd' ? systemdUnitPath(io) : undefined
  const ownership = evaluateOwnership({
    home: getBakinPaths().home, mode: supervisor, unitPath,
    tempRoots: io.tempRoots ?? ['/tmp', '/private/tmp', '/var/tmp', io.env.TMPDIR ?? tmpdir()],
  })
  if (mode === 'child' && supervisor) {
    const detail = 'A child-mode override cannot manage the native search service. Unset BAKIN_SEARCH_SERVICE_MODE or configure an isolated guest endpoint.'
    return { mode, unitPath, allowed: false, ownership: { ...ownership, claimable: false }, reason: 'unknown-owner', remediation: 'configure-endpoint', detail }
  }
  const access: ServiceAccess = {
    mode, ownership, unitPath, allowed: ownership.kind === 'owner',
    detail: ownership.detail,
    ...(ownership.kind === 'owner' ? {} : {
      reason: ownership.kind,
      remediation: ownership.claimable ? 'install' : 'configure-endpoint',
    } as const),
  }
  // A refusal requires no more shared-state reads, let alone writes.
  if (access.allowed && serviceLockBusy(serviceLockPath(access))) {
    return { ...access, allowed: false, reason: 'busy', remediation: 'retry', detail: `Search service change in progress (${serviceLockPath(access)}). Retry when it finishes; after a crash, stop all service-changing processes before clearing the lock.` }
  }
  return access
}

function serviceLockPath(access: ServiceAccess): string {
  return access.unitPath ? `${access.unitPath}.lock` : join(antflyHome(), 'service.lock')
}

function assertAccess(access: ServiceAccess, opts: ServiceIntent): void {
  if (access.allowed) return
  if (access.ownership?.claimable && access.reason !== 'busy') {
    if (opts.intent === 'install' || (opts.intent === 'setup' && access.reason === 'unclaimed-home')) return
  }
  throw new Error(access.detail)
}

/** The outer installer/reset holds this across every nested control and data mutation. */
export async function withServiceOperation<T>(settings: AntflySettings, io: ServiceIo, opts: ServiceIntent, fn: () => Promise<T>): Promise<T> {
  const access = getServiceAccess(settings, io)
  if (access.mode === 'guest') throw new Error(`Search is externally managed (${settings.url}); manage it at its endpoint.`)
  assertAccess(access, opts)
  return withServiceLock(serviceLockPath(access), async () => {
    assertAccess(getServiceAccess(settings, io), opts)
    return fn()
  })
}

export interface AntflyServiceStatus {
  mode: ServiceMode
  provisioned: boolean
  detail?: string
  refusal?: { reason: string; detail: string; remediation: 'install' | 'configure-endpoint' | 'retry' }
}

export function getAntflyServiceStatus(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): AntflyServiceStatus {
  const access = getServiceAccess(settings, io)
  return {
    mode: access.mode, provisioned: access.allowed, detail: access.detail,
    ...(!access.allowed ? { refusal: { reason: access.reason!, detail: access.detail, remediation: access.remediation! } } : {}),
  }
}

export interface EnsureResult {
  mode: ServiceMode
  action: 'unchanged' | 'provisioned' | 'restarted' | 'reloaded' | 'skipped' | `refused-${OwnershipKind | 'busy'}`
  detail?: string
}

const launchdTarget = () => `gui/${typeof process.getuid === 'function' ? process.getuid() : 501}`
async function checkedExec(io: ServiceIo, cmd: string, args: string[]): Promise<void> {
  const result = await io.exec(cmd, args)
  if (result.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${result.code}): ${result.stderr || result.stdout}`)
}

/** No readiness probe can prove a port is free: an unready engine still binds it. */
export async function assertServicePortsReleased(io: ServiceIo = defaultServiceIo()): Promise<void> {
  if (io.portsReleased) {
    if (!await io.portsReleased()) throw new Error('Search API/health ports are still occupied. Stop the unrelated listener manually before installing search.')
    return
  }
  for (const port of [3738, 3739]) {
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.setTimeout(1500)
      socket.once('connect', () => { socket.destroy(); reject(new Error(`Search port ${port} is still occupied. Stop the unrelated listener manually before installing search.`)) })
      socket.once('timeout', () => { socket.destroy(); reject(new Error(`Could not establish whether search port ${port} is free.`)) })
      socket.once('error', (err: NodeJS.ErrnoException) => { socket.destroy(); if (err.code === 'ECONNREFUSED') resolve(); else reject(err) })
    })
  }
}

async function stopSupervised(mode: ServiceMode, io: ServiceIo): Promise<void> {
  if (mode === 'launchd') {
    const target = `${launchdTarget()}/${LAUNCHD_LABEL}`
    const stopped = await io.exec('launchctl', ['bootout', target])
    if (stopped.code !== 0) {
      const state = await io.exec('launchctl', ['print', target])
      if (state.code !== 113) throw new Error(`Cannot stop search service: ${stopped.stderr || state.stderr}`)
    }
  } else if (mode === 'systemd') {
    const stopped = await io.exec('systemctl', ['--user', 'stop', SYSTEMD_UNIT])
    if (stopped.code !== 0) {
      const state = await io.exec('systemctl', ['--user', 'show', SYSTEMD_UNIT, '--property=LoadState', '--value'])
      if (state.code !== 0 || state.stdout.trim() !== 'not-found') throw new Error(`Cannot stop search service: ${stopped.stderr || state.stderr}`)
    }
  } else await stopChildAndWait()
  await assertServicePortsReleased(io)
}

export async function ensureProvisioned(settings: AntflySettings, io: ServiceIo = defaultServiceIo(), opts: ServiceIntent = {}): Promise<EnsureResult> {
  const access = getServiceAccess(settings, io)
  if (access.mode === 'guest') return { mode: access.mode, action: 'skipped' }
  try { assertAccess(access, opts) } catch {
    log.warn('Search service ownership refused', { ...access })
    return { mode: access.mode, action: `refused-${access.reason!}`, detail: access.detail }
  }
  return withServiceOperation(settings, io, opts, async () => {
    const mode = detectServiceMode(settings, io)
    if (mode === 'child') return { mode, action: 'skipped' }
    const paths = servicePaths()
    const argv = buildServiceArgv(settings, paths, { modelReady: io.modelReady })
    const unitPath = mode === 'launchd' ? launchdPlistPath(io) : systemdUnitPath(io)
    const desired = mode === 'launchd' ? renderLaunchdPlist(argv, paths.logFile) : renderSystemdUnit(argv, paths.logFile)
    const current = existsSync(unitPath) ? readFileSync(unitPath, 'utf8') : null
    if (current === desired) {
      const state = mode === 'launchd'
        ? await io.exec('launchctl', ['print', `${launchdTarget()}/${LAUNCHD_LABEL}`])
        : await io.exec('systemctl', ['--user', 'is-active', SYSTEMD_UNIT])
      if (state.code === 0 || (mode === 'systemd' && state.stdout.trim() === 'activating')) return { mode, action: 'unchanged' }
      // Only a known unloaded/stopped state is recoverable, not permission/transport failures.
      if (mode === 'launchd' && state.code !== 113) throw new Error(`Cannot inspect search service: ${state.stderr}`)
      if (mode === 'systemd' && !['inactive', 'failed', 'unknown'].includes(state.stdout.trim())) throw new Error(`Cannot inspect search service: ${state.stderr}`)
      await assertServicePortsReleased(io)
      if (mode === 'launchd') await checkedExec(io, 'launchctl', ['bootstrap', launchdTarget(), unitPath])
      else {
        // A previous attempt may have published this unit but failed to reload
        // or enable it. Never restart with the manager's cached previous owner.
        await checkedExec(io, 'systemctl', ['--user', 'daemon-reload'])
        await checkedExec(io, 'systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT])
      }
      return { mode, action: 'reloaded' }
    }
    // Stop BEFORE publishing new ownership. A healthy old engine is never proof of a successful claim.
    await stopSupervised(mode, io)
    mkdirSync(dirname(paths.logFile), { recursive: true })
    mkdirSync(paths.dataDir, { recursive: true })
    atomicWriteText(unitPath, desired)
    if (mode === 'launchd') await checkedExec(io, 'launchctl', ['bootstrap', launchdTarget(), unitPath])
    else {
      await checkedExec(io, 'systemctl', ['--user', 'daemon-reload'])
      await checkedExec(io, 'systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT])
    }
    if (access.ownership?.ownerHome && access.ownership.kind === 'foreign-home') {
      log.info('Search service explicitly claimed', { from: access.ownership.ownerHome, to: access.ownership.home, unitPath })
    }
    return { mode, action: current === null ? 'provisioned' : 'restarted' }
  })
}

export async function stopService(settings: AntflySettings, io: ServiceIo = defaultServiceIo(), opts: ServiceIntent = {}): Promise<void> {
  return withServiceOperation(settings, io, opts, () => stopSupervised(detectServiceMode(settings, io), io))
}

export async function startService(settings: AntflySettings, io: ServiceIo = defaultServiceIo(), opts: ServiceIntent = {}): Promise<void> {
  return withServiceOperation(settings, io, opts, async () => {
    const mode = detectServiceMode(settings, io)
    if (mode === 'child') {
      if (childPid()) return
      await assertServicePortsReleased(io)
      startChild(settings, io)
      return
    }
    const ensured = await ensureProvisioned(settings, io, opts)
    if (ensured.action.startsWith('refused-')) throw new Error(ensured.detail)
  })
}

export async function restartService(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<void> {
  return withServiceOperation(settings, io, {}, async () => {
    await stopService(settings, io)
    await startService(settings, io)
  })
}

export async function removeService(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<void> {
  return withServiceOperation(settings, io, {}, async () => {
    const mode = detectServiceMode(settings, io)
    await stopService(settings, io)
    if (mode === 'launchd') rmSync(launchdPlistPath(io), { force: true })
    if (mode === 'systemd') {
      await checkedExec(io, 'systemctl', ['--user', 'disable', SYSTEMD_UNIT])
      rmSync(systemdUnitPath(io), { force: true })
      await checkedExec(io, 'systemctl', ['--user', 'daemon-reload'])
    }
  })
}

/**
 * SIGTERM the strict child and wait for it to exit (SIGKILL fallback after
 * the grace window — a child that ignores SIGTERM while wedged must still
 * release the port).
 */
export async function stopChildAndWait(graceMs = 10_000): Promise<void> {
  const child = g.__bakinAntflyChild
  stopChild()
  if (!child || child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
      resolve()
    }, graceMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Pid of the strict-child engine, when one is running (engine-status probe). */
export function childPid(): number | null {
  const child = g.__bakinAntflyChild
  return child && child.exitCode === null ? child.pid ?? null : null
}

// ---------------------------------------------------------------------------
// Strict child fallback (ephemeral environments only)
// ---------------------------------------------------------------------------

// globalThis so HMR/module re-eval never leaks a second child.
const g = globalThis as { __bakinAntflyChild?: ChildProcess | null }

export function startChild(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): void {
  assertAccess(getServiceAccess(settings, io), {})
  if (g.__bakinAntflyChild && g.__bakinAntflyChild.exitCode === null) return
  const paths = servicePaths()
  if (!existsSync(paths.binary)) {
    log.warn('antfly binary missing — child not started (run: bakin install search)', { binary: paths.binary })
    return
  }
  mkdirSync(dirname(paths.logFile), { recursive: true })
  mkdirSync(paths.dataDir, { recursive: true })
  const argv = buildServiceArgv(settings, paths, { modelReady: io.modelReady })
  const logFd = openSync(paths.logFile, 'a')
  const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', logFd, logFd] })
  g.__bakinAntflyChild = child
  child.on('exit', (code) => {
    log.warn('antfly child exited — search degrades until restart', { code })
    if (g.__bakinAntflyChild === child) g.__bakinAntflyChild = null
  })
  // Strict child: dies with us. No adoption, no sidecar, no restart ladder.
  process.once('exit', stopChild)
  log.info('antfly child started', { pid: child.pid })
}

export function stopChild(): void {
  const child = g.__bakinAntflyChild
  if (!child) return
  g.__bakinAntflyChild = null
  try {
    child.kill('SIGTERM')
  } catch {
    // already gone
  }
}
