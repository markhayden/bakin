/**
 * OS-supervised antfly lifecycle (spec D3, plan A6). Bakin stops being a
 * part-time process supervisor: the OS owns start/keep-alive/crash-restart.
 *
 *   - macOS: a LaunchAgent (`~/Library/LaunchAgents/io.bakin.antfly.plist`,
 *     KeepAlive=true) managed via launchctl bootstrap/kickstart/bootout
 *     (legacy load/unload fallback for older macOS).
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
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { createLogger } from '@bakin/core/logger'
import { getBakinPaths } from '@bakin/core/content-dir'
import { antflyBinaryPath, inferenceModelsRoot } from './paths'
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
  return url === 'http://127.0.0.1:3738' || url === 'http://localhost:3738'
}

export function detectServiceMode(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): ServiceMode {
  if (!isLocalDefaultUrl(settings.url)) return 'guest'
  const override = io.env.BAKIN_SEARCH_SERVICE_MODE
  if (override === 'launchd' || override === 'systemd' || override === 'child') return override
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
  const bakin = getBakinPaths()
  return {
    binary: antflyBinaryPath(),
    dataDir: join(bakin.home, 'antfly'),
    modelsDir: inferenceModelsRoot(),
    // Same file the log-tail annotation pipeline (server-logs.ts) reads.
    logFile: join(bakin.home, 'logs', 'antfly.log'),
  }
}

/**
 * The server argv — identical across launchd/systemd/child so behavior never
 * depends on the supervisor. Preloads every antfly-provider embedder so the
 * first embed doesn't hit a cold-model-load-vs-timeout wedge.
 * (`standalone` since rc.19 — upstream renamed the single-process
 * subcommand from `swarm`; flags are unchanged.)
 */
export function buildServiceArgv(settings: AntflySettings, paths: ServicePaths): string[] {
  const url = new URL(settings.url)
  const port = Number(url.port || 3738)
  const preloads = [...new Set(
    Object.values(settings.embedders)
      .filter((e) => e.provider === 'antfly')
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
  const exec = argv.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
  return `# Managed by Bakin — do not edit (bakin install search rewrites this file).
[Unit]
Description=Bakin private antfly search engine

[Service]
ExecStart=${exec}
Restart=always
RestartSec=2
LimitNOFILE=65536
StandardOutput=append:${logFile}
StandardError=append:${logFile}

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

export interface AntflyServiceStatus {
  mode: ServiceMode
  /** Unit file present for the detected service mode (n/a modes are true). */
  provisioned: boolean
  detail?: string
}

/** Cheap, read-only: one stat per call. Doctor/status surfaces only. */
export function getAntflyServiceStatus(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): AntflyServiceStatus {
  const mode = detectServiceMode(settings, io)
  if (mode === 'guest') return { mode, provisioned: true, detail: `externally managed (${settings.url})` }
  if (mode === 'child') return { mode, provisioned: true, detail: 'strict child (ephemeral environment)' }
  const unitPath = mode === 'launchd' ? launchdPlistPath(io) : systemdUnitPath(io)
  const provisioned = existsSync(unitPath)
  return { mode, provisioned, ...(provisioned ? {} : { detail: `unit file missing: ${unitPath}` }) }
}

export interface EnsureResult {
  mode: ServiceMode
  action: 'unchanged' | 'provisioned' | 'restarted' | 'skipped'
}

/** The --data-dir argument in a rendered plist/unit, for repoint detection. */
function extractDataDir(unitContent: string): string | null {
  const plist = /<string>--data-dir<\/string>\s*<string>([^<]+)<\/string>/.exec(unitContent)
  if (plist) return plist[1]
  const flat = /--data-dir\s+(\S+)/.exec(unitContent)
  return flat ? flat[1] : null
}

/**
 * The OS service is MACHINE-GLOBAL but its data dir follows whichever
 * BAKIN_HOME ran the install — an isolated/dev home can silently hijack the
 * service away from the production home. Rewrites that change the data dir
 * get a loud warning naming both sides so the repoint is never invisible.
 */
function warnOnDataDirRepoint(current: string | null, nextDataDir: string): void {
  if (current === null) return
  const previous = extractDataDir(current)
  if (previous && previous !== nextDataDir) {
    log.warn('search service data-dir REPOINTED — the OS service is machine-global and now serves a different Bakin home', {
      from: previous,
      to: nextDataDir,
      hint: 'run `bakin install search` from the home that should own the service to point it back',
    })
  }
}

/**
 * Idempotent provisioning: byte-compare the rendered unit with on-disk.
 * Identical → nothing (the whole boot-time cost is one file read). Drift →
 * rewrite + restart. Never blocks long; failures degrade honestly (search
 * unavailable → outbox queues, doctor reports).
 */
export async function ensureProvisioned(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<EnsureResult> {
  const mode = detectServiceMode(settings, io)
  if (mode === 'guest' || mode === 'child') return { mode, action: 'skipped' }

  const paths = servicePaths()
  const argv = buildServiceArgv(settings, paths)
  mkdirSync(dirname(paths.logFile), { recursive: true })
  mkdirSync(paths.dataDir, { recursive: true })

  if (mode === 'launchd') {
    const plistPath = launchdPlistPath(io)
    const desired = renderLaunchdPlist(argv, paths.logFile)
    const current = existsSync(plistPath) ? readFileSync(plistPath, 'utf-8') : null
    if (current === desired) return { mode, action: 'unchanged' }
    warnOnDataDirRepoint(current, paths.dataDir)
    mkdirSync(dirname(plistPath), { recursive: true })
    writeFileSync(plistPath, desired)
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    if (current !== null) {
      await io.exec('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`])
    }
    const bootstrap = await io.exec('launchctl', ['bootstrap', `gui/${uid}`, plistPath])
    if (bootstrap.code !== 0) {
      // Older macOS: fall back to the legacy subcommands.
      await io.exec('launchctl', ['unload', plistPath])
      const load = await io.exec('launchctl', ['load', plistPath])
      if (load.code !== 0) {
        log.error('launchd provisioning failed', undefined, { stderr: `${bootstrap.stderr} ${load.stderr}`.trim() })
      }
    }
    return { mode, action: current === null ? 'provisioned' : 'restarted' }
  }

  // systemd user unit
  const unitPath = systemdUnitPath(io)
  const desired = renderSystemdUnit(argv, paths.logFile)
  const current = existsSync(unitPath) ? readFileSync(unitPath, 'utf-8') : null
  if (current === desired) return { mode, action: 'unchanged' }
  warnOnDataDirRepoint(current, paths.dataDir)
  mkdirSync(dirname(unitPath), { recursive: true })
  writeFileSync(unitPath, desired)
  await io.exec('systemctl', ['--user', 'daemon-reload'])
  const enable = await io.exec('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT])
  if (current !== null) {
    await io.exec('systemctl', ['--user', 'restart', SYSTEMD_UNIT])
  }
  if (enable.code !== 0) {
    log.error('systemd provisioning failed', undefined, { stderr: enable.stderr, hint: 'headless boxes may need: loginctl enable-linger' })
  }
  return { mode, action: current === null ? 'provisioned' : 'restarted' }
}

