/**
 * Plugin-contributed CLI commands — matches `bakin <cmd> ...` against the
 * cliCommands each installed plugin declares in its manifest and dispatches
 * to the exec tool or API route it names. Arguments are parsed strictly
 * against each command's declared `args` (src/cli/plugin-args.ts); API routes
 * resolve under the contributing plugin's id.
 */
import type { CliCommandContribution } from '../../../packages/sdk/src/types/manifest'
import { CLI_TARGET, api, apiGet, apiPost, cliIdentity } from '../http'
import { invocationCommand } from '../output'
import { exitCommandIssue, printPluginCliCommandResult } from '../help'
import { stripActorFlag } from '../identity'
import { matchCliCommand } from '../plugin-args'

interface PluginManifestRow {
  id: string
  contributes?: {
    cliCommands?: CliCommandContribution[]
  }
}

/**
 * Global flags the CLI consumes itself (`--as`, `--json`) never reach command
 * params; everything after `--` is the command's own text.
 */
function withoutGlobalFlags(args: string[]): { rest: string[]; invalid?: string } {
  const actor = stripActorFlag(args)
  const end = actor.rest.indexOf('--')
  const options = end === -1 ? actor.rest : actor.rest.slice(0, end)
  return { rest: [...options.filter((arg) => arg !== '--json'), ...(end === -1 ? [] : actor.rest.slice(end))], invalid: actor.invalid }
}

export async function dispatchPluginCliCommand(cmd: string, args: string[]): Promise<boolean> {
  const manifest = await apiGet('/api/plugins/manifest') as { plugins: PluginManifestRow[] }
  const global = withoutGlobalFlags(args)
  const words = [cmd, ...global.rest]
  for (const plugin of manifest.plugins) {
    for (const command of plugin.contributes?.cliCommands ?? []) {
      if (!command.dispatch) continue
      const match = matchCliCommand(command, words)
      if (!match) continue
      if (global.invalid) await exitCommandIssue(global.invalid, { usage: command.usage })
      if (!match.ok) await exitCommandIssue(match.error, { usage: command.usage })
      const params = match.ok ? match.params : {}
      const invocation = invocationCommand([cmd, ...args])

      if (command.dispatch.type === 'execTool') {
        const result = await apiPost(`/api/exec-tools/${encodeURIComponent(command.dispatch.name)}`, { params, agent: 'cli' })
        await printPluginCliCommandResult(invocation, args, result)
        return true
      }

      if (command.dispatch.launch) {
        const { LaunchError, runLaunch, spawnInherited } = await import('../launch')
        const { getBakinPaths } = await import('../../core/content-dir')
        try {
          const code = await runLaunch({ pluginId: plugin.id, path: command.dispatch.path, ...command.dispatch.launch }, params, {
            interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
            localServer: CLI_TARGET.source === 'lock',
            binDir: getBakinPaths().bin,
            cwd: process.cwd(),
            size: { cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 },
            env: process.env,
            warn: (message) => { console.error(message) },
            identity: cliIdentity,
            post: apiPost,
            spawn: spawnInherited,
          })
          process.exit(code)
        } catch (err) {
          if (!(err instanceof LaunchError)) throw err
          await exitCommandIssue(err.message, { usage: command.usage })
        }
        return true
      }

      const query = command.dispatch.method === 'GET' ? new URLSearchParams(Object.entries(params).flatMap(([key, value]) =>
        Array.isArray(value) ? value.map((item) => [key, String(item)]) : [[key, String(value)]])).toString() : ''
      const result = await api(`/api/plugins/${plugin.id}${command.dispatch.path}${query ? `?${query}` : ''}`, {
        method: command.dispatch.method,
        body: command.dispatch.method === 'GET' ? undefined : JSON.stringify(params),
      })
      await printPluginCliCommandResult(invocation, args, result)
      return true
    }
  }
  return false
}
