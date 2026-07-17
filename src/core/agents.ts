/**
 * Agent Communication API for Bakin.
 * Core routes for agent-to-agent interaction and status queries.
 */
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getAppServices } from './app-services'
import { createLogger } from './logger'
import { meterAgentTurn } from './agent-cost'
import { createFileBakinTaskStore } from '@bakin/core/tasks/store'
import { getBakinPaths } from './content-dir'

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
  const agent = await getAppServices().runtime.agents.get(agentId)
  const name = agent?.name ?? agentId

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
  void _contentDir
  const store = createFileBakinTaskStore(getBakinPaths().tasks)
  return store.listSync({ agent: agentId }).map((task) => ({
    id: task.id,
    title: task.title,
    column: task.column === 'inProgress' ? 'in-progress' : task.column,
    description: task.description,
  }))
}

/**
 * Send a message to an agent.
 */
export async function sendMessageToAgent(
  agentId: string,
  message: string
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const result = await getAppServices().runtime.messaging.send({ agentId, content: message })
    await meterAgentTurn({ agent: agentId, activityClass: 'user', result, workClass: 'send', name: 'send' })
    return { ok: true, reply: result.content ?? '' }
  } catch (err) {
    log.error(`Failed to send message to agent ${agentId}`, err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * List all configured agents with their current status.
 */
export async function listAgents(contentDir: string): Promise<AgentStatus[]> {
  const statuses: AgentStatus[] = []

  for (const agent of await getAppServices().runtime.agents.list()) {
    statuses.push(await getAgentStatus(agent.id, contentDir))
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
