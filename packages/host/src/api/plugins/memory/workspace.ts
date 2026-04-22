/**
 * GET /api/plugins/memory/workspace?agentId=... — bundle of the agent's
 * core OpenClaw workspace files (SOUL/AGENTS/IDENTITY/USER/TOOLS) plus
 * the last 7 daily memory files.
 *
 * Migrated from src/app/api/plugins/memory/workspace/route.ts for
 * Phase B of #147.
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import { tryGetMainAgentId } from '@bakin/core/main-agent'

function getAgentWorkspacePath(agentId: string): string {
  if (agentId === tryGetMainAgentId()) return getOpenClawPath('workspace')
  return getOpenClawPath('workspaces', agentId)
}

const CORE_FILES = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md']

function readFileSafe(path: string): string | null {
  try {
    if (existsSync(path)) return readFileSync(path, 'utf-8')
  } catch { /* */ }
  return null
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const agentId = url.searchParams.get('agentId')
  if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

  const workspaceDir = getAgentWorkspacePath(agentId)

  if (!existsSync(workspaceDir)) {
    return Response.json({ files: {}, memoryFiles: {} })
  }

  // Read core files
  const files: Record<string, string> = {}
  for (const name of CORE_FILES) {
    const content = readFileSafe(join(workspaceDir, name))
    if (content) files[name] = content
  }

  // Read daily memory files
  const memoryFiles: Record<string, string> = {}
  const memoryDir = join(workspaceDir, 'memory')
  if (existsSync(memoryDir)) {
    try {
      const entries = readdirSync(memoryDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 7) // last 7 days
      for (const name of entries) {
        const content = readFileSafe(join(memoryDir, name))
        if (content) memoryFiles[name] = content
      }
    } catch { /* */ }
  }

  return Response.json({ files, memoryFiles })
}
