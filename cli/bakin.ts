#!/usr/bin/env bun
/**
 * Bakin CLI — command-line interface for Bakin orchestration platform.
 * All commands are thin wrappers around the Bakin HTTP API.
 */
import { APP_VERSION } from '../packages/core/src/constants'
import { BASE_URL, isServerConnectionError } from '../src/cli/http'
import { invocationCommand } from '../src/cli/output'
import {
  BINARY_ONLY_COMMANDS,
  usageWithPluginCommands,
  printHelpTui,
  printCommandFailureTui,
  printVersionTui,
} from '../src/cli/help'

export async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    if (process.stdout.isTTY) await printHelpTui()
    else console.log((await usageWithPluginCommands()).trim())
    process.exit(0)
  }

  const cmd = args[0]

  try {
    switch (cmd) {
      case 'version':
      case '--version':
      case '-v':
        if (process.stdout.isTTY) await printVersionTui({ version: APP_VERSION })
        else console.log(APP_VERSION)
        break

      case 'update':
        // Self-update is implemented only in the compiled binary (handled in
        // src/core/cli.ts before delegation reaches here). This source/npm entry
        // can't replace its own executable — guide the user instead of erroring.
        console.log(
          'Self-update is only available in the compiled `bakin` binary (run `bakin update`).\n' +
          'This source/npm invocation does not self-update — update via your install method:\n' +
          '  • Homebrew:        brew upgrade bakin\n' +
          '  • Source checkout: git pull',
        )
        break

      case 'status':
      case 'dispatch':
      case 'runtime':
        await (await import('../src/cli/commands/runtime')).run(args)
        break

      case 'tasks':
        await (await import('../src/cli/commands/tasks')).run(args)
        break

      case 'workflows':
        await (await import('../src/cli/commands/workflows')).run(args)
        break

      case 'agents':
        await (await import('../src/cli/commands/agents')).run(args)
        break

      case 'settings':
        await (await import('../src/cli/commands/settings')).run(args)
        break

      case 'diagnostics':
        await (await import('../src/cli/commands/diagnostics')).run(args)
        break

      case 'plugins':
        await (await import('../src/cli/commands/plugins')).run(args)
        break

      case 'packages':
        await (await import('../src/cli/commands/packages')).run(args)
        break

      case 'skills':
        await (await import('../src/cli/commands/skills')).run(args)
        break

      case 'stop':
      case 'logs':
      case 'setup':
        await (await import('../src/cli/commands/lifecycle')).run(args)
        break

      case 'paths':
      case 'mkdir':
      case 'check':
      case 'install':
      case 'onboard':
        await (await import('../src/cli/commands/onboarding')).run(args)
        break

      case 'doctor':
        await (await import('../src/cli/commands/doctor')).run(args)
        break

      case 'dev': {
        // Delegate to the unified cmdDev in src/core/cli.ts so the source-
        // tree detection + spawn logic lives in one place (and the
        // compiled binary's `bakin dev` uses the same code path).
        const { cmdDev } = await import('../src/core/cli')
        process.exit(await cmdDev(args.slice(1)))
        break  // unreachable, but eslint's no-fallthrough doesn't know that
      }

      case 'start':
      case 'serve':
      case 'reboot':
      case 'restart':
        await (await import('../src/cli/commands/lifecycle')).run(args)
        break

      case 'assets':
        await (await import('../src/cli/commands/assets')).run(args)
        break
      case 'brands':
        await (await import('../src/cli/commands/brands')).run(args)
        break

      case 'reindex':
        await (await import('../src/cli/commands/search')).run(args)
        break

      case 'docs':
        await (await import('../src/cli/commands/docs')).run(args)
        break

      case 'search':
      case 'search:stats':
      case 'search:reset':
        await (await import('../src/cli/commands/search')).run(args)
        break

      case 'trash':
        await (await import('../src/cli/commands/trash')).run(args)
        break

      case 'schedule':
        await (await import('../src/cli/commands/schedule')).run(args)
        break

      case 'spend':
      case 'budget':
        await (await import('../src/cli/commands/budget')).run(args)
        break

      default: {
        let pluginLookupError: string | undefined
        if (!BINARY_ONLY_COMMANDS.has(cmd)) {
          try {
            const { dispatchPluginCliCommand } = await import('../src/cli/commands/plugin-dispatch')
            if (await dispatchPluginCliCommand(cmd, args.slice(1))) {
              break
            }
          } catch (err) {
            if (!isServerConnectionError(err)) throw err
            pluginLookupError = `Plugin command lookup skipped because Bakin is not reachable at ${BASE_URL}.`
          }
        }
        if (process.stdout.isTTY) {
          await printHelpTui(`Unknown command: ${cmd}`, pluginLookupError)
        } else {
          console.error(`Unknown command: ${cmd}`)
          if (pluginLookupError) console.error(pluginLookupError)
          console.log((await usageWithPluginCommands()).trim())
        }
        process.exit(1)
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'BakinDelegatedCliExit') {
      throw err
    }
    if (err instanceof Error && /^exit:\d+$/.test(err.message)) {
      throw err
    }
    if (
      isServerConnectionError(err)
    ) {
      if (process.stdout.isTTY) {
        await printCommandFailureTui({
          command: invocationCommand(args),
          message: 'Cannot connect to Bakin. Is the server running?',
          detail: `Tried: ${BASE_URL}`,
          code: 'SERVER_UNREACHABLE',
          next: 'Run `bakin start` to launch the server.',
        })
      } else {
        console.error('Error: Cannot connect to Bakin. Is the server running?')
        console.error(`  Tried: ${BASE_URL}`)
        console.error(`  Run \`bakin start\` to launch the server.`)
      }
    } else {
      const message = err instanceof Error ? err.message : String(err)
      if (process.stdout.isTTY) {
        await printCommandFailureTui({
          command: invocationCommand(args),
          message,
          code: 'COMMAND_FAILED',
        })
      } else {
        console.error('Error:', message)
      }
    }
    process.exit(1)
  }
}

// Only auto-invoke when this file is the entry point (npm-linked
// `/opt/homebrew/bin/bakin` shell invocation). When imported from the
// compiled binary's src/core/cli.ts to delegate unknown commands,
// import.meta.main is false and the binary's dispatcher drives us.
if (import.meta.main) {
  main()
}
