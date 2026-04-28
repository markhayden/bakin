/**
 * GET /api/plugins/memory/workspace?agentId=... - bundle of the agent's
 * core runtime workspace files (SOUL/AGENTS/IDENTITY/USER/TOOLS) plus
 * the last 7 daily memory files.
 *
 * Migrated from src/app/api/plugins/memory/workspace/route.ts for
 * Phase B of #147.
 */
import { getAppServices } from '@/core/app-services'

const CORE_FILES = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md']
const DAILY_MEMORY_TIER = 'workspace-memory'

async function readWorkspaceFileSafe(agentId: string, path: string): Promise<string | null> {
  try {
    return (await getAppServices().runtime.agents.readWorkspaceFile(agentId, path))?.content ?? null
  } catch { /* */ }
  return null
}

export async function get(_req: Request, url: URL): Promise<Response> {
  const agentId = url.searchParams.get('agentId')
  if (!agentId) return Response.json({ error: 'agentId required' }, { status: 400 })

  const runtime = getAppServices().runtime

  if (!await runtime.agents.get(agentId)) {
    return Response.json({ files: {}, memoryFiles: {} })
  }

  // Read core files
  const files: Record<string, string> = {}
  for (const name of CORE_FILES) {
    const content = await readWorkspaceFileSafe(agentId, name)
    if (content) files[name] = content
  }

  // Read daily memory files
  const memoryFiles: Record<string, string> = {}
  try {
    const entries = (await runtime.memory.listEntries(DAILY_MEMORY_TIER, { agentId }))
      .map((entry) => entry.id)
      .filter((id) => id.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 7)
    for (const name of entries) {
      const entry = await runtime.memory.getEntry(DAILY_MEMORY_TIER, name, { agentId })
      if (entry?.content) memoryFiles[name] = entry.content
    }
  } catch { /* */ }

  return Response.json({ files, memoryFiles })
}
