/**
 * `bakin assets {scan,import,enrich}` — unmanaged-file scan, explicit import,
 * and vision-enrichment backfill. Relocated verbatim from cli/bakin.ts
 * (B5.3 command-module split).
 */
import { apiGet, apiPost } from '../http'
import { exitUnknownSubcommand } from '../help'

/** `bakin assets scan` — list unmanaged files awaiting explicit import. */
async function cmdAssetsScan(): Promise<void> {
  const body = await apiGet('/api/plugins/assets/import/scan') as { files: Array<{ relPath: string; size: number; suggestedType: string }>; count: number }
  if (body.count === 0) {
    console.log('No unmanaged files — everything under assets/ is managed.')
    return
  }
  console.log(`${body.count} unmanaged file(s) awaiting import:`)
  for (const f of body.files) {
    console.log(`  ${f.relPath}  (${f.suggestedType}, ${f.size} bytes)`)
  }
  console.log('\nImport with: bakin assets import <path> [--type t]  |  bakin assets import --all')
}

/** `bakin assets enrich [--all|<assetId>] [--force]` — vision enrichment backfill (D8, billed). */
async function cmdAssetsEnrich(options: { all?: boolean; assetId?: string; force?: boolean }): Promise<void> {
  if (!options.all && !options.assetId) {
    console.error('Usage: bakin assets enrich <assetId> [--force]  |  bakin assets enrich --all [--force]')
    process.exitCode = 1
    return
  }
  const body = options.all ? { all: true, force: options.force ?? false } : { assetId: options.assetId, force: options.force ?? false }
  const result = await apiPost('/api/plugins/assets/enrich', body) as {
    enqueued: number
    engine?: 'direct' | 'runtime'
    agent?: string
    estimatedSecondsPerAsset?: number
  }
  if (result.engine === 'runtime') {
    // Quota notice (spec §5): agent turns spend the runtime subscription —
    // never silently. The batch is already queued; abort stops the rest.
    const perAsset = result.estimatedSecondsPerAsset ?? 35
    console.log(`NOTICE: ${result.enqueued} asset(s) will be enriched via agent turns on '${result.agent ?? 'enrich'}' — no direct API key is configured, so this uses your subscription quota and takes ~${perAsset}s per asset (ctrl-c the server or 'bakin restart' to abort; add an API key for the fast path).`)
  } else {
    console.log(`Enqueued ${result.enqueued} asset(s) for vision enrichment (runs in the background; billed per asset version).`)
  }
  console.log('Track progress: bakin doctor  (assets enrichment rows)')
}

/** `bakin assets import [--all|<path>] [--type t]` — explicit import (D7). */
async function cmdAssetsImport(options: { all?: boolean; path?: string; type?: string }): Promise<void> {
  if (!options.all && !options.path) {
    console.error('Usage: bakin assets import <path> [--type t]  |  bakin assets import --all [--type t]')
    process.exitCode = 1
    return
  }
  const payload: Record<string, unknown> = options.all
    ? { all: true }
    : { paths: [options.path] }
  if (options.type) payload.type = options.type
  const body = await apiPost('/api/plugins/assets/import', payload) as { ok: boolean; imported: number; failed: number; results: Array<{ ok: boolean; relPath: string; assetId?: string; error?: string }> }
  for (const r of body.results) {
    console.log(r.ok ? `  imported ${r.relPath} → ${r.assetId}` : `  FAILED ${r.relPath}: ${r.error}`)
  }
  console.log(`${body.imported} imported, ${body.failed} failed.`)
  if (!body.ok) process.exitCode = 1
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'import') {
    const importOpts: { all?: boolean; path?: string; type?: string } = {}
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--all') importOpts.all = true
      else if (args[i].startsWith('--type=')) importOpts.type = args[i].split('=')[1]
      else if (args[i] === '--type' && args[i + 1]) importOpts.type = args[++i]
      else if (!args[i].startsWith('--')) importOpts.path = args[i]
    }
    await cmdAssetsImport(importOpts)
  } else if (sub === 'scan') {
    await cmdAssetsScan()
  } else if (sub === 'enrich') {
    const enrichOpts: { all?: boolean; assetId?: string; force?: boolean } = {}
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--all') enrichOpts.all = true
      else if (args[i] === '--force') enrichOpts.force = true
      else if (!args[i].startsWith('--')) enrichOpts.assetId = args[i]
    }
    await cmdAssetsEnrich(enrichOpts)
  } else {
    await exitUnknownSubcommand('assets', sub, ['scan', 'import', 'enrich'])
  }
}
