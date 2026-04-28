/**
 * Centralized reader for `~/.openclaw/openclaw.json`.
 *
 * Before this module existed, three separate call sites (main-agent,
 * team/openclaw-adapter, settings) each maintained their own mtime-cached
 * parse of openclaw.json. They drifted, each caught errors differently, and
 * any regression had to be fixed in triplicate. This module is the single
 * place that stats + parses the file; every other Bakin module imports from
 * here.
 *
 * Contract:
 *   - Pure read path. Never mutates openclaw.json.
 *     Legitimate write paths live behind the runtime adapter and call
 *     `resetOpenClawConfigCache()` after writing to force a re-read on the
 *     next call.
 *   - Mtime-cached: every call stats the file (cheap), re-parses only when
 *     the mtime changes. Renaming an agent in openclaw.json is picked up on
 *     the next call without a restart.
 *   - Non-throwing: any stat, read, parse, or path-resolution failure
 *     returns `null` (from `readOpenClawConfig`) or `[]` (from the agent
 *     helpers). The test-env guard in `openclaw-home.ts` can throw when
 *     resolving paths; we swallow that here so tests that don't mock us
 *     still observe a clean "no config" state.
 */
import { readFileSync, statSync } from 'fs'

import { getOpenClawPath } from './openclaw-home'

export interface OpenClawAgent {
  id: string
  name?: string
  workspace?: string
  agentDir?: string
  model?: { primary?: string }
  identity?: { name?: string; emoji?: string }
  subagents?: { allowAgents?: string[]; model?: string }
}

export interface OpenClawConfig {
  agents?: {
    defaults?: {
      model?: { primary?: string }
      workspace?: string
    }
    list?: OpenClawAgent[]
  }
}

let cachedConfig: { mtimeMs: number; config: OpenClawConfig | null } | null = null

/**
 * Read openclaw.json through an mtime-keyed cache. Returns the parsed config
 * or `null` if the file is missing, unreadable, malformed, or if the path
 * itself cannot be resolved (e.g. the test-env safety guard fires).
 */
export function readOpenClawConfig(): OpenClawConfig | null {
  let path: string
  try {
    path = getOpenClawPath('openclaw.json')
  } catch {
    cachedConfig = null
    return null
  }

  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    cachedConfig = null
    return null
  }

  if (cachedConfig && cachedConfig.mtimeMs === mtimeMs) return cachedConfig.config

  let config: OpenClawConfig | null
  try {
    config = JSON.parse(readFileSync(path, 'utf-8')) as OpenClawConfig
  } catch {
    config = null
  }
  cachedConfig = { mtimeMs, config }
  return config
}

/** Returns the agents list or an empty array. Safe on missing/malformed config. */
export function getAgentList(): OpenClawAgent[] {
  const list = readOpenClawConfig()?.agents?.list
  return Array.isArray(list) ? list : []
}

/** Returns just the agent ids, in list order. Empty array on missing config. */
export function getAgentIds(): string[] {
  return getAgentList().map((a) => a.id)
}

/** Look up a single agent by id, or `null` when missing. */
export function findAgentById(id: string): OpenClawAgent | null {
  return getAgentList().find((a) => a.id === id) ?? null
}

/**
 * Drop the mtime cache. Called by the openclaw-adapter write path after
 * `addAgent` / `removeAgent` mutate the file so the next read observes the
 * fresh contents even if the filesystem mtime granularity is coarser than
 * the caller's write-read gap.
 */
export function resetOpenClawConfigCache(): void {
  cachedConfig = null
}
