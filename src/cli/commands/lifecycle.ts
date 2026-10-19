/**
 * `bakin {start,serve,stop,reboot,restart,logs,setup}` — server process
 * lifecycle: foreground start/serve, stop (incl. the explicit Antfly kill
 * path), reboot/restart, audit-log tailing, and LaunchAgent/systemd service
 * setup. Relocated verbatim from cli/bakin.ts (B5.3 command-module split);
 * the src/core/cli dependency stays a dynamic import (mutual-lazy contract).
 */
import { liveServerBaseUrl } from '../../core/server-lock'
import { jsonObject } from '../http'
import {
  printCommandFailureTui,
  exitCommandIssue,
  exitCommandFailure,
  exitUnknownSubcommand,
} from '../help'
import { printRuntimeActionTui } from './runtime'

const SERVICE_LABEL = 'com.makinbakin.bakin'
const LEGACY_SERVICE_LABELS = ['com.bakin.mc']

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

interface ServerLaunchSpec {
  programArgs: string[]
  workingDir: string
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

async function resolveServerLaunchSpec(): Promise<ServerLaunchSpec> {
  const { existsSync } = await import('fs')
  const { join, resolve, dirname } = await import('path')
  const argvScript = process.argv[1]
  if (argvScript && !isBunVirtualPath(argvScript) && /\.(ts|js|mjs|cjs)$/.test(argvScript)) {
    // This file lives at src/cli/commands/; the project root is three levels up
    // (cli/bakin.ts, where this logic originated, needed only one).
    const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', '..')
    const serverPath = join(projectDir, 'server.ts')
    if (existsSync(serverPath)) {
      return { programArgs: [currentExecutable(), serverPath, 'serve'], workingDir: projectDir }
    }
    return { programArgs: [currentExecutable(), argvScript, 'serve'], workingDir: projectDir }
  }
  const { getBakinPaths } = await import('../../../packages/core/src/content-dir')
  return { programArgs: [currentExecutable(), 'serve'], workingDir: getBakinPaths().home }
}

/**
 * The environment a service (or a restart's replacement) runs with. It
 * ALWAYS names this home as an absolute, canonical `BAKIN_HOME` — the
 * default home too — so the service's next launch is unambiguously this
 * home's and a relative path can never be resolved against another cwd
 * (#898 K).
 */
async function serviceEnvironment(): Promise<Record<string, string>> {
  const { canonicalHome } = await import('../lifecycle-io')
  const env: Record<string, string> = {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    BAKIN_HOME: canonicalHome(),
  }
  if (process.env.PORT) env.PORT = process.env.PORT
  return env
}

async function waitForServerVersion(timeoutSeconds = 15): Promise<{ ok: true; version: string } | { ok: false }> {
  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise(r => setTimeout(r, 1000))
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

function generateLaunchAgentPlist(opts: {
  programArgs: string[]
  environment: Record<string, string>
  workingDir: string
  stdoutPath: string
  stderrPath: string
}): string {
  const args = opts.programArgs.map(arg => `    <string>${xmlEscape(arg)}</string>`).join('\n')
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

function generateSystemdUnit(opts: {
  programArgs: string[]
  environment: Record<string, string>
  workingDir: string
  stdoutPath: string
  stderrPath: string
}): string {
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

async function cmdStartServer(command: 'start' | 'serve', args: string[] = []): Promise<void> {
  if (command === 'start') {
    const { dispatchCli } = await import('../../core/cli')
    const result = await dispatchCli(['bun', 'bakin', 'start', ...args])
    if (!result.startServer) {
      process.exitCode = result.exitCode
      return
    }
  }

  const { spawn } = await import('child_process')
  const launch = await resolveServerLaunchSpec()
  const child = spawn(launch.programArgs[0], launch.programArgs.slice(1), {
    cwd: launch.workingDir,
    stdio: 'inherit',
    env: { ...process.env },
  })
  const exitCode = await new Promise<number>((resolvePromise) => {
    child.once('close', (code: number | null) => resolvePromise(code ?? 0))
    child.once('error', async (err: Error) => {
      const detail = err instanceof Error ? err.message : String(err)
      if (process.stdout.isTTY) {
        await printCommandFailureTui({
          command: `bakin ${command}`,
          message: 'Failed to start Bakin.',
          detail,
          code: 'START_FAILED',
        })
      } else {
        console.error('Failed to start Bakin:', detail)
      }
      resolvePromise(1)
    })
  })
  process.exitCode = exitCode
}

async function cmdSetupService(options: { uninstall?: boolean } = {}): Promise<void> {
  const { execFileSync } = await import('child_process')
  const { existsSync, mkdirSync, unlinkSync, writeFileSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { getBakinPaths } = await import('../../../packages/core/src/content-dir')
  const isTTY = process.stdout.isTTY

  const printServiceResult = async (
    result: Record<string, unknown>,
    detail?: string,
  ): Promise<void> => {
    const action = options.uninstall ? 'disable autostart' : 'enable autostart'
    const message = typeof result.message === 'string' ? result.message : 'Bakin service configuration updated.'
    await printRuntimeActionTui({
      action,
      target: 'Bakin service',
      result,
      message,
      detail,
    })
  }

  const launch = await resolveServerLaunchSpec()
  const environment = await serviceEnvironment()
  const paths = getBakinPaths()
  const stdoutPath = join(paths.logs, 'server.out.log')
  const stderrPath = join(paths.logs, 'server.err.log')
  mkdirSync(paths.logs, { recursive: true })

  if (process.platform === 'darwin') {
    const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
    const plistPath = join(launchAgentsDir, `${SERVICE_LABEL}.plist`)
    const uid = execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()
    const removePlist = (path: string) => {
      try { execFileSync('launchctl', ['bootout', `gui/${uid}`, path], { stdio: 'pipe' }) } catch { /* not loaded */ }
      if (existsSync(path)) unlinkSync(path)
    }

    if (options.uninstall) {
      if (!isTTY) console.log('[..] Removing Bakin LaunchAgent...')
      removePlist(plistPath)
      for (const label of LEGACY_SERVICE_LABELS) {
        removePlist(join(launchAgentsDir, `${label}.plist`))
      }
      if (isTTY) {
        await printServiceResult({
          ok: true,
          status: 'ok',
          message: 'Bakin autostart disabled.',
          service: SERVICE_LABEL,
          platform: 'darwin',
        }, `Service: ${SERVICE_LABEL}`)
      } else {
        console.log('[OK] Bakin autostart disabled')
      }
      return
    }

    mkdirSync(launchAgentsDir, { recursive: true })
    removePlist(plistPath)
    for (const label of LEGACY_SERVICE_LABELS) {
      removePlist(join(launchAgentsDir, `${label}.plist`))
    }
    writeFileSync(plistPath, generateLaunchAgentPlist({
      programArgs: launch.programArgs,
      environment,
      workingDir: launch.workingDir,
      stdoutPath,
      stderrPath,
    }), 'utf-8')
    execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' })
    execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
    const started = await waitForServerVersion()
    if (!started.ok) process.exitCode = 1
    if (isTTY) {
      await printServiceResult({
        ok: true,
        status: started.ok ? 'ok' : 'warn',
        message: started.ok ? 'Bakin autostart enabled.' : 'Bakin autostart enabled, but the service did not respond.',
        service: SERVICE_LABEL,
        platform: 'darwin',
      }, [
        `Service: ${SERVICE_LABEL}`,
        started.ok ? `Version: ${started.version}` : 'Status: not responding after startup',
        `Logs: ${stdoutPath}`,
        `Errors: ${stderrPath}`,
        'Disable: bakin setup service --uninstall',
      ].join('\n'))
    } else {
      console.log(started.ok ? '[OK] Bakin autostart enabled' : '[WARN] Bakin autostart enabled, but the service did not respond')
      console.log(`  Service: ${SERVICE_LABEL}`)
      if (started.ok) console.log(`  Version: ${started.version}`)
      console.log(`  Logs:    ${stdoutPath}`)
      console.log(`  Errors:  ${stderrPath}`)
      console.log('  Disable: bakin setup service --uninstall')
    }
    return
  }

  if (process.platform === 'linux') {
    const systemdDir = join(homedir(), '.config', 'systemd', 'user')
    const unitPath = join(systemdDir, `${SERVICE_LABEL}.service`)
    if (options.uninstall) {
      if (!isTTY) console.log('[..] Removing Bakin user service...')
      try { execFileSync('systemctl', ['--user', 'disable', '--now', `${SERVICE_LABEL}.service`], { stdio: 'pipe' }) } catch { /* not enabled */ }
      if (existsSync(unitPath)) unlinkSync(unitPath)
      try { execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' }) } catch { /* systemd unavailable */ }
      if (isTTY) {
        await printServiceResult({
          ok: true,
          status: 'ok',
          message: 'Bakin autostart disabled.',
          service: `${SERVICE_LABEL}.service`,
          platform: 'linux',
        }, `Service: ${SERVICE_LABEL}.service`)
      } else {
        console.log('[OK] Bakin autostart disabled')
      }
      return
    }

    mkdirSync(systemdDir, { recursive: true })
    writeFileSync(unitPath, generateSystemdUnit({
      programArgs: launch.programArgs,
      environment,
      workingDir: launch.workingDir,
      stdoutPath,
      stderrPath,
    }), 'utf-8')
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' })
    execFileSync('systemctl', ['--user', 'enable', '--now', `${SERVICE_LABEL}.service`], { stdio: 'pipe' })
    const started = await waitForServerVersion()
    if (!started.ok) process.exitCode = 1
    if (isTTY) {
      await printServiceResult({
        ok: true,
        status: started.ok ? 'ok' : 'warn',
        message: started.ok ? 'Bakin autostart enabled.' : 'Bakin autostart enabled, but the service did not respond.',
        service: `${SERVICE_LABEL}.service`,
        platform: 'linux',
      }, [
        `Service: ${SERVICE_LABEL}.service`,
        started.ok ? `Version: ${started.version}` : 'Status: not responding after startup',
        `Logs: ${stdoutPath}`,
        `Errors: ${stderrPath}`,
        'Disable: bakin setup service --uninstall',
      ].join('\n'))
    } else {
      console.log(started.ok ? '[OK] Bakin autostart enabled' : '[WARN] Bakin autostart enabled, but the service did not respond')
      console.log(`  Service: ${SERVICE_LABEL}.service`)
      if (started.ok) console.log(`  Version: ${started.version}`)
      console.log(`  Logs:    ${stdoutPath}`)
      console.log(`  Errors:  ${stderrPath}`)
      console.log('  Disable: bakin setup service --uninstall')
    }
    return
  }

  const error = `Service management is not supported on ${process.platform}.`
  if (isTTY) {
    await printServiceResult({ ok: false, status: 'fail', error })
  } else {
    console.error(error)
  }
  process.exit(1)
}

async function cmdReboot(args: string[] = []): Promise<void> {
  const { restartHome } = await import('../lifecycle-control')
  const { realLifecycleIo } = await import('../lifecycle-io')
  if (!process.stdout.isTTY) console.log('[..] Restarting this home\'s Bakin server...')
  const io = await realLifecycleIo(resolveServerLaunchSpec)
  const outcome = await restartHome(io, { force: args.includes('--force'), baseEnv: await serviceEnvironment() })
  await printLifecycleOutcome('restart', outcome, outcome.boot ? [`pid ${outcome.boot.pid}`, ...(outcome.boot.version ? [`version ${outcome.boot.version}`] : [])] : [])
}

/**
 * One outcome printer for stop/restart (#898 K): every note reaches BOTH
 * output modes, and a failure always exits non-zero.
 */
async function printLifecycleOutcome(action: 'stop' | 'restart', outcome: import('../lifecycle-control').LifecycleOutcome, facts: string[] = []): Promise<void> {
  if (!outcome.ok) process.exitCode = 1
  const detail = [...facts, ...outcome.notes].join('\n') || undefined
  if (process.stdout.isTTY) {
    await printRuntimeActionTui({ action, target: 'Bakin server', result: { ok: outcome.ok, status: outcome.status, message: outcome.message }, message: outcome.message, detail })
    return
  }
  const tag = outcome.status === 'ok' ? '[OK]' : outcome.status === 'warn' ? '[WARN]' : '[ERROR]'
  console.log(`${tag} ${outcome.message}`)
  for (const line of [...facts, ...outcome.notes]) console.log(`  ${line}`)
}

interface LogsOptions {
  filter?: string
  json?: boolean
  lines?: number
  follow?: boolean
}

function parseLogsArgs(args: string[]): LogsOptions | { error: string } {
  const options: LogsOptions = { lines: 20, follow: true }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--no-follow') {
      options.follow = false
      continue
    }
    if (arg === '--follow') {
      options.follow = true
      continue
    }
    if (arg.startsWith('--lines=')) {
      const value = Number(arg.split('=')[1])
      if (!Number.isInteger(value) || value < 0) return { error: '--lines must be a non-negative integer' }
      options.lines = value
      continue
    }
    if (arg === '--lines') {
      const value = Number(args[i + 1])
      if (!Number.isInteger(value) || value < 0) return { error: '--lines must be a non-negative integer' }
      options.lines = value
      i++
      continue
    }
    if (arg.startsWith('--')) return { error: `Unknown logs argument: ${arg}` }
    if (options.filter) return { error: `Unexpected logs argument: ${arg}` }
    options.filter = arg
  }
  return options
}

function parseAuditLogLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null
  try {
    const parsed = JSON.parse(line) as unknown
    return jsonObject(parsed)
  } catch {
    return null
  }
}

function auditLogMatches(entry: Record<string, unknown>, filter?: string): boolean {
  if (!filter) return true
  if (filter === 'mcp' || filter === 'rest') return entry.channel === filter
  return entry.agent === filter || entry.channel === filter
}

function summarizeAuditData(data: unknown): string {
  const record = jsonObject(data)
  if (!record) return ''
  return Object.entries(record)
    .slice(0, 4)
    .map(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return `${key}=${value}`
      if (Array.isArray(value)) return `${key}=[${value.length}]`
      if (value && typeof value === 'object') return `${key}={...}`
      return `${key}=null`
    })
    .join(' ')
}

function formatAuditLogRow(entry: Record<string, unknown>): string {
  const ts = typeof entry.ts === 'string' ? entry.ts : ''
  const time = ts.includes('T') ? ts.split('T')[1]?.replace('Z', '').slice(0, 12) ?? ts : ts || '-'
  const event = String(entry.event ?? '-')
  const agent = String(entry.agent ?? '-')
  const channel = entry.channel == null ? '-' : String(entry.channel)
  const summary = summarizeAuditData(entry.data)
  return [
    time.padEnd(14),
    event.padEnd(28),
    agent.padEnd(14),
    channel.padEnd(10),
    summary,
  ].join(' ').trimEnd()
}

async function printLogsHeaderTui(options: {
  auditPath: string
  filter?: string
  lines: number
  follow: boolean
}): Promise<void> {
  const [{ ScreenHeader, SummaryStrip, Section, FindingRows }, { renderToString }, { createElement, Fragment }] = await Promise.all([
    import('../../core/cli/ui/tui'),
    import('../../core/cli/ui/render-to-string'),
    import('react'),
  ])
  console.log(renderToString(createElement(Fragment, {}, [
    createElement(ScreenHeader, {
      key: 'header',
      title: 'Logs',
      subtitle: 'Audit event stream',
      meta: `filter: ${options.filter ?? 'all'}`,
    }),
    createElement(SummaryStrip, {
      key: 'summary',
      items: [
        { label: 'recent', value: options.lines, status: 'ok' },
        { label: 'mode', value: options.follow ? 'follow' : 'snapshot', status: options.follow ? 'ready' : 'skip' },
      ],
    }),
    createElement(Section, {
      key: 'source',
      title: 'Source',
      children: createElement(FindingRows, {
        rows: [{
          status: 'ok',
          label: 'audit',
          message: options.auditPath,
          detail: options.follow ? 'Streaming new events. Press Ctrl-C to stop.' : 'Snapshot mode.',
        }],
      }),
    }),
  ])))
}

function printAuditEntry(entry: Record<string, unknown>, options: { json?: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(entry))
    return
  }
  console.log(formatAuditLogRow(entry))
}

async function cmdLogs(options: LogsOptions = {}): Promise<void> {
  const { spawn } = await import('child_process')
  const { existsSync, readFileSync } = await import('fs')
  const { getBakinPaths } = await import('../../../packages/core/src/content-dir')
  const auditPath = getBakinPaths().audit
  const lines = options.lines ?? 20
  const follow = options.follow !== false
  const jsonOutput = options.json === true || !process.stdout.isTTY

  if (!existsSync(auditPath)) {
    await exitCommandFailure(`Audit log not found: ${auditPath}`, {
      command: options.filter ? `bakin logs ${options.filter}` : 'bakin logs',
      code: 'AUDIT_LOG_NOT_FOUND',
      next: 'Run `bakin mkdir` to initialize Bakin home.',
      plainLines: [
        `Audit log not found: ${auditPath}`,
        'Is Bakin initialized? Run: bakin mkdir',
      ],
    })
  }

  const emitLine = (line: string) => {
    const entry = parseAuditLogLine(line)
    if (!entry || !auditLogMatches(entry, options.filter)) return
    printAuditEntry(entry, { json: jsonOutput })
  }

  if (!jsonOutput && process.stdout.isTTY) {
    await printLogsHeaderTui({ auditPath, filter: options.filter, lines, follow })
    console.log('RECENT EVENTS')
    console.log('------------')
    console.log(['TIME'.padEnd(14), 'EVENT'.padEnd(28), 'AGENT'.padEnd(14), 'CHANNEL'.padEnd(10), 'SUMMARY'].join(' '))
  }

  const history = lines > 0 ? readFileSync(auditPath, 'utf-8').trimEnd().split('\n').slice(-lines) : []
  for (const line of history) emitLine(line)

  if (!follow) return

  if (!jsonOutput && process.stdout.isTTY) {
    console.log('')
    console.log('LIVE TAIL')
    console.log('---------')
  }

  const child = spawn('tail', ['-f', '-n', '0', auditPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  let buffer = ''
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8')
    const parts = buffer.split(/\r?\n/)
    buffer = parts.pop() ?? ''
    for (const line of parts) emitLine(line)
  })

  // Clean up on exit
  process.on('SIGINT', () => {
    child.kill()
    process.exit(0)
  })

  await new Promise(() => {}) // block until killed
}

async function cmdStop(): Promise<void> {
  const { stopHome } = await import('../lifecycle-control')
  const { realLifecycleIo } = await import('../lifecycle-io')
  if (!process.stdout.isTTY) console.log('[..] Stopping this home\'s Bakin server...')
  const outcome = await stopHome(await realLifecycleIo(resolveServerLaunchSpec))
  // `bakin stop` is one of the EXPLICIT antfly kill paths (the keep-alive
  // lifecycle leaves the child running across routine restarts). Antfly dies
  // ONLY once Bakin is conclusively down here — never on a refusal or a
  // timeout, where a live server's supervision would just resurrect it.
  const facts: string[] = []
  if (outcome.ok && !outcome.notes.some((n) => n.startsWith('A start may be pending'))) {
    const antflyPid = await stopAntflyInstance()
    if (antflyPid) facts.push(`Stopped the Antfly instance (pid ${antflyPid}).`)
  }
  await printLifecycleOutcome('stop', outcome, facts)
}

/** Kill this home's Antfly via its instance sidecar, best-effort (a missing/stale sidecar is fine). */
async function stopAntflyInstance(): Promise<number | null> {
  const { getBakinPaths } = await import('../../../packages/core/src/content-dir')
  const { join } = await import('path')
  const { readFileSync, existsSync, unlinkSync } = await import('fs')
  const sidecarPath = join(getBakinPaths().antfly, 'instance.json')
  if (!existsSync(sidecarPath)) return null
  let pid: number | null = null
  try {
    pid = (JSON.parse(readFileSync(sidecarPath, 'utf-8')) as { pid?: number | null }).pid ?? null
  } catch (err) {
    console.error(`Could not read the Antfly instance sidecar: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
  if (pid) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch (err) {
      if ((err as { code?: string }).code !== 'ESRCH') throw err // already gone is fine
    }
  }
  try {
    unlinkSync(sidecarPath)
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err
  }
  return pid
}

export async function run(args: string[]): Promise<void> {
  const cmd = args[0]
  const sub = args[1]
  switch (cmd) {
    case 'stop':
      await cmdStop()
      break

    case 'logs': {
      const logsOptions = parseLogsArgs(args.slice(1))
      if ('error' in logsOptions) {
        await exitCommandIssue(logsOptions.error, {
          command: 'bakin logs',
          usage: 'bakin logs [filter] [--json] [--lines <n>] [--no-follow]',
        })
      } else {
        await cmdLogs(logsOptions)
      }
      break
    }

    case 'setup':
      if (sub === 'service') {
        const uninstall = args.includes('--uninstall')
        await cmdSetupService({ uninstall })
      } else {
        await exitUnknownSubcommand('setup', sub, ['service'])
      }
      break

    case 'start':
      await cmdStartServer('start', args.slice(1))
      break

    case 'serve':
      await cmdStartServer('serve', args.slice(1))
      break

    default:
      // 'reboot' | 'restart'
      await cmdReboot(args.slice(1))
      break
  }
}
