/**
 * The ONE Bakin service-setup engine (self-healing PR1 slice 1.3c): the unit
 * files (`~/Library/LaunchAgents/com.makinbakin.bakin.plist`, the systemd user
 * unit), what they launch, and the load decision. Two callers:
 *
 * - `bakin setup service` (`restart: true`): write, load and (re)start the
 *   job, then wait for the server to answer — the operator asked for it.
 * - Health's `service-setup` repair (`restart: false`): write the unit and
 *   load it only when nothing would be killed or doubled — a loaded job is
 *   left alone (it picks the new definition up at its next restart), and a
 *   server running OUTSIDE the service defers the load (launchd's KeepAlive
 *   would otherwise fight it for the port forever). Restarting Bakin from a
 *   repair is the maintenance coordinator's job (PR3).
 *
 * Every side effect goes through `ServiceSetupIo` so the decision is testable
 * without launchd; `realServiceSetupIo()` is the production binding.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { getBakinPaths, getContentDir } from '@/core/content-dir'
import { liveServerBaseUrl, readServerLock } from '@/core/server-lock'

export const SERVICE_LABEL = 'com.makinbakin.bakin'
export const LEGACY_SERVICE_LABELS = ['com.bakin.mc'] as const

/** A stuck service manager must never hang a repair or the CLI past its own deadlines. */
const SERVICE_COMMAND_TIMEOUT_MS = 10_000

export interface ServerLaunchSpec {
  programArgs: string[]
  workingDir: string
}

export interface ServiceSetupIo {
  platform: string
  homedir(): string
  uid(): string
  launch(): Promise<ServerLaunchSpec>
  environment(): Promise<Record<string, string>>
  exec(cmd: string, args: string[]): { ok: boolean; output: string }
  exists(path: string): boolean
  readFile(path: string): string | null
  writeFile(path: string, text: string): void
  mkdir(path: string): void
  unlink(path: string): void
  /** A Bakin server for this home running OUTSIDE the managed job (its lock's pid alive and not the job's), or null. */
  serverOutsideService(loadedPid: number | null): { pid: number } | null
  waitForServer(): Promise<{ ok: true; version: string } | { ok: false }>
}

export interface ServiceSetupOptions {
  /** Remove the unit and stop the job instead of installing. */
  uninstall?: boolean
  /** Load and (re)start the job (the CLI). False = the repair's never-kill, never-double rule. */
  restart: boolean
}

