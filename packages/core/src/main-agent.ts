/**
 * Main agent (orchestrator) resolution for Bakin.
 *
 * OpenClaw's canonical orchestrator id is the literal string `"main"` on every
 * install. There is no detection heuristic, no settings override, no fallback:
 * if `openclaw.json` has an agent with `id: "main"` we return that id; if it
 * doesn't, we throw and point the caller at `bakin check openclaw`.
 *
 * Display name comes from `identity.name` on that entry, with a static `"Main"`
 * fallback when the name is missing.
 *
 * Reads go through `openclaw-config`, which owns the mtime-keyed cache — a
 * live edit to `openclaw.json` (e.g. renaming via `identity.name`) is picked
 * up on the next call without a restart.
 */
import { findAgentById } from './openclaw-config'

export function getMainAgentId(): string {
  const entry = findAgentById('main')
  if (entry) return 'main'
  throw new Error(
    "openclaw.json has no agent with id 'main'. OpenClaw's orchestrator id is always 'main'; " +
    'add that entry or run `bakin check openclaw`.'
  )
}

/**
 * Non-throwing variant for call sites that have a sensible degraded behavior
 * (e.g. sort order, optional UI defaults, diagnostic logging).
 */
export function tryGetMainAgentId(): string | null {
  return findAgentById('main') ? 'main' : null
}

export function getMainAgentName(): string {
  const entry = findAgentById('main')
  const name = entry?.identity?.name
  if (typeof name === 'string' && name.trim().length > 0) return name
  return 'Main'
}
