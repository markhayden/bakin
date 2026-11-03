/**
 * Binary-facing CLI dispatcher (#147 TG2).
 *
 * The compiled `bakin` binary embeds server.ts as its entry point.
 * server.ts parses argv via `dispatchCli` and either starts the server
 * (`start`, `serve`, or the default) or runs a one-shot subcommand and exits.
 *
 * Most one-shot subcommands delegate to `cli/bakin.ts` so the binary and
 * source entrypoint share command behavior and TUI rendering. Binary-only
 * commands such as `version` and `update` execute in-process here.
 *
 * Exit codes:
 *   0 — success
 *   1 — generic error (server unreachable, invalid input, etc.)
 *   2 — refusal (e.g. core-plugin removal)
 */
import { APP_VERSION } from '../../packages/core/src/constants'
import { getCliUsageGroups, renderCliUsage } from './cli/registry'
import type { CommandFailureData, RuntimeActionData } from './cli/ui/readonly'
import { isOnboarded } from './onboarding/state'
import { restartChildCommandName, waitForRestartParentExit } from './server-restart'

const BAKIN_URL = process.env.BAKIN_URL
const DEV_CHILD_SIGNAL_GRACE_MS = 8000

interface DevChildProcess {
  killed: boolean
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
  once(event: 'error', listener: (err: Error) => void): unknown
}

interface DevSignalProcess {
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  off(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown
}

export function waitForDevChild(
  proc: DevChildProcess,
  onError: (err: Error) => Promise<void> | void = () => {},
  signalProc: DevSignalProcess = process,
): Promise<number> {
  return new Promise<number>((resolvePromise) => {
    let resolved = false
    let sawError = false
    let signalCount = 0
    let forceTimer: ReturnType<typeof setTimeout> | null = null

    const cleanup = () => {
      signalProc.off('SIGINT', onSigint)
      signalProc.off('SIGTERM', onSigterm)
      if (forceTimer) clearTimeout(forceTimer)
      forceTimer = null
    }
    const resolveOnce = (code: number) => {
      if (resolved) return
      resolved = true
      cleanup()
      resolvePromise(code)
    }
    const forceChildExit = () => {
      if (!proc.killed) proc.kill('SIGKILL')
    }
    const onSignal = () => {
      signalCount++
      if (signalCount > 1) {
        forceChildExit()
        return
      }
      // The terminal delivers Ctrl-C to the whole foreground process group, so
      // the child dev loop has already received this first signal. The parent
      // handler exists to keep the wrapper alive until the child exits; sending
      // the first signal again would look like a second Ctrl-C to scripts/dev.ts.
      forceTimer = setTimeout(forceChildExit, DEV_CHILD_SIGNAL_GRACE_MS)
      forceTimer.unref?.()
    }
    const onSigint = () => onSignal()
    const onSigterm = () => onSignal()

    signalProc.on('SIGINT', onSigint)
    signalProc.on('SIGTERM', onSigterm)

    proc.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (typeof code === 'number') {
        resolveOnce(code)
        return
      }
      if (signal === 'SIGINT') {
        resolveOnce(130)
        return
      }
      if (signal === 'SIGTERM') {
        resolveOnce(143)
        return
      }
      // A spawn failure emits 'error' then 'close(null, null)'. Resolving 0
      // here would race ahead of the error handler's async failure report and
      // exit success — leave resolution to the error handler in that case.
      if (signal) {
        resolveOnce(1)
      } else if (!sawError) {
        resolveOnce(0)
      }
    })
    proc.once('error', (err) => {
      sawError = true
      Promise.resolve(onError(err)).finally(() => resolveOnce(1))
    })
  })
}

function invocationCommand(args: string[]): string {
  return args.length > 0 ? `bakin ${args.join(' ')}` : 'bakin'
}

async function printCommandFailure(
  failure: CommandFailureData,
  plainLines: string[] = [`Error: ${String(failure.message ?? 'Command failed')}`],
): Promise<void> {
  if (process.stdout.isTTY) {
    const [{ CommandFailureReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/readonly'),
      import('./cli/ui/render-to-string'),
      import('react'),
    ])
    console.log(renderToString(createElement(CommandFailureReport, { failure })))
    return
  }

  for (const line of plainLines) console.error(line)
}

async function printRuntimeAction(action: RuntimeActionData): Promise<void> {
  const [{ RuntimeActionReport }, { renderToString }, { createElement }] = await Promise.all([
    import('./cli/ui/readonly'),
    import('./cli/ui/render-to-string'),
    import('react'),
  ])
  console.log(renderToString(createElement(RuntimeActionReport, { action })))
}

