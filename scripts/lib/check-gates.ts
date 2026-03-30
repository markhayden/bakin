/**
 * bakin_exec_check_gates — Human-readable gate status overview.
 */
import { z } from 'zod'
import { loadInstance } from '../../plugins/workflows/runtime'
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
    const instance = loadInstance(taskId)
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
    for (const [stepId, state] of Object.entries(instance.stepStates)) {
      // We identify gates by checking if they have pending_approval status
      // or by naming convention. The stepStates don't carry the step type,
      // so we check for gate-like statuses and naming patterns.
      const isGate = state.status === 'pending_approval' ||
        stepId.includes('gate') || stepId.includes('review') || stepId.includes('approval')

      if (!isGate) continue
      hasGates = true

      const display = STATUS_DISPLAY[state.status] || state.status.toUpperCase()
      const time = state.completedAt
        ? `  (${new Date(state.completedAt).toLocaleString()})`
        : state.startedAt
          ? `  (since ${new Date(state.startedAt).toLocaleString()})`
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
  handler: async (params) => {
    return checkGates(params.taskId as string)
  },
})
