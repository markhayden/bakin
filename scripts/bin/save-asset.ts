#!/usr/bin/env npx tsx
/**
 * CLI wrapper for beacon_exec_save_asset.
 * For debugging — agents use the MCP tool directly.
 *
 * Usage:
 *   npx tsx scripts/bin/save-asset.ts --filePath ./photo.png --taskId abc123 --type images
 */
import { parseArgs } from 'util'
import { saveAsset } from '../lib/save-asset'

console.error('⚠  WARNING: This CLI script bypasses Beacon tracking (no MCP call, no Health metrics, no audit log).')
console.error('   Agents should use: mcporter call beacon-<agent>.beacon_exec_save_asset ...')
console.error('')

const { values } = parseArgs({
  options: {
    filePath:    { type: 'string' },
    taskId:      { type: 'string' },
    type:        { type: 'string' },
    description: { type: 'string' },
    slug:        { type: 'string' },
    tool:        { type: 'string' },
    tags:        { type: 'string' },  // comma-separated
    help:        { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || !values.filePath || !values.taskId || !values.type) {
  console.log(`Usage: npx tsx scripts/bin/save-asset.ts --filePath <path> --taskId <id> --type <text|images|video|audio|plans|data|other> [--description "..."] [--slug "..."] [--tool "..."] [--tags "a,b,c"]`)
  process.exit(values.help ? 0 : 1)
}

async function main() {
  const result = await saveAsset({
    filePath: values.filePath!,
    taskId: values.taskId!,
    type: values.type as 'text' | 'images' | 'video' | 'audio' | 'plans' | 'data' | 'other',
    description: values.description,
    slug: values.slug,
    tool: values.tool,
    tags: values.tags?.split(',').map(t => t.trim()),
    agent: 'cli',
  })

  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}
main()
