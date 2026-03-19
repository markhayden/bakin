import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const OPENCLAW = '/opt/homebrew/bin/openclaw'

export async function startAgent(agentId: string, message?: string) {
  const msg = message || `You are ${agentId}. Check in and begin working on any assigned tasks.`
  try {
    await execFileAsync(OPENCLAW, ['agent', '--agent', agentId, '--message', msg, '--deliver'])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

export async function stopAgent(agentId: string) {
  // Placeholder — openclaw doesn't have a stop command yet
  return { ok: true, note: `Stop intent recorded for ${agentId}` }
}

export async function restartAgent(agentId: string) {
  const msg = `You are ${agentId}. You have been restarted. Check your workspace and resume any in-progress tasks.`
  return startAgent(agentId, msg)
}

export async function deliverTaskToAgent(agentId: string, taskTitle: string) {
  const msg = `Work on: ${taskTitle}`
  try {
    await execFileAsync(OPENCLAW, ['agent', '--agent', agentId, '--message', msg, '--deliver'])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
