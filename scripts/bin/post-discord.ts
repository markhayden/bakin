#!/usr/bin/env npx tsx
/**
 * CLI wrapper for bakin_exec_post_discord.
 * For debugging — agents use the MCP tool directly.
 *
 * Usage:
 *   npx tsx scripts/bin/post-discord.ts --channel general --content "Hello world"
 *   npx tsx scripts/bin/post-discord.ts --channel content --content "New post!" --imagePath ./photo.png
 */
import { parseArgs } from 'util'
import { postDiscord } from '../lib/post-discord'

console.error('⚠  WARNING: This CLI script bypasses Bakin tracking (no MCP call, no Health metrics, no audit log).')
console.error('   Agents should use: mcporter call bakin-<agent>.bakin_exec_post_discord ...')
console.error('')

const { values } = parseArgs({
  options: {
    channel:   { type: 'string' },
    content:   { type: 'string' },
    imagePath: { type: 'string' },
    videoPath: { type: 'string' },
    taskId:    { type: 'string' },
    help:      { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || !values.channel || !values.content) {
  console.log(`Usage: npx tsx scripts/bin/post-discord.ts --channel <name> --content "..." [--imagePath <path>] [--videoPath <path>] [--taskId <id>]`)
  process.exit(values.help ? 0 : 1)
}

async function main() {
  const result = await postDiscord({
    channel: values.channel!,
    content: values.content!,
    imagePath: values.imagePath,
    videoPath: values.videoPath,
    taskId: values.taskId,
    agent: 'cli',
  })

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
main()
