/**
 * Plugin-contributed CLI commands — matches `bakin <cmd> ...` against the
 * cliCommands each installed plugin declares in its manifest and dispatches
 * to the exec tool or API route it names. Arguments are parsed strictly
 * against each command's declared `args` (src/cli/plugin-args.ts); API routes
 * resolve under the contributing plugin's id.
 */
import type { CliCommandContribution } from '../../../packages/sdk/src/types/manifest'
import { api, apiGet, apiPost } from '../http'
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

/** Global flags the CLI consumes itself; they never reach command params. */
function withoutGlobalFlags(args: string[]): string[] {
  return stripActorFlag(args).rest.filter((arg) => arg !== '--json')
}

export async function dispatchPluginCliCommand(cmd: string, args: string[]): Promise<boolean> {
  const manifest = await apiGet('/api/plugins/manifest') as { plugins: PluginManifestRow[] }
  const words = [cmd, ...withoutGlobalFlags(args)]
  for (const plugin of manifest.plugins) {
    for (const command of plugin.contributes?.cliCommands ?? []) {
      if (!command.dispatch) continue
      const match = matchCliCommand(command, words)
      if (!match) continue
      if (!match.ok) await exitCommandIssue(match.error, { usage: command.usage })
      const params = match.ok ? match.params : {}
      const invocation = invocationCommand([cmd, ...args])

      if (command.dispatch.type === 'execTool') {
        const result = await apiPost(`/api/exec-tools/${encodeURIComponent(command.dispatch.name)}`, { params, agent: 'cli' })
        await printPluginCliCommandResult(invocation, args, result)
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
