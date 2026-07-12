/**
 * Pi runtime helpers for the dev rig. Pure: paths, env, argv builders, and
 * auth/settings derivations — no I/O (the lifecycle layer runs them).
 *
 * Load-bearing SDK facts (0.80.3, verified):
 *   - There is NO `pi login` subcommand. Subscription auth is the interactive
 *     TUI's /login slash command — the rig spawns the TUI and the user drives it.
 *   - The SDK's home override is PI_CODING_AGENT_DIR and it IS the agent dir
 *     (…/agent), not the home root. Bakin's adapter uses PI_HOME = the parent.
 *     Aligning them: PI_CODING_AGENT_DIR = $PI_HOME/agent → one auth.json.
 *
 * Boundary: dev-rig module, exempt from provider-boundary rules
 * (see tests/architecture/adapter-boundary.test.ts, isDevRig).
 */
import { join } from 'node:path'

/** The pinned SDK ships the `pi` CLI — run it from the repo's own dependency. */
export const PI_CLI_ENTRY = 'packages/adapter-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'
/** Agent-visible pi home inside the sandbox container (bind mount of dev/pi-home-sandbox). */
export const PI_HOME_CONTAINER = '/home/node/.pi'

export function piAgentDir(piHome: string): string {
  return join(piHome, 'agent')
}

export function piAuthFile(piHome: string): string {
  return join(piAgentDir(piHome), 'auth.json')
}

export function piSettingsFile(piHome: string): string {
  return join(piAgentDir(piHome), 'settings.json')
}

export function piLoginEnv(piHome: string): Record<string, string> {
  return { PI_CODING_AGENT_DIR: piAgentDir(piHome) }
}

/** Interactive TUI (the user types /login) via the pinned SDK CLI on the host. */
export function piLoginArgs(repoRoot: string): string[] {
  return ['node', join(repoRoot, PI_CLI_ENTRY)]
}

/** Sandbox: exec the TUI into the running sandbox-pi container (env from the service). */
export function sandboxPiLoginArgs(composeFile: string): string[] {
  return ['docker', 'compose', '-f', composeFile, 'exec', '-it', 'sandbox-pi', 'node', `/bakin/${PI_CLI_ENTRY}`]
}

/** Which authed provider drives the rig's default model, in preference order. */
const PROVIDER_PRIORITY = ['anthropic', 'openai-codex', 'openai', 'github-copilot']

/**
 * Derive `provider/model` from auth.json + the SDK's defaultModelPerProvider
 * table (injected — the table is dynamic-imported by the lifecycle and may be
 * unavailable; every failure path returns null, callers warn-don't-fail).
 */
export function defaultModelFromAuth(
  authJsonText: string,
  defaults: Record<string, string> | null,
): string | null {
  if (!defaults) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(authJsonText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const providers = Object.entries(parsed as Record<string, unknown>)
    .filter(([, v]) => v !== null && typeof v === 'object')
    .map(([k]) => k)
  const ordered = [
    ...PROVIDER_PRIORITY.filter((p) => providers.includes(p)),
    ...providers.filter((p) => !PROVIDER_PRIORITY.includes(p)),
  ]
  for (const provider of ordered) {
    const model = defaults[provider]
    if (model) return `${provider}/${model}`
  }
  return null
}

/**
 * Merge routing.defaultModel into pi's own settings.json. Returns the new
 * file content, or null when nothing should be written (already set — the
 * user's choice wins — or the existing file is unparseable: never clobber).
 */
export function patchPiSettings(existingText: string | null, defaultModel: string): string | null {
  let settings: Record<string, unknown> = {}
  if (existingText !== null) {
    try {
      settings = JSON.parse(existingText) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const routing = (settings.routing && typeof settings.routing === 'object')
    ? { ...(settings.routing as Record<string, unknown>) }
    : {}
  if (typeof routing.defaultModel === 'string' && routing.defaultModel) return null
  routing.defaultModel = defaultModel
  return JSON.stringify({ ...settings, routing }, null, 2)
}
