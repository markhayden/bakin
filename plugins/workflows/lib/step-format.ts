/**
 * Workflow Step Formatting (presentation-for-agents)
 *
 * Pure JSON-schema-to-text and step-context-to-text formatters used when
 * presenting a workflow step to an agent. No IO, no module state.
 */

export function formatSchema(schema: Record<string, unknown>, indent = 0): string {
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
    if (type === 'object' && (def.properties || def.fields)) {
      lines.push(formatSchema(def as Record<string, unknown>, indent + 1))
    }
  }
  return lines.join('\n')
}

export function formatStepContext(step: Record<string, unknown>): string {
  if (step.status === 'pending_approval') {
    const sections: string[] = []
    sections.push(`STEP: ${step.stepId ?? '(gate)'}`)
    sections.push('STATUS: pending_approval')
    if (step.label) sections.push(`LABEL: ${step.label}`)
    sections.push('')
    sections.push('WAITING FOR HUMAN APPROVAL')
    sections.push('No agent action is required until this gate is approved or rejected.')
    sections.push('Use bakin_exec_check_gates for the current approval status.')
    return sections.join('\n')
  }

  if (step.status === 'complete') {
    return [
      'STATUS: complete',
      'WORKFLOW COMPLETE',
      'No further workflow step is active for this task.',
    ].join('\n')
  }

  const sections: string[] = []
  sections.push(`STEP: ${step.stepId}`)
  sections.push(`STATUS: ${step.status}`)
  if (step.label) sections.push(`LABEL: ${step.label}`)
  if (step.agent) sections.push(`AGENT: ${step.agent}`)

  if (step.instructions) {
    sections.push('')
    sections.push('INSTRUCTIONS:')
    sections.push(step.instructions as string)
  }

  if (step.priorStepOutput) {
    sections.push('')
    sections.push('PRIOR STEP OUTPUT:')
    sections.push(typeof step.priorStepOutput === 'string' ? step.priorStepOutput : JSON.stringify(step.priorStepOutput, null, 2))
  } else if (!step.stepOutputs || Object.keys(step.stepOutputs as Record<string, unknown>).length === 0) {
    sections.push('')
    sections.push('PRIOR STEP OUTPUT:')
    sections.push('(none — this is the first step)')
  }

  const stepOutputs = step.stepOutputs as Record<string, unknown> | undefined
  if (stepOutputs && Object.keys(stepOutputs).length > 0) {
    sections.push('')
    sections.push('ALL PRIOR STEP OUTPUTS:')
    for (const [stepId, output] of Object.entries(stepOutputs)) {
      sections.push(`  [${stepId}]:`)
      sections.push('  ' + JSON.stringify(output, null, 2).replace(/\n/g, '\n  '))
    }
  }

  if (step.output_schema) {
    sections.push('')
    sections.push('REQUIRED OUTPUT SCHEMA:')
    sections.push(formatSchema(step.output_schema as Record<string, unknown>))
  }

  if (step.rejectionReason) {
    sections.push('')
    sections.push('REJECTION CONTEXT:')
    sections.push(step.rejectionReason as string)
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
