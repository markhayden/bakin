/**
 * OpenClaw main-agent resolution.
 *
 * OpenClaw's orchestrator id is the literal string "main". The adapter owns
 * this provider-specific invariant and exposes generic runtime agent APIs to
 * the rest of Bakin.
 */
import { findAgentById } from './config'

export function getMainAgentId(): string {
  const entry = findAgentById('main')
  if (entry) return 'main'
  throw new Error(
    "openclaw.json has no agent with id 'main'. OpenClaw's orchestrator id is always 'main'; "
    + 'add that entry or run `bakin check runtime`.',
  )
}

export function tryGetMainAgentId(): string | null {
  return findAgentById('main') ? 'main' : null
}

export function getMainAgentName(): string {
  const entry = findAgentById('main')
  const name = entry?.identity?.name
  if (typeof name === 'string' && name.trim().length > 0) return name
  return 'Main'
}
