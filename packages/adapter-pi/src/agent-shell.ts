/**
 * The agent's bash tool, carrying who is running it (#898 D-H5).
 *
 * Pi's built-in bash is replaced by the same tool definition (registered
 * under the same name, so the custom one wins) with a `spawnHook` that sets
 * BAKIN_AGENT_CONTEXT=<agentId> on EVERY command's own environment — never
 * the shared `process.env`, and it survives `cd`. A `bakin` command the
 * agent runs then tells the server it is an agent, and an approval decision
 * it attempts with `--as human` is refused.
 *
 * Keeps the session's configured shell prefix and shell path, and is never
 * activated by registration (only when the session's selection names bash).
 */
import { createBashToolDefinition, type ToolDefinition } from '@earendil-works/pi-coding-agent'
import { AGENT_CONTEXT_ENV } from '@bakin/core/approvals/provenance'

export interface ShellSettings {
  getShellCommandPrefix(): string | undefined
  getShellPath(): string | undefined
}

export function agentBashTool(cwd: string, settings: ShellSettings, agentId: string): ToolDefinition {
  const commandPrefix = settings.getShellCommandPrefix()
  const shellPath = settings.getShellPath()
  const definition = createBashToolDefinition(cwd, {
    ...(commandPrefix ? { commandPrefix } : {}),
    ...(shellPath ? { shellPath } : {}),
    spawnHook: (context) => ({ ...context, env: { ...context.env, [AGENT_CONTEXT_ENV]: agentId } }),
  })
  // Never activated by registration: bash is active exactly when the
  // session's own selection names it (defaultTools / toolsMode), as the
  // built-in was — a session configured without a shell must not gain one.
  // Same widening Pi applies to its own built-in definitions in the registry.
  return { ...definition, defaultActive: false } as unknown as ToolDefinition
}
