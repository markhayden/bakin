#!/usr/bin/env npx tsx
/**
 * CLI wrapper for beacon_exec_get_step.
 * For debugging — agents use the MCP tool directly.
 *
 * Usage:
 *   npx tsx scripts/bin/get-step.ts --taskId abc123
 */
import { parseArgs } from 'util'
import { getStepFormatted } from '../lib/get-step'

console.error('⚠  WARNING: This CLI script bypasses Beacon tracking (no MCP call, no Health metrics, no audit log).')
console.error('   Agents should use: mcporter call beacon-<agent>.beacon_exec_get_step ...')
console.error('')

const { values } = parseArgs({
  options: {
    taskId: { type: 'string' },
    help:   { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || !values.taskId) {
  console.log(`Usage: npx tsx scripts/bin/get-step.ts --taskId <id>`)
  process.exit(values.help ? 0 : 1)
}

async function main() {
  const result = await getStepFormatted(values.taskId!, 'cli')

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
main()
