/**
 * Normalize stored agent paths in openclaw.json to the container home.
 *
 * Reused rig state can carry HOST paths in agent config (a previous run's
 * `agents add` wrote pre-translation values) — in-container dispatch then
 * fails with EACCES mkdir '/Users'. The openclaw-shim translates CLI args at
 * call time; this is the stored-config counterpart, applied on `instance up`
 * before the gateway starts (#467, same family as the plugins.allow fix).
 *
 * Boundary: dev-rig module, exempt from provider-boundary rules.
 */

export const CONTAINER_OPENCLAW_HOME = '/home/node/.openclaw'

type JsonObject = Record<string, unknown>

function translate(value: unknown, hostOpenclawHome: string): { value: unknown; changed: boolean } {
  if (typeof value === 'string' && value.startsWith(hostOpenclawHome)) {
    return { value: CONTAINER_OPENCLAW_HOME + value.slice(hostOpenclawHome.length), changed: true }
  }
  return { value, changed: false }
}

/**
 * Pure: returns a deep-cloned config with `agents.defaults.workspace` and
 * `agents.list[*].{workspace,agentDir}` host-home prefixes rewritten to the
 * container home. Only the exact host openclaw-home prefix matches —
 * unrelated absolute paths are never touched.
 */
export function normalizeAgentPaths(
  config: JsonObject,
  hostOpenclawHome: string,
): { config: JsonObject; changed: boolean } {
  const next = structuredClone(config)
  let changed = false

  const agents = next.agents as JsonObject | undefined
  if (!agents || typeof agents !== 'object') return { config: next, changed }

  const defaults = agents.defaults as JsonObject | undefined
  if (defaults && typeof defaults === 'object') {
    const result = translate(defaults.workspace, hostOpenclawHome)
    if (result.changed) {
      defaults.workspace = result.value
      changed = true
    }
  }

  const list = agents.list
  if (Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue
      const agent = entry as JsonObject
      for (const key of ['workspace', 'agentDir'] as const) {
        const result = translate(agent[key], hostOpenclawHome)
        if (result.changed) {
          agent[key] = result.value
          changed = true
        }
      }
    }
  }

  return { config: next, changed }
}
