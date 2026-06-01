#!/usr/bin/env npx tsx
/**
 * CLI wrapper for bakin_exec_post_channel.
 * For debugging - agents use the MCP tool directly.
 *
 * Usage:
 *   npx tsx scripts/bin/post-channel.ts --channel general --content "Hello world"
 *   npx tsx scripts/bin/post-channel.ts --channel content --content "New post!" --imageAssetId 20260401-hero-a1b2c3d4
 */
import { parseArgs } from 'util'
import { postChannel } from '../lib/post-channel'

console.error('⚠  WARNING: This CLI script bypasses Bakin tracking (no MCP call, no Health metrics, no audit log).')
console.error('   Agents should use: mcporter call bakin-<agent>.bakin_exec_post_channel ...')
console.error('')

const { values } = parseArgs({
  options: {
    channel:      { type: 'string' },
    content:      { type: 'string' },
    imageAssetId: { type: 'string' },
    videoAssetId: { type: 'string' },
    taskId:       { type: 'string' },
    help:         { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || !values.channel || !values.content) {
  console.log(`Usage: npx tsx scripts/bin/post-channel.ts --channel <name> --content "..." [--imageAssetId <id>] [--videoAssetId <id>] [--taskId <id>]`)
  process.exit(values.help ? 0 : 1)
}

async function main() {
  const result = await postChannel({
    channel: values.channel!,
    content: values.content!,
    imageAssetId: values.imageAssetId,
    videoAssetId: values.videoAssetId,
    taskId: values.taskId,
    agent: 'cli',
  })

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
main()
