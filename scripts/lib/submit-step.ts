/**
 * Enhanced bakin_submit_step — local pre-validation before server submission.
 *
 * Validates output against the step's JSON schema using the same ajv
 * validator the server uses. Catches errors locally with detailed
 * field-level messages, avoiding wasted round trips.
 */
import { z } from 'zod'
import { getCurrentStep, completeStep } from '../../plugins/workflows/runtime'
import { validateStepOutput } from '../../plugins/workflows/schema-validator'
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
    // Fetch current step to get schema
    const step = await getCurrentStep(taskId, agent)
    if (!step) {
      return fail('No active step found for this task')
    }

    const schema = (step as Record<string, unknown>).output_schema as Record<string, unknown> | undefined

    // Local pre-validation if schema exists
    if (schema) {
      const validation = validateStepOutput(schema, output)
      if (!validation.valid) {
        return fail('Schema validation failed — fix these before resubmitting', validation.errors)
      }
    }

    // Submit to server
    const result = await completeStep(taskId, stepId, output, agent)
    return succeed({
      submitted: true,
      success: result.success,
      workflowComplete: result.workflowComplete,
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
  handler: async (params, agent) => {
    return submitStepValidated(
      params.taskId as string,
      params.stepId as string,
      params.output as Record<string, unknown>,
      agent,
    )
  },
})