/** Stop the supervised service (upgrades: stop → swap binary → start). */
export async function stopService(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<void> {
  const mode = detectServiceMode(settings, io)
  if (mode === 'launchd') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    await io.exec('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`])
  } else if (mode === 'systemd') {
    await io.exec('systemctl', ['--user', 'stop', SYSTEMD_UNIT])
  } else if (mode === 'child') {
    stopChild()
  }
}

export async function startService(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<void> {
  const mode = detectServiceMode(settings, io)
  if (mode === 'launchd') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    const kick = await io.exec('launchctl', ['kickstart', '-k', `gui/${uid}/${LAUNCHD_LABEL}`])
    if (kick.code !== 0) await ensureProvisioned(settings, io)
  } else if (mode === 'systemd') {
    await io.exec('systemctl', ['--user', 'start', SYSTEMD_UNIT])
  } else if (mode === 'child') {
    startChild(settings)
  }
}

/**
 * Gracefully restart the supervised engine (doctor repair for a wedged
 * engine). SIGTERM first so the engine can flush — a hard kill mid-write
 * is exactly what seeds the startup catch-up spin on the next boot.
 */
export async function restartService(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<void> {
  const mode = detectServiceMode(settings, io)
  if (mode === 'guest') {
    throw new Error(`engine is externally managed (${settings.url}) — restart it where it runs`)
  }
  if (mode === 'launchd') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    // SIGTERM + KeepAlive=true → launchd respawns the service cleanly.
    const kill = await io.exec('launchctl', ['kill', 'SIGTERM', `gui/${uid}/${LAUNCHD_LABEL}`])
    // Not loaded (or older macOS) — the one start path owns the fallbacks.
    if (kill.code !== 0) await startService(settings, io)
    return
  }
  if (mode === 'systemd') {
    const restart = await io.exec('systemctl', ['--user', 'restart', SYSTEMD_UNIT])
    if (restart.code !== 0) await ensureProvisioned(settings, io)
    return
  }
  // Strict child: wait for the old process to actually release the port —
  // spawning immediately races the dying engine for the 3738 bind, and a
  // bind-failure exit is never respawned (strict child, no restart ladder),
  // which would convert a wedged engine into a dead one (review finding).
  await stopChildAndWait()
  startChild(settings)
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

/** Remove the service entirely (uninstall path). */
export async function removeService(settings: AntflySettings, io: ServiceIo = defaultServiceIo()): Promise<void> {
  const mode = detectServiceMode(settings, io)
  if (mode === 'launchd') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    await io.exec('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`])
    rmSync(launchdPlistPath(io), { force: true })
  } else if (mode === 'systemd') {
    await io.exec('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT])
    rmSync(systemdUnitPath(io), { force: true })
    await io.exec('systemctl', ['--user', 'daemon-reload'])
  } else if (mode === 'child') {
    stopChild()
  }
}

// ---------------------------------------------------------------------------
// Strict child fallback (ephemeral environments only)
// ---------------------------------------------------------------------------

// globalThis so HMR/module re-eval never leaks a second child.
const g = globalThis as { __bakinAntflyChild?: ChildProcess | null }

export function startChild(settings: AntflySettings): void {
  if (g.__bakinAntflyChild && g.__bakinAntflyChild.exitCode === null) return
  const paths = servicePaths()
  if (!existsSync(paths.binary)) {
    log.warn('antfly binary missing — child not started (run: bakin install search)', { binary: paths.binary })
    return
  }
  mkdirSync(dirname(paths.logFile), { recursive: true })
  mkdirSync(paths.dataDir, { recursive: true })
  const argv = buildServiceArgv(settings, paths)
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
