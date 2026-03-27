/**
 * Human-readable step context formatter.
 *
 * Transforms raw step JSON into a structured text block that agents
 * can read without parsing JSON.
 */
import { z } from 'zod'
import { getCurrentStep } from '../../plugins/workflows/runtime'
import { succeed, fail } from './common'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

interface StepContext {
  stepId: string
  status: string
  label?: string
  agent?: string
  instructions?: string
  output_schema?: Record<string, unknown>
  priorStepOutput?: unknown
  stepOutputs?: Record<string, unknown>
  rejectionReason?: string
  previousOutput?: unknown
}

/**
 * Format a JSON schema into a readable field list.
 */
function formatSchema(schema: Record<string, unknown>, indent = 0): string {
  const prefix = '  '.repeat(indent)
  const lines: string[] = []

  const properties = (schema.properties || schema.fields || schema) as Record<string, Record<string, unknown>>
  const required = new Set<string>((schema.required as string[]) || [])

  for (const [key, def] of Object.entries(properties)) {
    if (key === 'type' || key === 'required' || key === 'properties' || key === 'fields') continue
    const type = (def?.type as string) || 'unknown'
    const desc = (def?.description as string) || ''
    const req = required.has(key) ? ', required' : ''
    lines.push(`${prefix}- ${key} (${type}${req})${desc ? ': ' + desc : ''}`)

    // Recurse into nested objects
    if (type === 'object' && (def.properties || def.fields)) {
      lines.push(formatSchema(def as Record<string, unknown>, indent + 1))
    }
  }

  return lines.join('\n')
}

/**
 * Format step context as human-readable text.
 */
export function formatStepContext(step: StepContext): string {
  const sections: string[] = []

  sections.push(`STEP: ${step.stepId}`)
  sections.push(`STATUS: ${step.status}`)
  if (step.label) sections.push(`LABEL: ${step.label}`)
  if (step.agent) sections.push(`AGENT: ${step.agent}`)

  if (step.instructions) {
    sections.push('')
    sections.push('INSTRUCTIONS:')
    sections.push(step.instructions)
  }

  if (step.priorStepOutput) {
    sections.push('')
    sections.push('PRIOR STEP OUTPUT:')
    sections.push(typeof step.priorStepOutput === 'string'
      ? step.priorStepOutput
      : JSON.stringify(step.priorStepOutput, null, 2))
  } else if (!step.stepOutputs || Object.keys(step.stepOutputs).length === 0) {
    sections.push('')
    sections.push('PRIOR STEP OUTPUT:')
    sections.push('(none — this is the first step)')
  }

  if (step.stepOutputs && Object.keys(step.stepOutputs).length > 0) {
    sections.push('')
    sections.push('ALL PRIOR STEP OUTPUTS:')
    for (const [stepId, output] of Object.entries(step.stepOutputs)) {
      sections.push(`  [${stepId}]:`)
      sections.push('  ' + JSON.stringify(output, null, 2).replace(/\n/g, '\n  '))
    }
  }

  if (step.output_schema) {
    sections.push('')
    sections.push('REQUIRED OUTPUT SCHEMA:')
    sections.push(formatSchema(step.output_schema))
  }

  if (step.rejectionReason) {
    sections.push('')
    sections.push('REJECTION CONTEXT:')
    sections.push(step.rejectionReason)
    if (step.previousOutput) {
      sections.push('')
      sections.push('YOUR PREVIOUS OUTPUT (needs revision):')
      sections.push(JSON.stringify(step.previousOutput, null, 2))
    }
  } else {
    sections.push('')
    sections.push('REJECTION CONTEXT:')
    sections.push('(none — first attempt)')
  }

  return sections.join('\n')
}

export async function getStepFormatted(
  taskId: string,
  agent: string,
): Promise<ExecToolResult> {
  try {
    const step = await getCurrentStep(taskId, agent)
    if (!step) {
      return fail('No active step found for this task')
    }
    const formatted = formatStepContext(step as unknown as StepContext)
    return succeed({ formatted, raw: step })
  } catch (err) {
    return fail(`Failed to get step: ${String(err)}`)
  }
}

addExecTool({
  name: 'beacon_exec_get_step',
  description: 'Get the current workflow step as human-readable formatted text. Includes instructions, prior outputs, schema, and rejection context in a clear structure.',
  source: 'core',
  parameters: {
    taskId: z.string().describe('Task ID'),
  },
  handler: async (params, agent) => {
    return getStepFormatted(params.taskId as string, agent)
  },
})
