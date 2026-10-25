/**
 * Interactive launch for plugin CLI commands (`dispatch.launch`): the plugin's
 * POST route prepares the work and answers `{ args, confirm? }`; the CLI runs
 * the declared managed binary in the foreground with this terminal's stdio and
 * environment, then reports the child pid so the plugin can admit it.
 *
 * Trusted installed-plugin execution, not a sandbox: only the binary the
 * manifest names (validated against its requires.bins) is ever executed, and
 * only from Bakin's bin dir — never a path or command from the response.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { CliIdentity } from './identity'

export class LaunchError extends Error {}

const LaunchAnswerSchema = z.object({
  args: z.array(z.string().max(4096)).max(64),
  confirm: z.object({ path: z.string().regex(/^\/[A-Za-z0-9/_-]*$/), token: z.string().min(16).max(256) }).optional(),
})

export interface LaunchChild { pid: number; exited: Promise<number>; kill(): void }

export interface LaunchDeps {
  /** stdin and stdout are both a TTY. */
  interactive: boolean
  /** The CLI targets this home's own running server (server.lock), not BAKIN_URL. */
  localServer: boolean
  binDir: string
  identity(): Promise<Pick<CliIdentity, 'agentContext' | 'operatorDeclared'>>
  post(path: string, body: unknown): Promise<unknown>
  spawn(argv: string[]): LaunchChild
}

export async function runLaunch(
  command: { pluginId: string; path: string; bin: string },
  params: Record<string, unknown>,
  deps: LaunchDeps,
): Promise<number> {
  if (!deps.interactive) throw new LaunchError('This command takes over your terminal; run it from an interactive terminal.')
  if (!deps.localServer) throw new LaunchError("This command needs this machine's running Bakin (not a BAKIN_URL target).")
  const identity = await deps.identity()
  if (identity.agentContext !== null) throw new LaunchError(`Refused in an agent context (${identity.agentContext}); interactive commands are operator-only.`)
  if (!identity.operatorDeclared) throw new LaunchError('This command acts as you: add --as human.')
  const executable = join(deps.binDir, command.bin)
  if (!existsSync(executable)) throw new LaunchError(`${command.bin} is not installed; run bakin install plugin-assets.`)

  const parsed = LaunchAnswerSchema.safeParse(await deps.post(`/api/plugins/${command.pluginId}${command.path}`, params))
  if (!parsed.success) throw new LaunchError(`The plugin sent an unexpected launch answer: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  const child = deps.spawn([executable, ...parsed.data.args])
  if (parsed.data.confirm) {
    try {
      await deps.post(`/api/plugins/${command.pluginId}${parsed.data.confirm.path}`, { token: parsed.data.confirm.token, pid: child.pid })
    } catch (err) {
      child.kill()
      await child.exited
      throw new LaunchError(`The plugin did not admit this terminal: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return child.exited
}

/** Production deps: inherited stdio and environment, no shell. */
export function spawnInherited(argv: string[]): LaunchChild {
  const child = Bun.spawn(argv, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit', env: process.env })
  return { pid: child.pid, exited: child.exited, kill: () => child.kill() }
}
