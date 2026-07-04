/**
 * Shared help / usage / exit plumbing for the Bakin CLI — the help + version
 * report printers, the TUI-aware exit helpers (exitCommandIssue / exitUsage /
 * exitUnknownSubcommand / exitCommandFailure), the shared y/N confirm core, and
 * the BINARY_ONLY_COMMANDS + USAGE constants, relocated verbatim from
 * cli/bakin.ts so every extracted command module (and the router itself)
 * shares one copy.
 *
 * Import discipline: this module may import only src/cli/http, src/cli/output,
 * src/core/cli/registry, and the lazy render-report helper — never a command
 * module (command modules import us, and a back-edge would be a cycle) and
 * never anything that statically pulls react/ink/server-core into the binary
 * entry's import graph.
 */
import { BASE_URL } from './http'
import { print, normalizeUsage, usageLine } from './output'
import { getCliUsageGroups, renderCliUsage } from '../core/cli/registry'
import { renderInkReport } from '../core/cli/ui/render-report'
import type {
  CommandFailureData,
  CommandIssueData,
  HelpGroupData,
  VersionData,
} from '../core/cli/ui/readonly'

export const BINARY_ONLY_COMMANDS = new Set<string>()
export const USAGE = renderCliUsage({ bakinUrl: BASE_URL }, { excludeNames: BINARY_ONLY_COMMANDS })

export async function printGenericCommandResultTui(command: string, data: unknown): Promise<void> {
  const [{ renderCliResult }, { okResult }] = await Promise.all([
    import('../core/cli/render'),
    import('../core/cli/result'),
  ])
  console.log(renderCliResult(okResult(command, data), { mode: 'ink' }).trimEnd())
}

export async function printPluginCliCommandResult(command: string, args: string[], data: unknown): Promise<void> {
  if (process.stdout.isTTY && !args.includes('--json')) await printGenericCommandResultTui(command, data)
  else print(data)
}

export async function printHelpReportTui(groups: HelpGroupData[], error?: string, errorDetail?: string): Promise<void> {
  return renderInkReport(() => import('../core/cli/ui/readonly'), (m) => m.HelpReport, {
    groups,
    env: { bakinUrl: BASE_URL },
    error,
    errorDetail,
  })
}

export async function printHelpTui(error?: string, errorDetail?: string): Promise<void> {
  await printHelpReportTui(getCliUsageGroups({ excludeNames: BINARY_ONLY_COMMANDS }), error, errorDetail)
}

export async function printCommandIssueTui(issue: CommandIssueData): Promise<void> {
  return renderInkReport(() => import('../core/cli/ui/readonly'), (m) => m.CommandIssueReport, { issue })
}

export async function printCommandFailureTui(failure: CommandFailureData): Promise<void> {
  return renderInkReport(() => import('../core/cli/ui/readonly'), (m) => m.CommandFailureReport, { failure })
}

export async function printVersionTui(data: VersionData): Promise<void> {
  return renderInkReport(() => import('../core/cli/ui/readonly'), (m) => m.VersionReport, { data })
}

export async function exitCommandIssue(
  message: string,
  options: {
    command?: string
    detail?: string
    usage?: string
    available?: string[]
    availableLabel?: string
    plainMessage?: boolean
  } = {},
): Promise<never> {
  if (process.stdout.isTTY) {
    await printCommandIssueTui({
      command: options.command ?? (options.usage ? normalizeUsage(options.usage) : 'command'),
      message,
      detail: options.detail,
      usage: options.usage ? normalizeUsage(options.usage) : undefined,
      available: options.available,
      availableLabel: options.availableLabel,
    })
  } else {
    if (options.plainMessage !== false) console.error(message)
    if (options.usage) console.error(usageLine(options.usage))
    if (options.available?.length) console.error(`Available: ${options.available.join(' | ')}`)
  }
  process.exit(1)
  throw new Error('unreachable')
}

export async function exitUsage(usage: string, detail?: string): Promise<never> {
  return exitCommandIssue('Missing required arguments.', {
    command: normalizeUsage(usage),
    detail,
    usage,
    plainMessage: false,
  })
}

export async function exitUnknownSubcommand(scope: string, sub: string | undefined, available: string[]): Promise<never> {
  return exitCommandIssue(`Unknown ${scope} subcommand: ${sub ?? '(none)'}`, {
    command: `bakin ${scope}`,
    available,
  })
}

export async function exitCommandFailure(
  message: string,
  options: {
    command?: string
    detail?: string
    code?: string
    next?: string
    plainLines?: string[]
  } = {},
): Promise<never> {
  if (process.stdout.isTTY) {
    await printCommandFailureTui({
      command: options.command ?? 'bakin',
      message,
      detail: options.detail,
      code: options.code ?? 'COMMAND_FAILED',
      next: options.next,
    })
  } else if (options.plainLines) {
    for (const line of options.plainLines) console.error(line)
  } else {
    console.error(`Error: ${message}`)
    if (options.detail) console.error(`  ${options.detail}`)
    if (options.next) console.error(`  ${options.next}`)
  }
  process.exit(1)
  throw new Error('unreachable')
}

// Shared readline y/N core. Callers own their own pre-guards (isTTY / count
// checks) so each keeps its exact behavior; only the readline boilerplate is shared.
export async function promptYesNo(message: string): Promise<boolean> {
  const readline = await import('node:readline/promises')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await rl.question(`\n${message} [y/N] `)
    return /^(y|yes)$/i.test(answer.trim())
  } finally {
    rl.close()
  }
}

export async function confirmPrompt(message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  return promptYesNo(message)
}
