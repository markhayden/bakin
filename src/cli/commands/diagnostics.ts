/**
 * `bakin diagnostics startup {status,on,off}` — startup-diagnostics settings
 * toggles. Relocated verbatim from cli/bakin.ts (B5.3 command-module split);
 * this module owns the src/core/settings static import so the CLI entry's
 * import graph stays free of server-core settings code.
 */
import { print } from '../output'
import { exitCommandIssue, exitUnknownSubcommand } from '../help'
import { getSettings, updateSettings } from '../../core/settings'

interface DiagnosticsStartupOptions {
  json?: boolean
  slowMs?: number
}

function parseSlowMsFlag(args: string[]): { slowMs?: number; error?: string } {
  let slowMs: number | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--slow-ms') {
      const raw = args[i + 1]
      if (!raw) return { error: '--slow-ms requires a value' }
      i += 1
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) return { error: '--slow-ms must be a non-negative number' }
      slowMs = Math.round(parsed)
    } else if (arg.startsWith('--slow-ms=')) {
      const raw = arg.slice('--slow-ms='.length)
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || parsed < 0) return { error: '--slow-ms must be a non-negative number' }
      slowMs = Math.round(parsed)
    }
  }
  return { slowMs }
}

function parseDiagnosticsStartupOptions(args: string[]): DiagnosticsStartupOptions & { error?: string } {
  const parsed = parseSlowMsFlag(args)
  if (parsed.error) return { error: parsed.error }
  return {
    json: args.includes('--json'),
    slowMs: parsed.slowMs,
  }
}

function withSilentLocalSettings<T>(fn: () => T): T {
  const previousConsoleFormat = process.env.BAKIN_CONSOLE_FORMAT
  process.env.BAKIN_CONSOLE_FORMAT = 'silent'
  try {
    return fn()
  } finally {
    if (previousConsoleFormat === undefined) delete process.env.BAKIN_CONSOLE_FORMAT
    else process.env.BAKIN_CONSOLE_FORMAT = previousConsoleFormat
  }
}

function readStartupDiagnosticsSettings() {
  return withSilentLocalSettings(() => getSettings().diagnostics.startup)
}

function writeStartupDiagnosticsSettings(enabled: boolean, slowMs?: number) {
  return withSilentLocalSettings(() => updateSettings({
    diagnostics: {
      startup: {
        enabled,
        ...(slowMs !== undefined ? { slowMs } : {}),
      },
    },
  }).diagnostics.startup)
}

function printStartupDiagnosticsStatus(
  action: 'status' | 'enabled' | 'disabled',
  startup: { enabled: boolean; slowMs: number },
  opts: { json?: boolean } = {},
): void {
  const payload = {
    startup,
    restartRequired: true,
    envOverrides: {
      enabled: 'BAKIN_STARTUP_DIAGNOSTICS=1|0',
      slowMs: 'BAKIN_STARTUP_SLOW_MS=<milliseconds>',
      verbose: 'BAKIN_CONSOLE_FORMAT=verbose or BAKIN_LOG_LEVEL=debug',
    },
  }
  if (opts.json) {
    print(payload)
    return
  }

  const label = startup.enabled ? 'enabled' : 'disabled'
  if (action === 'status') {
    console.log(`Startup diagnostics: ${label}`)
  } else {
    console.log(`Startup diagnostics ${action}.`)
  }
  console.log(`Slow-span threshold: ${startup.slowMs}ms`)
  console.log('Applies on next server start. Use `bakin restart` after changing it.')
}

async function cmdDiagnosticsStartup(action: string | undefined, args: string[]): Promise<void> {
  const opts = parseDiagnosticsStartupOptions(args)
  if (opts.error) await exitCommandIssue(opts.error, {
    command: 'bakin diagnostics startup',
    usage: 'bakin diagnostics startup <status|on|off> [--slow-ms <ms>] [--json]',
  })

  if (!action || action === 'status') {
    if (opts.slowMs !== undefined) await exitCommandIssue('--slow-ms can only be used with `on` or `off`.', {
      command: 'bakin diagnostics startup status',
    })
    printStartupDiagnosticsStatus('status', readStartupDiagnosticsSettings(), opts)
    return
  }

  if (action === 'on' || action === 'enable' || action === 'enabled') {
    const startup = writeStartupDiagnosticsSettings(true, opts.slowMs)
    printStartupDiagnosticsStatus('enabled', startup, opts)
    return
  }

  if (action === 'off' || action === 'disable' || action === 'disabled') {
    const startup = writeStartupDiagnosticsSettings(false, opts.slowMs)
    printStartupDiagnosticsStatus('disabled', startup, opts)
    return
  }

  await exitUnknownSubcommand('diagnostics startup', action, ['status', 'on', 'off'])
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'startup') {
    await cmdDiagnosticsStartup(args[2], args.slice(3))
  } else {
    await exitUnknownSubcommand('diagnostics', sub, ['startup'])
  }
}
