import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const OPENCLAW = process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw'

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
  // OpenClaw doesn't have a native stop command yet.
  // Return honestly so the UI can reflect this.
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
    await execFileAsync(OPENCLAW, ['agent', '--agent', agentId, '--message', msg, '--deliver'])
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
