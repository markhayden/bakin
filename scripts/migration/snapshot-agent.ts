#!/usr/bin/env bun
/**
 * scripts/migration/snapshot-agent.ts
 *
 * One-shot tool used during the agent-packages refactor (PLAN.md phase B-1
 * and G-1..G-7). Captures everything we need to convert an existing,
 * hand-edited OpenClaw agent into an `agents/<id>/` reference package:
 *
 *   1. The agent's OpenClaw workspace          (~/.openclaw/workspaces/<id>/
 *                                                or  ~/.openclaw/workspace/  for main)
 *   2. The agent's Bakin UI assets             (~/.bakin/agents/<id>/)
 *   3. The agent's openclaw.json roster entry  (extracted as JSON for reference)
 *
 * Snapshots land at `agents/<id>/.snapshot/` (gitignored — see .gitignore).
 * The conversion phase reads from .snapshot/ to populate the package shape;
 * we keep the snapshot around until the corresponding agent has been
 * adopted on the real machine, so we can roll back if anything goes wrong.
 *
 * Usage:
 *   bun scripts/migration/snapshot-agent.ts <agent-id>
 *   bun scripts/migration/snapshot-agent.ts pixel
 *
 * Read-only against ~/.openclaw/ and ~/.bakin/. Writes only to the repo's
 * agents/<id>/.snapshot/ directory.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { getOpenClawHome, getOpenClawPath } from '../../packages/core/src/openclaw-home'
import { getContentDir } from '../../packages/core/src/content-dir'

interface SnapshotResult {
  agentId: string
  destDir: string
  workspaceCopied: number
  bakinAssetsCopied: number
  rosterEntry: unknown | null
  warnings: string[]
}

function copyTree(src: string, dst: string): number {
  let count = 0
  if (!existsSync(src)) return 0
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const dstPath = join(dst, entry.name)
    if (entry.isSymbolicLink()) continue // skip symlinks — refuse the leak vector
    if (entry.isDirectory()) {
      mkdirSync(dstPath, { recursive: true })
      count += copyTree(srcPath, dstPath)
    } else if (entry.isFile()) {
      mkdirSync(dirname(dstPath), { recursive: true })
      copyFileSync(srcPath, dstPath)
      count++
    }
  }
  return count
}

function readJsonOrNull(path: string): unknown | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

interface OpenClawAgent {
  id: string
  workspace?: string
}

interface OpenClawConfig {
  agents?: { list?: OpenClawAgent[]; defaults?: { workspace?: string } }
}

function resolveWorkspace(agentId: string): string {
  // Mirror the resolution in plugins/team/lib/openclaw-adapter.ts: explicit
  // entry.workspace > defaults.workspace (for main) > workspaces/<id>/ for
  // subagents. We don't import the adapter to keep this script self-contained
  // and runnable from a clean checkout.
  const config = readJsonOrNull(getOpenClawPath('openclaw.json')) as OpenClawConfig | null
  const entry = config?.agents?.list?.find((a) => a.id === agentId)
  if (entry?.workspace) return entry.workspace
  if (agentId === 'main') {
    return config?.agents?.defaults?.workspace ?? getOpenClawPath('workspace')
  }
  return getOpenClawPath('workspaces', agentId)
}

function snapshotAgent(agentId: string): SnapshotResult {
  const warnings: string[] = []
  const openClawHome = getOpenClawHome()
  const bakinHome = getContentDir()

  const repoRoot = resolve(import.meta.dir, '..', '..')
  const destDir = join(repoRoot, 'agents', agentId, '.snapshot')

  if (existsSync(destDir)) {
    warnings.push(`destination already exists: ${destDir} (will be overlaid, not cleared)`)
  }
  mkdirSync(destDir, { recursive: true })

  // Roster entry
  const config = readJsonOrNull(join(openClawHome, 'openclaw.json')) as OpenClawConfig | null
  const rosterEntry = config?.agents?.list?.find((a) => a.id === agentId) ?? null
  if (!rosterEntry) {
    warnings.push(`no roster entry for "${agentId}" in ${join(openClawHome, 'openclaw.json')}`)
  }
  if (rosterEntry !== null) {
    writeFileSync(
      join(destDir, 'openclaw-roster-entry.json'),
      JSON.stringify(rosterEntry, null, 2),
      'utf-8',
    )
  }

  // Workspace
  const wsSrc = resolveWorkspace(agentId)
  const wsDst = join(destDir, 'workspace')
  let workspaceCopied = 0
  if (!existsSync(wsSrc)) {
    warnings.push(`workspace path does not exist: ${wsSrc}`)
  } else if (!statSync(wsSrc).isDirectory()) {
    warnings.push(`workspace path is not a directory: ${wsSrc}`)
  } else {
    workspaceCopied = copyTree(wsSrc, wsDst)
  }

  // Bakin UI assets (~/.bakin/agents/<id>/)
  const bakinSrc = join(bakinHome, 'agents', agentId)
  const bakinDst = join(destDir, 'bakin-agents')
  let bakinAssetsCopied = 0
  if (existsSync(bakinSrc) && statSync(bakinSrc).isDirectory()) {
    bakinAssetsCopied = copyTree(bakinSrc, bakinDst)
  } else {
    warnings.push(`no Bakin agent dir at: ${bakinSrc}`)
  }

  // Snapshot manifest — small file describing what we captured.
  const manifest = {
    agentId,
    capturedAt: new Date().toISOString(),
    sources: {
      workspace: wsSrc,
      bakinAgents: bakinSrc,
      openclawConfig: join(openClawHome, 'openclaw.json'),
    },
    counts: { workspaceFiles: workspaceCopied, bakinAssetFiles: bakinAssetsCopied },
    rosterFound: rosterEntry !== null,
    warnings,
  }
  writeFileSync(
    join(destDir, 'snapshot-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  )

  return { agentId, destDir, workspaceCopied, bakinAssetsCopied, rosterEntry, warnings }
}

function main(): void {
  const agentId = process.argv[2]
  if (!agentId) {
    console.error('Usage: bun scripts/migration/snapshot-agent.ts <agent-id>')
    process.exit(2)
  }
  if (!/^[a-z0-9][a-z0-9-_]{0,39}$/i.test(agentId)) {
    console.error(`Invalid agent id "${agentId}" — must match /^[a-z0-9][a-z0-9-_]{0,39}$/i`)
    process.exit(2)
  }

  const result = snapshotAgent(agentId)
  console.log(JSON.stringify(result, null, 2))

  if (result.warnings.length > 0) {
    process.stderr.write(`\n${result.warnings.length} warning(s):\n`)
    for (const w of result.warnings) process.stderr.write(`  - ${w}\n`)
  }
}

if (import.meta.main) {
  main()
}

export { snapshotAgent }
export type { SnapshotResult }
