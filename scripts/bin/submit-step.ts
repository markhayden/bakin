#!/usr/bin/env npx tsx
/**
 * CLI wrapper for beacon_exec_submit_step.
 * For debugging — agents use the MCP tool directly.
 *
 * Usage:
 *   npx tsx scripts/bin/submit-step.ts --taskId abc123 --stepId write-copy --output '{"caption":"hello"}'
 */
import { parseArgs } from 'util'
import { submitStepValidated } from '../lib/submit-step'

const { values } = parseArgs({
  options: {
    taskId: { type: 'string' },
    stepId: { type: 'string' },
    output: { type: 'string' },  // JSON string
    help:   { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || !values.taskId || !values.stepId || !values.output) {
  console.log(`Usage: npx tsx scripts/bin/submit-step.ts --taskId <id> --stepId <id> --output '<json>'`)
  process.exit(values.help ? 0 : 1)
}

let output: Record<string, unknown>
try {
  output = JSON.parse(values.output)
} catch {
  console.error('Error: --output must be valid JSON')
  process.exit(1)
}

async function main() {
  const result = await submitStepValidated(values.taskId!, values.stepId!, output, 'cli')

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
main()
