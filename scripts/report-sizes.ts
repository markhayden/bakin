/**
 * Size report for built artifacts and the server bundle graph.
 *
 * Two sections:
 *
 * 1. Artifact sizes — vendor and SDK bundles, plugin client bundles, CSS,
 *    the host shell, and compiled binaries, measured from what's on disk.
 *    Sections whose artifacts aren't built are skipped with a hint.
 * 2. Server-graph breakdown — bundles server.ts (non-compile, target bun)
 *    with `--metafile` into a throwaway dir and attributes input bytes to
 *    top-level node_modules packages (app code grouped by top-level dir).
 *    This is what answers "which dependency is actually in the binary, and
 *    how big is it" — see .claude/knowledge/binary-size.md.
 *
 * Usage: bun run size:report
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { collectUiPerformanceSnapshot, printUiPerformance } from './ui/performance'

const REPO_ROOT = resolve(import.meta.dir, '..')

export interface MetafileInput {
  bytes: number
}

export interface SizeRow {
  name: string
  bytes: number
}

export interface ArtifactSection {
  files: SizeRow[]
  total: number
}

export interface ArtifactReport {
  vendor: ArtifactSection
  sdk: ArtifactSection
  plugins: ArtifactSection
  css: ArtifactSection
  hostShell: ArtifactSection
  binaries: ArtifactSection
}

/**
 * Attribute metafile input bytes to packages. Paths under node_modules are
 * keyed by package name (the segment after the LAST `node_modules/`, two
 * segments for @scoped packages — this handles Bun's
 * `node_modules/.bun/<pkg>@<ver>/node_modules/<pkg>/...` store layout).
 * App code is grouped by top-level directory as `(app) <dir>`.
 */
export function aggregateMetafileInputs(inputs: Record<string, MetafileInput>): SizeRow[] {
  const totals = new Map<string, number>()
  for (const [path, info] of Object.entries(inputs)) {
    let name: string
    const idx = path.lastIndexOf('node_modules/')
    if (idx !== -1) {
      const rel = path.slice(idx + 'node_modules/'.length)
      const segments = rel.split('/')
      name = segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0]
    } else {
      const top = path.split('/')[0]
      name = `(app) ${top}`
    }
    totals.set(name, (totals.get(name) ?? 0) + info.bytes)
  }
  return [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes }))
    .sort((a, b) => b.bytes - a.bytes)
}

function scanDir(dir: string, filter: (name: string) => boolean): ArtifactSection {
  if (!existsSync(dir)) return { files: [], total: 0 }
  const files: SizeRow[] = []
  for (const name of readdirSync(dir)) {
    if (!filter(name)) continue
    const stat = statSync(join(dir, name), { throwIfNoEntry: false })
    if (!stat?.isFile()) continue
    files.push({ name, bytes: stat.size })
  }
  files.sort((a, b) => b.bytes - a.bytes)
  return { files, total: files.reduce((sum, f) => sum + f.bytes, 0) }
}

/** Measure built artifacts under the repo root. Pure scan, no builds. */
export function collectArtifactSizes(rootDir: string): ArtifactReport {
  const vendorDir = join(rootDir, 'packages/host/public/vendor')
  const vendor = scanDir(vendorDir, (n) => n.endsWith('.js'))
  const sdk = scanDir(vendorDir, (n) => n.startsWith('sdk-') && n.endsWith('.js'))

  const pluginFiles: SizeRow[] = []
  const cssFiles: SizeRow[] = []
  const hostCss = join(rootDir, 'packages/host/public/globals.css')
  if (existsSync(hostCss)) cssFiles.push({ name: 'host/globals.css', bytes: statSync(hostCss).size })
  const pluginsDir = join(rootDir, 'plugins')
  if (existsSync(pluginsDir)) {
    for (const id of readdirSync(pluginsDir)) {
      for (const file of ['client.js', 'client.css']) {
        const path = join(pluginsDir, id, 'dist', file)
        if (!existsSync(path)) continue
        const row = { name: `${id}/${file}`, bytes: statSync(path).size }
        pluginFiles.push(row)
        if (file.endsWith('.css')) cssFiles.push(row)
      }
    }
  }
  pluginFiles.sort((a, b) => b.bytes - a.bytes)
  cssFiles.sort((a, b) => b.bytes - a.bytes)

  const hostShell = scanDir(join(rootDir, 'packages/host/dist'), (n) => n.endsWith('.js'))
  const binaries = scanDir(join(rootDir, 'dist'), (n) => n.startsWith('bakin-'))

  return {
    vendor,
    sdk,
    plugins: { files: pluginFiles, total: pluginFiles.reduce((s, f) => s + f.bytes, 0) },
    css: { files: cssFiles, total: cssFiles.reduce((s, f) => s + f.bytes, 0) },
    hostShell,
    binaries,
  }
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function printSection(title: string, section: ArtifactSection, hint: string): void {
  console.log(`\n## ${title}`)
  if (section.files.length === 0) {
    console.log(`  (not built — ${hint})`)
    return
  }
  for (const f of section.files) console.log(`  ${humanSize(f.bytes).padStart(10)}  ${f.name}`)
  console.log(`  ${humanSize(section.total).padStart(10)}  TOTAL`)
}

async function reportServerGraph(): Promise<void> {
  console.log('\n## Server bundle graph (bun build server.ts --target=bun)')
  const outDir = mkdtempSync(join(tmpdir(), 'bakin-size-report-'))
  try {
    const metafile = join(outDir, 'meta.json')
    const proc = Bun.spawn(
      ['bun', 'build', 'server.ts', '--target=bun', '--outdir', outDir, `--metafile=${metafile}`],
      { cwd: REPO_ROOT, stdout: 'ignore', stderr: 'pipe' },
    )
    if ((await proc.exited) !== 0) {
      console.error(await new Response(proc.stderr).text())
      throw new Error('server.ts analysis bundle failed')
    }
    const meta = JSON.parse(readFileSync(metafile, 'utf-8')) as {
      inputs?: Record<string, MetafileInput>
    }
    if (!meta.inputs) throw new Error('metafile missing "inputs" — did the bun --metafile format change?')
    const rows = aggregateMetafileInputs(meta.inputs)
    const total = rows.reduce((sum, r) => sum + r.bytes, 0)
    for (const row of rows) {
      if (row.bytes < 10 * 1024) continue // noise floor; totals still include it
      console.log(`  ${humanSize(row.bytes).padStart(10)}  ${row.name}`)
    }
    console.log(`  ${humanSize(total).padStart(10)}  TOTAL source bytes (${rows.length} packages/groups)`)
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const report = collectArtifactSizes(REPO_ROOT)
  printSection('Vendor bundles (packages/host/public/vendor)', report.vendor, 'run: bun run build:vendors')
  printSection('SDK browser bundles (packages/host/public/vendor/sdk-*)', report.sdk, 'run: bun run build:vendors')
  printSection('Plugin client bundles (plugins/*/dist)', report.plugins, 'run: bun run build:plugins')
  printSection('Browser CSS (host and plugins)', report.css, 'run: bun run build:css && bun run build:plugins')
  printSection('Host shell (packages/host/dist)', report.hostShell, 'run: bun run build:host-shell')
  printSection('Compiled binaries (dist/)', report.binaries, 'run: bun run build:binary')
  printUiPerformance(await collectUiPerformanceSnapshot(REPO_ROOT))
  await reportServerGraph()
}

if (import.meta.main) {
  await main()
}