export interface ServiceSetupResult {
  ok: boolean
  platform: string
  /** The job's name as the manager knows it (label on macOS, `<label>.service` on Linux). */
  service: string
  unitPath: string
  written: boolean
  loaded: 'started' | 'restarted' | 'kept' | 'deferred' | 'removed' | 'not-loaded'
  message: string
  started?: { ok: true; version: string } | { ok: false }
  logs: { stdout: string; stderr: string }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function systemdEscape(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function isBunVirtualPath(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith('/$bunfs/')
}

function currentExecutable(): string {
  for (const candidate of [process.execPath, process.argv[0]]) {
    if (candidate && !isBunVirtualPath(candidate)) return candidate
  }
  return 'bakin'
}

/** What the service runs: the checkout's server.ts under a script run, the binary's `serve` otherwise. */
export async function resolveServerLaunchSpec(): Promise<ServerLaunchSpec> {
  const argvScript = process.argv[1]
  if (argvScript && !isBunVirtualPath(argvScript) && /\.(ts|js|mjs|cjs)$/.test(argvScript)) {
    // This file lives at src/core/; the project root is two levels up.
    const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const serverPath = join(projectDir, 'server.ts')
    if (existsSync(serverPath)) {
      return { programArgs: [currentExecutable(), serverPath, 'serve'], workingDir: projectDir }
    }
    return { programArgs: [currentExecutable(), argvScript, 'serve'], workingDir: projectDir }
  }
  return { programArgs: [currentExecutable(), 'serve'], workingDir: getBakinPaths().home }
}

/** This home, absolute and canonical — frozen before anything changes directory. */
export function canonicalHome(): string {
  const home = resolve(getContentDir())
  try {
    return realpathSync(home)
  } catch {
    return home // not created yet: the resolved absolute path is the identity
  }
}

/**
 * The environment a service (or a restart's replacement) runs with. It
 * ALWAYS names this home as an absolute, canonical `BAKIN_HOME` — the
 * default home too — so the service's next launch is unambiguously this
 * home's and a relative path can never be resolved against another cwd
 * (#898 K).
 */
export async function serviceEnvironment(): Promise<Record<string, string>> {
  const env: Record<string, string> = {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    BAKIN_HOME: canonicalHome(),
  }
  if (process.env.PORT) env.PORT = process.env.PORT
  return env
}

export async function waitForServerVersion(timeoutSeconds = 15): Promise<{ ok: true; version: string } | { ok: false }> {
  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    // Re-resolve each poll from THIS home's live lock only (the server just
    // started writes its own): never a guessed default port another home may
    // own, and never BAKIN_URL — a remote target can't verify a local start.
    const baseUrl = liveServerBaseUrl({})
    if (!baseUrl) continue
    try {
      const res = await fetch(`${baseUrl}/api/version`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { version?: unknown }
        return { ok: true, version: typeof data.version === 'string' ? data.version : 'unknown' }
      }
    } catch { /* not ready yet */ }
  }
  return { ok: false }
}

interface UnitInputs {
  programArgs: string[]
  environment: Record<string, string>
  workingDir: string
  stdoutPath: string
  stderrPath: string
}

export function generateLaunchAgentPlist(opts: UnitInputs): string {
  const args = opts.programArgs.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n')
  const env = Object.entries(opts.environment)
    .map(([key, value]) => `    <key>${xmlEscape(key)}</key>\n    <string>${xmlEscape(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(opts.workingDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(opts.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(opts.stderrPath)}</string>
</dict>
</plist>
`
}

export function generateSystemdUnit(opts: UnitInputs): string {
  const env = Object.entries(opts.environment)
    .map(([key, value]) => `Environment=${systemdEscape(`${key}=${value}`)}`)
    .join('\n')
  return `[Unit]
Description=Bakin server
After=network.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(opts.workingDir)}
ExecStart=${opts.programArgs.map(systemdEscape).join(' ')}
Restart=on-failure
RestartSec=3
${env}
StandardOutput=append:${opts.stdoutPath}
StandardError=append:${opts.stderrPath}

[Install]
WantedBy=default.target
`
}

export async function realServiceSetupIo(): Promise<ServiceSetupIo> {
  return {
    platform: process.platform,
    homedir,
    uid: () => execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim(),
    launch: resolveServerLaunchSpec,
    environment: serviceEnvironment,
    exec: (cmd, args) => {
      try {
        const output = execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: SERVICE_COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL' })
        return { ok: true, output: typeof output === 'string' ? output : '' }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string }
        return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` || (e.message ?? '') }
      }
    },
    exists: (path) => existsSync(path),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
    writeFile: (path, text) => { writeFileSync(path, text, 'utf-8') },
    mkdir: (path) => { mkdirSync(path, { recursive: true }) },
    unlink: (path) => { unlinkSync(path) },
    serverOutsideService: (loadedPid) => {
      const lock = readServerLock()
      if (!lock || lock.pid === loadedPid) return null
      try {
        process.kill(lock.pid, 0)
        return { pid: lock.pid }
      } catch (err) {
        return (err as { code?: string }).code === 'EPERM' ? { pid: lock.pid } : null
      }
    },
    waitForServer: () => waitForServerVersion(),
  }
}

function unitPathFor(io: ServiceSetupIo, label: string): string {
  return io.platform === 'darwin'
    ? join(io.homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
    : join(io.homedir(), '.config', 'systemd', 'user', `${label}.service`)
}

/** Whether the manager holds the job now, and the pid it runs (null = loaded but not running). */
function readLoaded(io: ServiceSetupIo): { loaded: boolean; pid: number | null } {
  if (io.platform === 'darwin') {
    const printed = io.exec('launchctl', ['print', `gui/${io.uid()}/${SERVICE_LABEL}`])
    if (!printed.ok) return { loaded: false, pid: null }
    const pid = /^\tpid = (\d+)\s*$/m.exec(printed.output)?.[1]
    return { loaded: true, pid: pid ? Number(pid) : null }
  }
  const shown = io.exec('systemctl', ['--user', 'show', `${SERVICE_LABEL}.service`, '-p', 'LoadState', '-p', 'MainPID'])
  if (!shown.ok || !/^LoadState=loaded$/m.test(shown.output)) return { loaded: false, pid: null }
  const pid = /^MainPID=(\d+)$/m.exec(shown.output)?.[1]
  return { loaded: true, pid: pid && pid !== '0' ? Number(pid) : null }
}

export async function setupBakinService(options: ServiceSetupOptions, io: ServiceSetupIo): Promise<ServiceSetupResult> {
  const darwin = io.platform === 'darwin'
  const linux = io.platform === 'linux'
  const paths = getBakinPaths()
  const logs = { stdout: join(paths.logs, 'server.out.log'), stderr: join(paths.logs, 'server.err.log') }
  const service = darwin ? SERVICE_LABEL : `${SERVICE_LABEL}.service`
  if (!darwin && !linux) {
    return { ok: false, platform: io.platform, service, unitPath: '', written: false, loaded: 'not-loaded', message: `Service management is not supported on ${io.platform}.`, logs }
  }
  const unitPath = unitPathFor(io, SERVICE_LABEL)
  const base = { platform: io.platform, service, unitPath, logs }
  const uid = () => io.uid()

  const removeUnit = (path: string, { always = false } = {}) => {
    if (darwin && (always || io.exists(path))) io.exec('launchctl', ['bootout', `gui/${uid()}`, path])
    if (io.exists(path)) io.unlink(path)
  }

  if (options.uninstall) {
    if (darwin) {
      removeUnit(unitPath, { always: true })
      for (const label of LEGACY_SERVICE_LABELS) removeUnit(unitPathFor(io, label))
    } else {
      io.exec('systemctl', ['--user', 'disable', '--now', service])
      if (io.exists(unitPath)) io.unlink(unitPath)
      io.exec('systemctl', ['--user', 'daemon-reload'])
    }
    return { ...base, ok: true, written: false, loaded: 'removed', message: 'Bakin autostart disabled.' }
  }

  const launch = await io.launch()
  const environment = await io.environment()
  io.mkdir(paths.logs)
  const inputs: UnitInputs = { programArgs: launch.programArgs, environment, workingDir: launch.workingDir, stdoutPath: logs.stdout, stderrPath: logs.stderr }
  const text = darwin ? generateLaunchAgentPlist(inputs) : generateSystemdUnit(inputs)

  if (options.restart) {
    io.mkdir(dirname(unitPath))
    if (darwin) {
      removeUnit(unitPath, { always: true })
      for (const label of LEGACY_SERVICE_LABELS) removeUnit(unitPathFor(io, label))
      io.writeFile(unitPath, text)
      io.exec('launchctl', ['bootstrap', `gui/${uid()}`, unitPath])
      io.exec('launchctl', ['kickstart', '-k', `gui/${uid()}/${SERVICE_LABEL}`])
    } else {
      io.writeFile(unitPath, text)
      io.exec('systemctl', ['--user', 'daemon-reload'])
      io.exec('systemctl', ['--user', 'enable', '--now', service])
    }
    const started = await io.waitForServer()
    return {
      ...base,
      ok: true,
      written: true,
      loaded: 'restarted',
      started,
      message: started.ok ? 'Bakin autostart enabled.' : 'Bakin autostart enabled, but the service did not respond.',
    }
  }

  // The repair: never kill, never double.
  const state = readLoaded(io)
  io.mkdir(dirname(unitPath))
  io.writeFile(unitPath, text)
  if (darwin) for (const label of LEGACY_SERVICE_LABELS) removeUnit(unitPathFor(io, label))
  if (state.loaded) {
    return { ...base, ok: true, written: true, loaded: 'kept', message: 'The service definition was rewritten; the running service keeps its current definition until its next restart.' }
  }
  const outside = io.serverOutsideService(state.pid)
  if (outside) {
    return {
      ...base,
      ok: true,
      written: true,
      loaded: 'deferred',
      message: `Bakin is running outside the managed service (pid ${outside.pid}). The service definition is installed; it takes over after the next \`bakin restart\` or login.`,
    }
  }
  const load = darwin
    ? io.exec('launchctl', ['bootstrap', `gui/${uid()}`, unitPath])
    : (io.exec('systemctl', ['--user', 'daemon-reload']), io.exec('systemctl', ['--user', 'enable', '--now', service]))
  if (!load.ok) {
    return { ...base, ok: false, written: true, loaded: 'not-loaded', message: `The service definition was written but the service manager refused to load it: ${load.output.trim().slice(0, 300) || 'no output'}` }
  }
  return { ...base, ok: true, written: true, loaded: 'started', message: 'Bakin service installed and started.' }
}
