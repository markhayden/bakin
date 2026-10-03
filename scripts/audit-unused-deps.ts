/**
 * Unused-dependency audit.
 *
 * Walks the repo (skipping node_modules, dist, build output) and counts, for
 * every entry in the root package.json dependencies + devDependencies:
 *   - codeHits   — source/config files that import or reference the package
 *   - scriptHits — package.json scripts that invoke one of the package's bins
 *   - proseHits  — markdown mentions (reported, never counted as usage)
 *
 * A dependency with zero code and zero script hits is a deletion candidate.
 * `@types/<x>` follows its base package; `@types/bun` is a runtime global.
 *
 * Usage:
 *   bun scripts/audit-unused-deps.ts            # table + candidates, exit 0
 *   bun scripts/audit-unused-deps.ts --check    # exit 1 if any candidate exists
 *
 * Runbook: .claude/knowledge/dependency-sweeps.md
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface DependencyUsage {
  name: string
  codeHits: number
  scriptHits: number
  proseHits: number
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx', '.css', '.html', '.yml', '.yaml', '.json', '.astro', '.mdx'])
const PROSE_EXTENSIONS = new Set(['.md'])
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'storybook-static', '.astro'])
/** Typings for globals the runtime provides — no import ever names them. */
const RUNTIME_GLOBAL_TYPES = new Set(['@types/bun', '@types/node'])

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else out.push(full)
  }
}

function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot === -1 ? '' : file.slice(dot)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** Matches `'pkg'` or `'pkg/sub/path'` inside any quote style. */
function referencePattern(name: string): RegExp {
  return new RegExp(`['"\`]${escapeRegExp(name)}(/[^'"\`]*)?['"\`]`)
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

interface PackageManifest {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  bin?: string | Record<string, string>
}

function binNames(root: string, name: string): string[] {
  const manifestPath = join(root, 'node_modules', name, 'package.json')
  if (!existsSync(manifestPath)) return []
  const bin = readJson<PackageManifest>(manifestPath).bin
  if (!bin) return []
  if (typeof bin === 'string') return [name.includes('/') ? name.slice(name.indexOf('/') + 1) : name]
  return Object.keys(bin)
}

export function auditDependencyUsage(root: string): DependencyUsage[] {
  const pkg = readJson<PackageManifest>(join(root, 'package.json'))
  const names = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
  const scripts = Object.values(pkg.scripts ?? {})

  const files: string[] = []
  walk(root, files)
  const rootManifest = join(root, 'package.json')
  const contents = files
    .filter((f) => f !== rootManifest && !f.endsWith('/package.json') && !f.endsWith('bun.lock'))
    .map((f) => ({ ext: extensionOf(f), text: readFileSync(f, 'utf-8') }))

  return names.map((name) => {
    const re = referencePattern(name)
    let codeHits = 0
    let proseHits = 0
    for (const { ext, text } of contents) {
      if (!re.test(text)) continue
      if (CODE_EXTENSIONS.has(ext)) codeHits += 1
      else if (PROSE_EXTENSIONS.has(ext)) proseHits += 1
    }
    const bins = binNames(root, name)
    const scriptHits = bins.length === 0
      ? 0
      : scripts.filter((s) => bins.some((b) => new RegExp(`(^|[\\s&|;])${escapeRegExp(b)}(\\s|$)`).test(s))).length
    return { name, codeHits, scriptHits, proseHits }
  })
}

/** Packages nothing imports or invokes. `@types/x` follows `x`. */
export function unusedDependencies(rows: DependencyUsage[]): string[] {
  const byName = new Map(rows.map((r) => [r.name, r]))
  const isUsed = (row: DependencyUsage): boolean => row.codeHits > 0 || row.scriptHits > 0
  return rows
    .filter((row) => {
      if (RUNTIME_GLOBAL_TYPES.has(row.name)) return false
      if (row.name.startsWith('@types/')) {
        const base = row.name.slice('@types/'.length).replace('__', '/')
        const baseName = base.includes('/') ? `@${base}` : base
        const baseRow = byName.get(baseName)
        // Typings for a package we don't declare are judged on their own hits.
        return baseRow ? !isUsed(baseRow) && !isUsed(row) : !isUsed(row)
      }
      return !isUsed(row)
    })
    .map((row) => row.name)
}

function main(): void {
  const root = process.cwd()
  const check = process.argv.includes('--check')
  const rows = auditDependencyUsage(root).sort((a, b) => a.codeHits + a.scriptHits - (b.codeHits + b.scriptHits))
  console.log(`code  script prose  package   (${relative(root, join(root, 'package.json'))})`)
  for (const r of rows) {
    console.log(`${String(r.codeHits).padStart(4)}  ${String(r.scriptHits).padStart(6)} ${String(r.proseHits).padStart(5)}  ${r.name}`)
  }
  const unused = unusedDependencies(rows)
  console.log(unused.length === 0 ? '\nNo deletion candidates.' : `\nDeletion candidates (${unused.length}): ${unused.join(', ')}`)
  if (check && unused.length > 0) process.exit(1)
}

if (import.meta.main) main()
