/**
 * bakin_exec_log — Consistent progress logging with categories and stage tags.
 */
import { z } from 'zod'
import { logProgress } from '../../src/core/task-service'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

const CATEGORIES = ['start', 'progress', 'milestone', 'blocked', 'complete'] as const
type LogCategory = typeof CATEGORIES[number]

const CATEGORY_PREFIX: Record<LogCategory, string> = {
  start: '[START]',
  progress: '[PROGRESS]',
  milestone: '[MILESTONE]',
  blocked: '[BLOCKED]',
  complete: '[COMPLETE]',
}

export interface LogProgressParams {
  taskId: string
  message: string
  agent: string
  category?: LogCategory
  stage?: string
}

export async function logProgressFormatted(params: LogProgressParams): Promise<ExecToolResult> {
  const { taskId, message, agent, category = 'progress', stage } = params

  const prefix = CATEGORY_PREFIX[category]
  const stageTag = stage ? ` [${stage}]` : ''
  const formatted = `${prefix}${stageTag} ${message}`

  try {
    await logProgress(taskId, agent, formatted, 'mcp')
    return succeed({ formatted })
  } catch (err) {
    return fail(`Failed to log progress: ${String(err)}`)
  }
}

addExecTool({
  name: 'bakin_exec_log',
  description: 'Log a formatted progress update with category and stage tags. Categories: start, progress, milestone, blocked, complete. More structured than raw bakin_log_progress.',
  source: 'core',
  parameters: {
    taskId: z.string().describe('Task ID'),
    message: z.string().describe('Human-readable status update'),
    category: z.enum(CATEGORIES).optional().describe('Log category (default: progress)'),
    stage: z.string().optional().describe('Workflow stage tag (e.g., "image-gen", "copy-review")'),
  },
  handler: async (params, agent) => {
    return logProgressFormatted({ ...params, agent } as LogProgressParams)
  },
})
