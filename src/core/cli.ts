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
import { isOnboarded } from './onboarding/state'

const BAKIN_URL = process.env.BAKIN_URL || 'http://localhost:3737'

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

async function cmdUpdate(): Promise<number> {
  // Use a variable specifier so TypeScript doesn't require this optional
  // implementation at build time.
  try {
    const mod = await import(/* @vite-ignore */ './self-update' as string) as { selfUpdate: () => Promise<number> }
    return mod.selfUpdate()
  } catch (err) {
    console.error(`update is not available: ${err instanceof Error ? err.message : String(err)}`)
    return 1
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
    console.error('`bakin dev` only runs from a bakin source tree.')
    console.error('Clone https://github.com/markhayden/bakin and run `bakin dev` from the repo root.')
    return 1
  }

  const { spawn } = await import('node:child_process')
  const proc = spawn('bun', ['run', devScript, ...devArgs], { stdio: 'inherit', cwd: repoRoot })
  return await new Promise<number>((resolvePromise) => {
    proc.once('close', (code: number | null) => resolvePromise(code ?? 0))
    proc.once('error', (err) => {
      console.error('Failed to spawn dev:', err instanceof Error ? err.message : String(err))
      resolvePromise(1)
    })
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
  const args = argv.slice(2)
  // No-arg invocation is `start` — the compiled binary's primary job.
  const cmd = args[0] ?? 'start'

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
        // onboard, setup, logs, agent-rules, etc.).
        return await delegateToSourceCli(argv)
      }
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return { startServer: false, exitCode: 1 }
  }
}
