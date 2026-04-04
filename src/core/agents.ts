/**
 * Agent Communication API for Bakin.
 * Core routes for agent-to-agent interaction and status queries.
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'
import { getSettings } from './settings'
import * as openclaw from './openclaw-client'
import { readTaskboard } from '../lib/taskboard'

const log = createLogger('agents')

interface AgentStatus {
  id: string
  name: string
  activeTasks: { id: string; title: string }[]
  lastActivity: string | null
}

interface AgentTask {
  id: string
  title: string
  column: string
  description?: string
  lastLog?: string
}

/**
 * Get status for a specific agent — their current tasks and last activity.
 */
export async function getAgentStatus(agentId: string, contentDir: string): Promise<AgentStatus> {
  const settings = getSettings()
  const agents = settings.agents

  // Resolve name (agents list uses short names)
  const name = agents.includes(agentId) ? agentId : agentId

  // Get tasks assigned to this agent
  const tasks = getAgentTasks(agentId, contentDir)
  const activeTasks = tasks
    .filter(t => t.column === 'in-progress')
    .map(t => ({ id: t.id, title: t.title }))

  // Find last activity from heartbeats
  const lastActivity = getLastHeartbeat(agentId, contentDir)

  return {
    id: agentId,
    name,
    activeTasks,
    lastActivity,
  }
}

/**
 * Get all tasks assigned to an agent across all columns.
 */
export function getAgentTasks(agentId: string, _contentDir: string): AgentTask[] {
  const board = readTaskboard()
  const tasks: AgentTask[] = []

  const columnMap: Record<string, string> = {
    todo: 'todo',
    inProgress: 'in-progress',
    blocked: 'blocked',
    done: 'done',
    backlog: 'backlog',
    review: 'review',
    confirmed: 'confirmed',
  }

  for (const [colName, colTasks] of Object.entries(board.columns)) {
    for (const task of colTasks as Array<{ id: string; title: string; agent?: string; description?: string }>) {
      if (task.agent === agentId) {
        tasks.push({
          id: task.id,
          title: task.title,
          column: columnMap[colName] || colName,
          description: task.description,
        })
      }
    }
  }

  return tasks
}

/**
 * Send a message to an agent.
 */
export async function sendMessageToAgent(
  agentId: string,
  message: string
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const AGENT_ID_MAP: Record<string, string> = { roscoe: 'main' }
  const resolvedId = AGENT_ID_MAP[agentId] || agentId

  try {
    const reply = await openclaw.sendMessage(resolvedId, message)
    return { ok: true, reply }
  } catch (err) {
    log.error(`Failed to send message to agent ${agentId}`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * List all configured agents with their current status.
 */
export async function listAgents(contentDir: string): Promise<AgentStatus[]> {
  const settings = getSettings()
  const statuses: AgentStatus[] = []

  for (const agentId of settings.agents) {
    statuses.push(await getAgentStatus(agentId, contentDir))
  }

  return statuses
}

/**
 * Get the most recent heartbeat timestamp for an agent.
 */
function getLastHeartbeat(agentId: string, contentDir: string): string | null {
  const heartbeatsDir = join(contentDir, 'heartbeats')
  if (!existsSync(heartbeatsDir)) return null

  try {
    const files = readdirSync(heartbeatsDir)
      .filter(f => f.startsWith(agentId) && f.endsWith('.json'))
      .sort()
      .reverse()

    if (files.length === 0) return null

    const latest = JSON.parse(readFileSync(join(heartbeatsDir, files[0]), 'utf-8'))
    return latest.timestamp || latest.ts || null
  } catch {
    return null
  }
}
