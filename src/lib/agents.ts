/**
 * Agent management — delegates to the active runtime adapter. Start/restart
 * kick-offs are real LLM turns and are attributed under work class 'send'
 * (metered-only: a fixed system kick-off has nothing to route).
 */
import { getAppServices } from '../core/app-services'
import { meterAgentTurn } from '../core/agent-cost'

export async function startAgent(agentId: string, message?: string) {
  const msg = message || `You are ${agentId}. Check in and begin working on any assigned tasks.`
  try {
    const result = await getAppServices().runtime.messaging.send({ agentId, content: msg })
    await meterAgentTurn({ agent: agentId, activityClass: 'user', result, workClass: 'send', name: 'start' })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function stopAgent(agentId: string) {
  return { ok: false, error: `Stop is not yet supported by the active runtime adapter. Agent "${agentId}" continues running.` }
}

export async function restartAgent(agentId: string) {
  const msg = `You are ${agentId}. You have been restarted. Check your workspace and resume any in-progress tasks.`
  return startAgent(agentId, msg)
}
