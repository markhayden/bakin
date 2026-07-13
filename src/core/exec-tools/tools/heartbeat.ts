/**
 * bakin_exec_heartbeat — Write agent heartbeat to ~/.bakin/heartbeats/{agent}.json.
 * Agents should call this periodically to signal they're alive.
 */
import { z } from 'zod'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../../../core/content-dir'
import { recordUsage } from '../../../core/usage'
import { addExecTool } from '../registry'

addExecTool({
  name: 'bakin_exec_heartbeat',
  label: 'Sent heartbeat',
  activityClass: 'routine',
  description:
    'Write a heartbeat signal. Call periodically (every 5-10 minutes) to indicate you are alive. Also call when starting or finishing a task.',
  source: 'core',
  parameters: {
    status: z.enum(['working', 'idle']).default('idle').describe('Current status'),
    currentTask: z.string().optional().describe('Task ID currently being worked on'),
    message: z.string().optional().describe('Brief status note'),
  },
  handler: async (params: Record<string, unknown>, agent: string) => {
    try {
      const contentDir = getContentDir()
      const heartbeatsDir = join(contentDir, 'heartbeats')
      if (!existsSync(heartbeatsDir)) mkdirSync(heartbeatsDir, { recursive: true })

      const entry = {
        agent,
        timestamp: new Date().toISOString(),
        status: params.status ?? 'idle',
        ...(params.currentTask ? { currentTask: params.currentTask } : {}),
        ...(params.message ? { message: params.message } : {}),
      }

      writeFileSync(join(heartbeatsDir, `${agent}.json`), JSON.stringify(entry, null, 2))
      recordUsage({
        kind: 'agent',
        activityClass: 'routine',
        name: 'heartbeat',
        agent,
        durationMs: null,
        status: 'ok',
        meta: {
          status: params.status ?? 'idle',
          ...(params.currentTask ? { taskId: params.currentTask } : {}),
          ...(params.message ? { message: params.message } : {}),
        },
      })
      return { ok: true, heartbeat: entry }
    } catch (err) {
      recordUsage({
        kind: 'agent',
        activityClass: 'routine',
        name: 'heartbeat',
        agent,
        durationMs: null,
        status: 'error',
        meta: { error: String(err) },
      })
      return { ok: false, error: `Failed to write heartbeat: ${String(err)}` }
    }
  },
})
