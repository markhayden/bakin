#!/usr/bin/env npx tsx
/**
 * CLI wrapper for the one-shot assets layout migration.
 *
 * Usage:
 *   npx tsx scripts/bin/migrate-assets-to-store-layout.ts --dry-run
 *   npx tsx scripts/bin/migrate-assets-to-store-layout.ts --apply
 *
 * Pre-flight:
 *   1. Stop Bakin (`bakin stop` or kill the server process).
 *   2. Back up ~/.bakin/assets — `cp -a` the whole tree somewhere safe.
 *   3. Run `--dry-run` first and review the output.
 *
 * The script is deleted in C8 once the one-shot live migration has landed.
 */
import { parseArgs } from 'util'
import { join } from 'path'
import { homedir } from 'os'
import { migrateToStoreLayout, type MigrationLogger } from '../lib/migrate-to-store-layout'

const { values } = parseArgs({
  options: {
    'dry-run':    { type: 'boolean' },
    apply:        { type: 'boolean' },
    'assets-root': { type: 'string' },
    help:         { type: 'boolean', short: 'h' },
  },
  strict: true,
})

if (values.help || (!values['dry-run'] && !values.apply)) {
  console.log(`Migrate ~/.bakin/assets/{type}/{taskId}/ → ~/.bakin/assets/store/{YYYY-MM}/

Usage:
  npx tsx scripts/bin/migrate-assets-to-store-layout.ts --dry-run
  npx tsx scripts/bin/migrate-assets-to-store-layout.ts --apply [--assets-root <path>]

Exactly one of --dry-run or --apply is required.
`)
  process.exit(values.help ? 0 : 1)
}

if (values['dry-run'] && values.apply) {
  console.error('Pass either --dry-run or --apply, not both.')
  process.exit(1)
}

const assetsRoot = values['assets-root'] ?? join(homedir(), '.bakin', 'assets')
const dryRun = !!values['dry-run']

console.log(`${dryRun ? '[dry-run]' : '[apply]'} migrating ${assetsRoot}`)

const log: MigrationLogger = (level, msg, ctx) => {
  const line = ctx ? `${msg} ${JSON.stringify(ctx)}` : msg
  if (level === 'error') console.error('error:', line)
  else if (level === 'warn') console.warn('warn: ', line)
  else console.log(line)
}

const result = migrateToStoreLayout({ assetsRoot, dryRun, log })

console.log('')
console.log('=== Migration summary ===')
console.log(`  Scanned legacy records: ${result.scanned}`)
console.log(`  Moved:                  ${result.moved}`)
console.log(`  Renamed to canonical:   ${result.renamed}`)
console.log(`  Sidecars updated:       ${result.sidecarUpdated}`)
console.log(`  Sidecars created:       ${result.sidecarCreated}`)
console.log(`  Trash items moved:      ${result.trashMoved}`)
console.log(`  Empty dirs removed:     ${result.emptyDirsRemoved}`)
console.log(`  Orphan assets:          ${result.orphanAssets.length}`)
console.log(`  Orphan sidecars:        ${result.orphanSidecars.length}`)
console.log(`  Errors:                 ${result.errors.length}`)

if (result.orphanAssets.length > 0) {
  console.log('')
  console.log('Orphan assets (no sidecar — migrated with synthesized metadata):')
  for (const p of result.orphanAssets) console.log(`  ${p}`)
}
if (result.orphanSidecars.length > 0) {
  console.log('')
  console.log('Orphan sidecars (no matching asset — left in place):')
  for (const p of result.orphanSidecars) console.log(`  ${p}`)
}
if (result.errors.length > 0) {
  console.log('')
  console.log('Errors:')
  for (const e of result.errors) console.log(`  ${e.path}: ${e.error}`)
  process.exit(1)
}

if (dryRun) {
  console.log('')
  console.log('Dry run complete — re-run with --apply to commit changes.')
}
