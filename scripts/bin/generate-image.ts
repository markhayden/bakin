#!/usr/bin/env npx tsx
/**
 * CLI wrapper for beacon_exec_gen_image.
 * For debugging — agents use the MCP tool directly.
 *
 * Usage:
 *   npx tsx scripts/bin/generate-image.ts --prompt "Golden hour smoothie" --taskId abc123
 *   npx tsx scripts/bin/generate-image.ts --prompt "..." --taskId abc123 --preset social-square
 *   npx tsx scripts/bin/generate-image.ts --prompt "..." --taskId abc123 --model pro
 */
import { parseArgs } from 'util'
import { generateImage } from '../lib/generate-image'

console.error('⚠  WARNING: This CLI script bypasses Beacon tracking (no MCP call, no Health metrics, no audit log).')
console.error('   Agents should use: mcporter call beacon-<agent>.beacon_exec_gen_image ...')
console.error('')

const { values } = parseArgs({
  options: {
    prompt:  { type: 'string' },
    taskId:  { type: 'string' },
    preset:  { type: 'string' },
    width:   { type: 'string' },
    height:  { type: 'string' },
    model:   { type: 'string' },
    noThumb: { type: 'boolean' },
    help:    { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || !values.prompt || !values.taskId) {
  console.log(`Usage: npx tsx scripts/bin/generate-image.ts --prompt "..." --taskId <id> [--preset social-portrait|social-square|social-landscape|custom] [--width N] [--height N] [--model flash|pro] [--noThumb]`)
  process.exit(values.help ? 0 : 1)
}

async function main() {
  const result = await generateImage({
    prompt: values.prompt!,
    taskId: values.taskId!,
    preset: (values.preset || 'social-portrait') as 'social-portrait' | 'social-square' | 'social-landscape' | 'custom',
    width: values.width ? parseInt(values.width, 10) : undefined,
    height: values.height ? parseInt(values.height, 10) : undefined,
    model: (values.model || 'flash') as 'flash' | 'pro',
    thumbnail: !values.noThumb,
    agent: 'cli',
  })

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
main()