async function cmdVersion(): Promise<number> {
  if (process.stdout.isTTY) {
    const [{ VersionReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/readonly'),
      import('./cli/ui/render-to-string'),
      import('react'),
    ])
    console.log(renderToString(createElement(VersionReport, { data: { version: APP_VERSION } })))
  } else {
    console.log(APP_VERSION)
  }
  return 0
}

function shouldSkipOnboardingCheck(args: string[]): boolean {
  return process.env.BAKIN_SKIP_ONBOARDING_CHECK === '1'
    || args.includes('--skip-onboarding-check')
}

async function printStartOnboardingGate(): Promise<void> {
  if (process.stdout.isTTY) {
    const [{ OnboardingRequiredReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/onboarding'),
      import('./cli/ui/render-to-string'),
      import('react'),
    ])
    console.log(renderToString(createElement(OnboardingRequiredReport)))
    return
  }

  console.error('Bakin has not been onboarded on this machine.')
  console.error('Run: bakin onboard')
  console.error('To inspect readiness without changing anything, run: bakin onboard --check')
}

async function checkOnboardedBeforeStart(args: string[]): Promise<number | null> {
  if (shouldSkipOnboardingCheck(args)) return null
  if (isOnboarded()) return null
  await printStartOnboardingGate()
  return 1
}

/**
 * `bakin update` (#1007 D7.11, R3′/R3″): with this home's server running, the
 * update goes THROUGH it — the apply service starts the self-update
 * operation, the CLI follows it and runs the explicit verification; it never
 * replaces the binary beside a live server. A server that holds the lock but
 * is not listening yet is waited for (bounded), never bypassed. With no
 * server at all, the same operation runs in-process under install-state,
 * re-checking liveness once the resource is held.
 */
