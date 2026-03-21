import { NextResponse, type NextRequest } from 'next/server'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const AGENT_WORKSPACE_MAP: Record<string, string> = {
  main-operator: join(homedir(), '.openclaw', 'workspace'),
  patch: join(homedir(), '.openclaw', 'workspaces', 'patch'),
  pixel: join(homedir(), '.openclaw', 'workspaces', 'pixel'),
  rolo: join(homedir(), '.openclaw', 'workspaces', 'rolo'),
  chef: join(homedir(), '.openclaw', 'workspaces', 'chef'),
  explorer: join(homedir(), '.openclaw', 'workspaces', 'explorer'),
  trainer: join(homedir(), '.openclaw', 'workspaces', 'trainer'),
  coach: join(homedir(), '.openclaw', 'workspaces', 'coach'),
}

const CORE_FILES = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md']

function readFileSafe(path: string): string | null {
  try {
    if (existsSync(path)) return readFileSync(path, 'utf-8')
  } catch { /* */ }
  return null
}

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agentId')
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const workspaceDir = AGENT_WORKSPACE_MAP[agentId]
  if (!workspaceDir) return NextResponse.json({ error: 'Unknown agent' }, { status: 404 })

  if (!existsSync(workspaceDir)) {
    return NextResponse.json({ files: {}, memoryFiles: {} })
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
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()
        .slice(0, 7) // last 7 days
      for (const name of entries) {
        const content = readFileSafe(join(memoryDir, name))
        if (content) memoryFiles[name] = content
      }
    } catch { /* */ }
  }

  return NextResponse.json({ files, memoryFiles })
}
