/**
 * `bakin brands {list,get,import,check,export,remove}` — brand records (#419).
 *
 * Thin HTTP client over the brands plugin routes. `check <id>` takes an
 * INSTALLED brand id (drift-check operates on provenance, not a source).
 * Import/remove are consent-gated (`--yes` for non-interactive).
 */
import { apiGet, apiPost, apiDelete } from '../http'
import { exitUnknownSubcommand, confirmPrompt } from '../help'

interface BrandSummary {
  id: string
  name: string
  description?: string
  draft?: boolean
  palette: Array<{ name: string; hex: string }>
  source?: { repo: string; commit?: string }
}

async function cmdList(): Promise<void> {
  const body = await apiGet('/api/plugins/brands/') as { brands: BrandSummary[]; invalid: Array<{ id: string; error: string }> }
  if (body.brands.length === 0 && body.invalid.length === 0) {
    console.log('No brands yet. Create one in the dashboard (/brands) or: bakin brands import <source>')
    return
  }
  for (const b of body.brands) {
    const bits = [b.id.padEnd(20), b.name]
    if (b.draft) bits.push('[draft]')
    if (b.source) bits.push(`(from ${b.source.repo})`)
    console.log(`  ${bits.join('  ')}`)
  }
  for (const inv of body.invalid) {
    console.log(`  ${inv.id.padEnd(20)} INVALID — ${inv.error}`)
  }
}

async function cmdGet(brandId: string): Promise<void> {
  const body = await apiGet(`/api/plugins/brands/${encodeURIComponent(brandId)}`) as {
    brand: BrandSummary & { rules?: string[]; assetGroups: Array<{ name: string; assetIds: string[] }> }
    guidelines: Array<{ name: string; description?: string }>
    lessons: Array<{ name: string }>
    fingerprint: string | null
  }
  const b = body.brand
  console.log(`${b.name} (${b.id})${b.draft ? ' [draft]' : ''}`)
  if (b.description) console.log(`  ${b.description}`)
  if (b.palette.length) console.log(`  palette: ${b.palette.map(c => `${c.name} ${c.hex}`).join(', ')}`)
  if (b.rules?.length) for (const r of b.rules) console.log(`  rule: ${r}`)
  for (const g of b.assetGroups) console.log(`  group ${g.name}: ${g.assetIds.length} asset(s)`)
  for (const d of body.guidelines) console.log(`  guideline: ${d.name}${d.description ? ` — ${d.description}` : ''}`)
  for (const l of body.lessons) console.log(`  lesson: ${l.name}`)
  if (b.source) console.log(`  source: ${b.source.repo}${b.source.commit ? ` @ ${b.source.commit.slice(0, 8)}` : ''}  (drift: bakin brands check ${b.id})`)
  if (body.fingerprint) console.log(`  fingerprint: ${body.fingerprint.slice(0, 24)}…`)
}

async function cmdImport(source: string, opts: { yes?: boolean }): Promise<void> {
  const preview = await apiPost('/api/plugins/brands/import/preview', { source }) as {
    preview: { id: string; name: string; rules: number; guidelines: number; lessons: number; assets: number; exists: boolean; commit?: string }
  }
  const p = preview.preview
  console.log(`${p.name} (${p.id}) — ${p.rules} rule(s), ${p.guidelines} guideline doc(s), ${p.lessons} lesson(s), ${p.assets} asset file(s)${p.commit ? ` @ ${p.commit.slice(0, 8)}` : ''}`)
  if (p.exists) console.log(`NOTE: brand '${p.id}' already exists — importing REPLACES it (local edits are lost).`)
  if (!opts.yes) {
    const ok = await confirmPrompt(p.exists ? `Replace brand '${p.id}' with this import?` : `Import brand '${p.id}'?`)
    if (!ok) {
      console.error('Aborted (rerun with --yes for non-interactive import).')
      process.exitCode = 1
      return
    }
  }
  const result = await apiPost('/api/plugins/brands/import', { source, overwrite: p.exists }) as { brand: { id: string }; importedAssets: number; docs: number }
  console.log(`Imported brand '${result.brand.id}' — ${result.importedAssets} asset(s), ${result.docs} doc(s).`)
}

async function cmdCheck(brandId: string): Promise<void> {
  const body = await apiGet(`/api/plugins/brands/import/check?id=${encodeURIComponent(brandId)}`) as {
    installedCommit: string | null
    latestCommit: string
    drift: boolean
  }
  if (body.drift) {
    console.log(`Brand '${brandId}' is BEHIND upstream: installed ${body.installedCommit?.slice(0, 8) ?? '(unknown)'} vs latest ${body.latestCommit.slice(0, 8)}.`)
    console.log(`Update with: bakin brands import <same source> --yes`)
  } else {
    console.log(`Brand '${brandId}' matches upstream (${body.latestCommit.slice(0, 8)}).`)
  }
}

async function cmdExport(brandId: string, destDir: string): Promise<void> {
  const body = await apiPost(`/api/plugins/brands/${encodeURIComponent(brandId)}/export`, { destDir }) as { dir: string; files: string[] }
  console.log(`Exported brand '${brandId}' to ${body.dir} (${body.files.length} file(s)).`)
}

async function cmdRemove(brandId: string, opts: { yes?: boolean }): Promise<void> {
  // Deletion guard (S10): pending tasks linked to this brand will defer
  // until it exists again — say so BEFORE the destructive confirm.
  let linkedCount = 0
  try {
    const board = await apiGet('/api/plugins/tasks/') as { columns?: Record<string, Array<{ brandId?: string; checked?: boolean }>> }
    for (const [column, tasks] of Object.entries(board.columns ?? {})) {
      if (column === 'done' || column === 'archived') continue
      linkedCount += tasks.filter((t) => t.brandId === brandId).length
    }
  } catch {
    // Guard is best-effort — the confirm below is the hard gate.
  }
  if (linkedCount > 0) {
    console.log(`WARNING: ${linkedCount} pending task(s) reference brand '${brandId}' — they will not dispatch until the brand exists again.`)
  }
  if (!opts.yes) {
    const ok = await confirmPrompt(`Delete brand '${brandId}'? This removes its guidelines and lessons (assets stay in the asset store).`)
    if (!ok) {
      console.error('Aborted (rerun with --yes for non-interactive removal).')
      process.exitCode = 1
      return
    }
  }
  await apiDelete(`/api/plugins/brands/${encodeURIComponent(brandId)}`)
  console.log(`Deleted brand '${brandId}'.`)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  const rest = args.slice(2)
  const positional = rest.filter((a) => !a.startsWith('--'))
  const yes = rest.includes('--yes')

  if (sub === 'list' || sub === undefined) {
    await cmdList()
  } else if (sub === 'get' && positional[0]) {
    await cmdGet(positional[0])
  } else if (sub === 'import' && positional[0]) {
    await cmdImport(positional[0], { yes })
  } else if (sub === 'check' && positional[0]) {
    await cmdCheck(positional[0])
  } else if (sub === 'export' && positional[0] && positional[1]) {
    await cmdExport(positional[0], positional[1])
  } else if (sub === 'remove' && positional[0]) {
    await cmdRemove(positional[0], { yes })
  } else {
    await exitUnknownSubcommand('brands', sub, ['list', 'get <id>', 'import <source>', 'check <id>', 'export <id> <dir>', 'remove <id>'])
  }
}