async function cmdUpdate(): Promise<number> {
  const events: string[] = []
  const echo = (line: string): void => { events.push(line); if (!process.stdout.isTTY) console.log(line) }
  const fail = async (message: string, detail: string, code: string): Promise<number> => {
    await printCommandFailure({ command: 'bakin update', message, detail, code }, [`${message} ${detail}`.trim()])
    return 1
  }
  let mod: typeof import('./updates/self-update-cli')
  try {
    mod = await import(/* @vite-ignore */ './updates/self-update-cli' as string) as typeof mod
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return fail('update is not available.', detail, 'UPDATE_UNAVAILABLE')
  }
  try {
    const result = await mod.runUpdateCommand({ echo, stdout: process.stdout })
    switch (result.kind) {
      case 'current':
        await printRuntimeAction({ action: 'checked', target: 'Bakin binary', result: { ok: true, status: 'ok' }, message: result.message, detail: events.join('\n') })
        return 0
      case 'verified':
        await printRuntimeAction({ action: 'updated', target: 'Bakin binary', result: { ok: true, status: 'ok' }, message: result.message, detail: events.join('\n') })
        return 0
      case 'failed':
        return fail(result.message, [...events, result.detail ?? ''].filter(Boolean).join('\n'), result.code)
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return fail('Bakin update failed.', [...events, detail].join('\n'), 'UPDATE_FAILED')
  }
}

async function cmdHelp(): Promise<number> {
  if (process.stdout.isTTY) {
    const [{ HelpReport }, { renderToString }, { createElement }] = await Promise.all([
      import('./cli/ui/readonly'),
      import('./cli/ui/render-to-string'),
      import('react'),
    ])
    console.log(renderToString(createElement(HelpReport, {
      groups: getCliUsageGroups(),
      env: { bakinUrl: BAKIN_URL },
    })))
  } else {
    console.log(renderCliUsage({ bakinUrl: BAKIN_URL }))
  }
  return 0
}

/**
 * `bakin dev` — run the watch-mode dev loop against the bakin source tree.
 * Only makes sense from a source clone; the compiled binary has no
 * packages/host/src/ to watch, so it errors out with a clear pointer.
 * Exported so the legacy cli/bakin.ts entry point can delegate here.
 */
export async function cmdDev(devArgs: string[] = process.argv.slice(3)): Promise<number> {
  // Source mode: this file resolves from the on-disk repo layout so we can
  // locate the sibling scripts/dev.ts. In the compiled binary the module
  // lives under the `/$bunfs/` virtual filesystem, which doesn't contain
  // scripts/ — detection is "does a scripts/dev.ts sibling exist next to
  // my resolved location on a real fs?".
  const { fileURLToPath } = await import('node:url')
  const { existsSync } = await import('node:fs')
  const { join, dirname, resolve } = await import('node:path')

  let here: string
  try { here = fileURLToPath(import.meta.url) } catch { here = '' }
  // Walk up from src/core/cli.ts to the repo root and probe.
  const repoRoot = here ? resolve(dirname(here), '..', '..') : process.cwd()
  const devScript = join(repoRoot, 'scripts', 'dev.ts')
  if (!existsSync(devScript)) {
    await printCommandFailure({
      command: 'bakin dev',
      message: '`bakin dev` only runs from a bakin source tree.',
      detail: 'Clone https://github.com/markhayden/bakin and run `bakin dev` from the repo root.',
      code: 'SOURCE_TREE_REQUIRED',
    }, [
      '`bakin dev` only runs from a bakin source tree.',
      'Clone https://github.com/markhayden/bakin and run `bakin dev` from the repo root.',
    ])
    return 1
  }

  const { spawn } = await import('node:child_process')
  const proc = spawn('bun', ['run', devScript, ...devArgs], { stdio: 'inherit', cwd: repoRoot })
  return await waitForDevChild(proc, async (err) => {
    const detail = err instanceof Error ? err.message : String(err)
    await printCommandFailure({
      command: 'bakin dev',
      message: 'Failed to spawn dev.',
      detail,
      code: 'DEV_SPAWN_FAILED',
    }, [`Failed to spawn dev: ${detail}`])
  })
}


export interface CliResult {
  /** Whether to continue booting the server after dispatch returns. */
  startServer: boolean
  /** Exit code for one-shot commands. Ignored when startServer is true. */
  exitCode: number
}

class DelegatedCliExit extends Error {
  constructor(readonly code: number) {
    super(`delegated cli exit ${code}`)
    this.name = 'BakinDelegatedCliExit'
  }
}

async function delegateToSourceCli(argv: string[]): Promise<CliResult> {
  const previousArgv = process.argv
  const previousExit = process.exit
  process.argv = argv
  process.exit = ((code?: string | number | null | undefined) => {
    const numericCode = typeof code === 'number' ? code : Number(code ?? 0)
    throw new DelegatedCliExit(Number.isFinite(numericCode) ? numericCode : 1)
  }) as never

  try {
    const { main: runSourceCli } = await import(/* @vite-ignore */ '../../cli/bakin' as string) as { main: () => Promise<void> }
    await runSourceCli()
    return { startServer: false, exitCode: 0 }
  } catch (err) {
    if (err instanceof DelegatedCliExit) {
      return { startServer: false, exitCode: err.code }
    }
    throw err
  } finally {
    process.argv = previousArgv
    process.exit = previousExit
  }
}

/**
 * Parse argv and dispatch. Returns `{ startServer: true }` only when the
 * user asked for `start` (explicit or default). Otherwise the command
 * executed inline and the caller should `process.exit(exitCode)`.
 */
export async function dispatchCli(argv: string[]): Promise<CliResult> {
  const restartCommandIndex = argv.indexOf(restartChildCommandName())
  if (restartCommandIndex !== -1) {
    await waitForRestartParentExit(argv[restartCommandIndex + 1])
    return { startServer: true, exitCode: 0 }
  }

  const args = argv.slice(2)
  // No-arg invocation shows help — parity with the source CLI (cli/bakin.ts).
  // Starting the server is the explicit `bakin start`.
  const cmd = args[0] ?? 'help'

  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    return { startServer: false, exitCode: await cmdHelp() }
  }

  if (cmd === 'start') {
    const gateExitCode = await checkOnboardedBeforeStart(args)
    if (gateExitCode !== null) return { startServer: false, exitCode: gateExitCode }
    return { startServer: true, exitCode: 0 }
  }

  if (cmd === 'serve') {
    return { startServer: true, exitCode: 0 }
  }

  try {
    switch (cmd) {
      case 'version':
      case '--version':
      case '-v':
        return { startServer: false, exitCode: await cmdVersion() }

      case 'update':
        return { startServer: false, exitCode: await cmdUpdate() }

      case 'dev':
        return { startServer: false, exitCode: await cmdDev(args.slice(1)) }

      // Runtime/status commands delegate to the source CLI so the compiled
      // binary uses the same TUI/JSON implementation as the npm-linked entry.
      case 'status':
      case 'stop':
      case 'plugins':
        return await delegateToSourceCli(argv)

      default: {
        // Delegate to the legacy CLI (doctor, tasks, workflows, agents,
        // schedule, search, settings, trash, paths, reindex, restart,
        // onboard, setup, logs, etc.).
        return await delegateToSourceCli(argv)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await printCommandFailure({
      command: invocationCommand(args),
      message,
      code: 'COMMAND_FAILED',
    }, [`Error: ${message}`])
    return { startServer: false, exitCode: 1 }
  }
}
