/**
 * Enhanced bakin_submit_step — local pre-validation before server submission.
 *
 * Validates output against the step's JSON schema using the same ajv
 * validator the server uses. Catches errors locally with detailed
 * field-level messages, avoiding wasted round trips.
 */
import { z } from 'zod'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

export async function submitStepValidated(
  taskId: string,
  stepId: string,
  output: Record<string, unknown>,
  agent: string,
): Promise<ExecToolResult> {
  try {
    const hooks = getHookRegistry()

    // Fetch current step to get schema
    const step = await hooks.invoke<Record<string, unknown>>('workflows.getCurrentStep', { taskId, agentId: agent })
    if (!step) {
      return fail('No active step found for this task')
    }

    const schema = step.output_schema as Record<string, unknown> | undefined

    // Local pre-validation if schema exists
    if (schema) {
      const validation = await hooks.invoke<{ valid: boolean; errors?: unknown }>('workflows.validateStepOutput', { schema, output })
      if (validation && !validation.valid) {
        return fail('Schema validation failed — fix these before resubmitting', validation.errors)
      }
    }

    // Submit to server
    const result = await hooks.invoke<Record<string, unknown>>('workflows.completeStep', { taskId, stepId, output, callerAgentId: agent })
    return succeed({
      submitted: true,
      success: result?.success,
      workflowComplete: result?.workflowComplete,
    })
  } catch (err) {
    const msg = String(err)
    // Check for known server-side errors
    if (msg.includes('near-duplicate') || msg.includes('rejection')) {
      return fail('Submission rejected: output is too similar to your previous rejected submission. Address the feedback and make substantive changes.')
    }
    return fail(`Failed to submit step: ${msg}`)
  }
}

addExecTool({
  name: 'bakin_exec_submit_step',
  description: 'Submit workflow step output with local pre-validation. Validates against the step schema BEFORE hitting the server, giving you detailed field-level errors without a round trip.',
  source: 'core',
  parameters: {
    taskId: z.string().describe('Task ID'),
    stepId: z.string().describe('Step ID to submit for'),
    output: z.record(z.string(), z.unknown()).describe('JSON output matching the step schema'),
  },
  handler: async (params: Record<string, unknown>, agent: string) => {
    return submitStepValidated(
      params.taskId as string,
      params.stepId as string,
      params.output as Record<string, unknown>,
      agent,
    )
  },
})
