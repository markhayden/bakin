/**
 * bakin_exec_check_gates — Human-readable gate status overview.
 */
import { z } from 'zod'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

const STATUS_DISPLAY: Record<string, string> = {
  complete: 'APPROVED',
  pending_approval: 'WAITING',
  pending: 'PENDING',
  rejected: 'REJECTED',
  in_progress: 'IN PROGRESS',
}

export async function checkGates(taskId: string): Promise<ExecToolResult> {
  try {
    const instance = await getHookRegistry().invoke<Record<string, unknown>>('workflows.loadInstance', { taskId })
    if (!instance) {
      return fail('No workflow instance found for this task')
    }

    const lines: string[] = []
    lines.push(`WORKFLOW: ${instance.workflowId} (${taskId})`)
    lines.push(`STATUS: ${instance.status}`)
    lines.push('')
    lines.push('GATES:')

    // We need to check stepStates for gate-type steps
    // stepStates is keyed by stepId with status info
    let hasGates = false
    const stepStates = (instance.stepStates || {}) as Record<string, Record<string, unknown>>
    for (const [stepId, state] of Object.entries(stepStates)) {
      const s = state as { status: string; completedAt?: string; startedAt?: string }
      const isGate = s.status === 'pending_approval' ||
        stepId.includes('gate') || stepId.includes('review') || stepId.includes('approval')

      if (!isGate) continue
      hasGates = true

      const display = STATUS_DISPLAY[s.status] || s.status.toUpperCase()
      const time = s.completedAt
        ? `  (${new Date(s.completedAt).toLocaleString()})`
        : s.startedAt
          ? `  (since ${new Date(s.startedAt).toLocaleString()})`
          : ''
      lines.push(`  ${stepId.padEnd(24)} ${display}${time}`)
    }

    if (!hasGates) {
      lines.push('  (no gates found in this workflow)')
    }

    lines.push('')
    lines.push(`CURRENT STEP: ${instance.currentStepId}`)

    const formatted = lines.join('\n')
    return succeed({ formatted })
  } catch (err) {
    return fail(`Failed to check gates: ${String(err)}`)
  }
}

addExecTool({
  name: 'bakin_exec_check_gates',
  description: 'Get a human-readable overview of all gate statuses in a workflow. Shows which gates are approved, waiting, or pending.',
  source: 'core',
  parameters: {
    taskId: z.string().describe('Task ID (or workflow instance ID)'),
  },
  handler: async (params: Record<string, unknown>) => {
    return checkGates(params.taskId as string)
  },
})
