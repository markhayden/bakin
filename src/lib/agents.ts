/**
 * Agent management — delegates to the core openclaw-client HTTP module.
 */
import * as openclaw from '../core/openclaw-client'

export async function startAgent(agentId: string, message?: string) {
  const msg = message || `You are ${agentId}. Check in and begin working on any assigned tasks.`
  try {
    await openclaw.sendMessage(agentId, msg)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function stopAgent(agentId: string) {
  return { ok: false, error: `Stop is not yet supported by OpenClaw. Agent "${agentId}" continues running.` }
}

export async function restartAgent(agentId: string) {
  const msg = `You are ${agentId}. You have been restarted. Check your workspace and resume any in-progress tasks.`
  return startAgent(agentId, msg)
}

export async function deliverTaskToAgent(agentId: string, taskTitle: string, details?: string) {
  const detailBlock = details ? `\n\nDetails:\n${details}` : ''
  const msg = `Work on: ${taskTitle}${detailBlock}`
  try {
    await openclaw.sendMessage(agentId, msg)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
