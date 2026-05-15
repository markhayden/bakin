import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'
import {
  findAgentPackage,
  readLockfile,
  type Lockfile,
  type PackageEntry,
} from '../../packages/core/src/agent-packages/lockfile'
import { getPackageSourceDir } from '../../packages/core/src/agent-packages/package-paths'
import { parseManifest } from '../../packages/core/src/agent-packages/manifest'

const log = createLogger('mcp-tool-policy')

export type McpToolPolicy =
  | {
    kind: 'unrestricted'
    reason: 'unmanaged-agent' | 'agent-package-unrestricted'
    packageId?: string
  }
  | {
    kind: 'allowlist'
    packageId: string
    agentState: NonNullable<PackageEntry['state']>
    patterns: string[]
  }
  | {
    kind: 'deny-all'
    reason: string
    packageId?: string
  }

export function resolveMcpToolPolicy(agentId: string): McpToolPolicy {
  const contentDir = getContentDir()
  let lock: Lockfile
  try {
    lock = readLockfile(join(contentDir, 'packages', 'lock.json'))
  } catch (err) {
    log.warn('Failed to read agent-package lockfile for MCP policy; denying tools', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      kind: 'deny-all',
      reason: 'agent package lockfile could not be read',
    }
  }

  const found = findAgentPackage(lock, agentId)
  if (!found) {
    return { kind: 'unrestricted', reason: 'unmanaged-agent' }
  }

  const state = found.entry.state
  if (!state) {
    return {
      kind: 'deny-all',
      packageId: found.id,
      reason: 'agent package lockfile entry has no state',
    }
  }

  const manifestPath = join(
    getPackageSourceDir(contentDir, found.entry.kind, found.id, found.entry.version),
    'bakin-package.json',
  )
  if (!existsSync(manifestPath)) {
    return {
      kind: 'deny-all',
      packageId: found.id,
      reason: 'agent package manifest is missing',
    }
  }

  try {
    const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')))
    if (manifest.kind !== 'agent') {
      return {
        kind: 'deny-all',
        packageId: found.id,
        reason: 'agent package manifest is not kind "agent"',
      }
    }

    const patterns = normalizeAllowedTools(manifest.agent.allowedTools)
    if (patterns.length > 0) {
      return {
        kind: 'allowlist',
        packageId: found.id,
        agentState: state,
        patterns,
      }
    }

    return {
      kind: 'unrestricted',
      packageId: found.id,
      reason: 'agent-package-unrestricted',
    }
  } catch (err) {
    log.warn('Failed to parse agent-package manifest for MCP policy; denying tools', {
      agentId,
      packageId: found.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      kind: 'deny-all',
      packageId: found.id,
      reason: 'agent package manifest could not be parsed',
    }
  }
}

export function isToolAllowedByPolicy(policy: McpToolPolicy, toolName: string): boolean {
  if (policy.kind === 'unrestricted') return true
  if (policy.kind === 'deny-all') return false
  return policy.patterns.some((pattern) => toolPatternMatches(pattern, toolName))
}

export function describeMcpToolDenial(policy: McpToolPolicy): string {
  if (policy.kind === 'deny-all') return policy.reason
  if (policy.kind === 'allowlist') return 'tool is not in agent package allowedTools policy'
  return 'tool is allowed'
}

function normalizeAllowedTools(patterns: string[] | undefined): string[] {
  return Array.from(new Set((patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean))).sort()
}

function toolPatternMatches(pattern: string, toolName: string): boolean {
  if (pattern === '*' || pattern === toolName) return true
  if (!pattern.includes('*')) return false

  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${escaped}$`).test(toolName)
}
