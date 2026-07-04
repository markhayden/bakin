/**
 * `bakin {start,serve,stop,reboot,restart,logs,setup}` — server process
 * lifecycle: foreground start/serve, stop (incl. the explicit Antfly kill
 * path), reboot/restart, audit-log tailing, and LaunchAgent/systemd service
 * setup. Relocated verbatim from cli/bakin.ts (B5.3 command-module split);
 * the src/core/cli dependency stays a dynamic import (mutual-lazy contract).
 */
import { BASE_URL, jsonObject } from '../http'
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

function serviceEnvironment(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
  }
  for (const key of ['BAKIN_HOME', 'PORT'] as const) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

async function waitForServerVersion(timeoutSeconds = 15): Promise<{ ok: true; version: string } | { ok: false }> {
  for (let i = 0; i < timeoutSeconds; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const res = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(2000) })
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

function serverProcessPattern(): string {
  return 'tsx.*server\\.ts|bun.*server\\.ts.*serve|bakin.*serve'
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
  const environment = serviceEnvironment()
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

async function cmdReboot(): Promise<void> {
  const { execFileSync, spawn } = await import('child_process')
  const { existsSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { getBakinPaths } = await import('../../../packages/core/src/content-dir')
  const isTTY = process.stdout.isTTY
  const details: string[] = []
  const paths = getBakinPaths()
  const logPath = join(paths.logs, 'server.log')

  const printRestartResult = async (result: Record<string, unknown>): Promise<void> => {
    const message = typeof result.message === 'string' ? result.message : 'Bakin restart request completed.'
    if (isTTY) {
      await printRuntimeActionTui({
        action: 'restart',
        target: 'Bakin server',
        result,
        message,
        detail: details.join('\n'),
      })
      return
    }
    if (result.status === 'warn') console.log(`[WARN] ${message}`)
    else console.log(message)
  }

  if (process.platform === 'darwin') {
    const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
    if (existsSync(plistPath)) {
      const uid = execFileSync('id', ['-u'], { encoding: 'utf-8' }).trim()
      if (!isTTY) console.log('[..] Restarting Bakin LaunchAgent...')
      try {
        execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
      } catch {
        details.push('LaunchAgent was not loaded; bootstrapped it before restart.')
        execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' })
        execFileSync('launchctl', ['kickstart', '-k', `gui/${uid}/${SERVICE_LABEL}`], { stdio: 'pipe' })
      }
      details.push(`Service: ${SERVICE_LABEL}`)
      details.push(`Logs: tail -f ${logPath}`)
      if (!isTTY) console.log('[OK] Bakin LaunchAgent restart requested')

      if (!isTTY) console.log('[..] Waiting for server to come up...')
      const started = await waitForServerVersion()
      if (started.ok) {
        if (!isTTY) {
          console.log(`[OK] Bakin is up (${started.version})`)
          return
        }
        details.push(`Version: ${started.version}`)
        await printRestartResult({
          ok: true,
          status: 'ok',
          message: 'Bakin restarted.',
          service: SERVICE_LABEL,
          version: started.version,
        })
        return
      }
      if (!isTTY) {
        console.log('[WARN] Server not responding after 15s - check logs')
        process.exitCode = 1
        return
      }
      process.exitCode = 1
      await printRestartResult({
        ok: true,
        status: 'warn',
        message: 'Server not responding after 15s - check logs.',
        service: SERVICE_LABEL,
      })
      return
    }
  }

  if (process.platform === 'linux') {
    const unitPath = join(homedir(), '.config', 'systemd', 'user', `${SERVICE_LABEL}.service`)
    if (existsSync(unitPath)) {
      if (!isTTY) console.log('[..] Restarting Bakin user service...')
      execFileSync('systemctl', ['--user', 'restart', `${SERVICE_LABEL}.service`], { stdio: 'pipe' })
      details.push(`Service: ${SERVICE_LABEL}.service`)
      details.push(`Logs: tail -f ${logPath}`)
      if (!isTTY) console.log('[OK] Bakin user service restart requested')

      if (!isTTY) console.log('[..] Waiting for server to come up...')
      const started = await waitForServerVersion()
      if (started.ok) {
        if (!isTTY) {
          console.log(`[OK] Bakin is up (${started.version})`)
          return
        }
        details.push(`Version: ${started.version}`)
        await printRestartResult({
          ok: true,
          status: 'ok',
          message: 'Bakin restarted.',
          service: `${SERVICE_LABEL}.service`,
          version: started.version,
        })
        return
      }
      if (!isTTY) {
        console.log('[WARN] Server not responding after 15s - check logs')
        process.exitCode = 1
        return
      }
      process.exitCode = 1
      await printRestartResult({
        ok: true,
        status: 'warn',
        message: 'Server not responding after 15s - check logs.',
        service: `${SERVICE_LABEL}.service`,
      })
      return
    }
  }

  // Kill any running Bakin server processes
  if (!isTTY) console.log('[..] Stopping Bakin server...')
  try {
    const pids = execFileSync('pgrep', ['-f', serverProcessPattern()], { encoding: 'utf-8' }).trim()
    if (pids) {
      let signaled = 0
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
          signaled++
        }
      }
      details.push(`Sent SIGTERM to ${signaled} process(es).`)
      if (!isTTY) console.log('[OK] Sent SIGTERM to Bakin server')
      if (!isTTY) console.log('[..] Waiting for shutdown...')
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch {
    details.push('No running Bakin process found before restart.')
    if (!isTTY) console.log('[..] No running Bakin process found')
  }

  // Start the server in background
  if (!isTTY) console.log('[..] Starting Bakin server...')
  const launch = await resolveServerLaunchSpec()
  const child = spawn(launch.programArgs[0], launch.programArgs.slice(1), {
    cwd: launch.workingDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  })
  child.unref()
  if (child.pid) details.push(`Started process ${child.pid}.`)
  details.push(`Logs: tail -f ${logPath}`)
  if (!isTTY) console.log(`[OK] Bakin starting (pid ${child.pid})`)
  if (!isTTY) console.log(`  Logs: tail -f ${logPath}`)

  // Wait and verify
  if (!isTTY) console.log('[..] Waiting for server to come up...')
  const started = await waitForServerVersion()
  if (started.ok) {
    if (!isTTY) {
      console.log(`[OK] Bakin is up (${started.version})`)
      return
    }
    details.push(`Version: ${started.version}`)
    await printRestartResult({
      ok: true,
      status: 'ok',
      message: 'Bakin restarted.',
      pid: child.pid,
      version: started.version,
    })
    return
  }
  if (!isTTY) {
    console.log('[WARN] Server not responding after 15s - check logs')
    process.exitCode = 1
    return
  }
  process.exitCode = 1
  await printRestartResult({
    ok: true,
    status: 'warn',
    message: 'Server not responding after 15s - check logs.',
    pid: child.pid,
  })
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
  const { execFileSync } = await import('child_process')

  const printStopResult = async (result: Record<string, unknown>, detail?: string): Promise<void> => {
    // Antfly dies ONLY after Bakin is down/absent: killing it while a Bakin
    // server still runs would trip that server's takeover supervision, which
    // exists precisely to resurrect a disappeared local instance.
    const antflyPid = await stopAntflyInstance()
    if (antflyPid && !process.stdout.isTTY) console.log(`[OK] Sent SIGTERM to Antfly instance (pid ${antflyPid})`)
    const message = typeof result.message === 'string' ? result.message : 'Bakin stop request completed.'
    if (process.stdout.isTTY) {
      await printRuntimeActionTui({
        action: 'stop',
        target: 'Bakin server',
        result,
        message,
        detail,
      })
      return
    }
    if (message === 'Bakin stopped.') console.log('[OK] Bakin stopped')
    else if (message === 'No running Bakin process found.') console.log('[OK] No running Bakin process found')
    else if (result.status === 'warn') console.log(`[WARN] ${message}`)
    else console.log(message)
    if (detail) console.log(`  ${detail}`)
  }

  // `bakin stop` is one of the EXPLICIT antfly kill paths (the keep-alive
  // lifecycle leaves the child running across routine Bakin restarts, so a
  // routine server SIGTERM never stops it). Kill via the instance sidecar,
  // best-effort — a missing/stale sidecar or dead pid is fine.
  const stopAntflyInstance = async (): Promise<number | null> => {
    try {
      const { getBakinPaths } = await import('../../../packages/core/src/content-dir')
      const { join } = await import('path')
      const { readFileSync, existsSync, unlinkSync } = await import('fs')
      const sidecarPath = join(getBakinPaths().antfly, 'instance.json')
      if (!existsSync(sidecarPath)) return null
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as { pid?: number | null }
      if (sidecar?.pid) {
        try {
          process.kill(sidecar.pid, 'SIGTERM')
        } catch { /* already gone */ }
      }
      try {
        unlinkSync(sidecarPath)
      } catch { /* best effort */ }
      return sidecar?.pid ?? null
    } catch {
      return null
    }
  }

  if (!process.stdout.isTTY) console.log('[..] Stopping Bakin server...')
  try {
    const pids = execFileSync('pgrep', ['-f', serverProcessPattern()], { encoding: 'utf-8' }).trim()
    if (pids) {
      const signaled: string[] = []
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
          signaled.push(pid)
        }
      }
      if (!process.stdout.isTTY) console.log('[OK] Sent SIGTERM to Bakin server')

      // Wait and verify it's actually down
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(1000) })
        } catch {
          await printStopResult({
            ok: true,
            status: 'ok',
            message: 'Bakin stopped.',
            signaled: signaled.length,
          }, signaled.length > 0 ? `Sent SIGTERM to ${signaled.length} process(es).` : undefined)
          return
        }
      }
      await printStopResult({
        ok: true,
        status: 'warn',
        message: 'Server may still be shutting down.',
        signaled: signaled.length,
      }, signaled.length > 0 ? `Sent SIGTERM to ${signaled.length} process(es).` : undefined)
    } else {
      await printStopResult({
        ok: true,
        status: 'ok',
        message: 'No running Bakin process found.',
        signaled: 0,
      })
    }
  } catch {
    await printStopResult({
      ok: true,
      status: 'ok',
      message: 'No running Bakin process found.',
      signaled: 0,
    })
  }
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
      await cmdReboot()
      break
  }
}
