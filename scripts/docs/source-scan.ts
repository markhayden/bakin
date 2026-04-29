import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const repoRoot = new URL('../..', import.meta.url).pathname
const repoSourceRoots = [
  join(repoRoot, 'plugins'),
  join(repoRoot, 'src'),
  join(repoRoot, 'packages'),
  join(repoRoot, 'scripts/lib'),
]

/**
 * Plugins that ship outside this repo. We still document them on the public
 * docs site, so source-scan walks their checkouts when introspecting tool /
 * hook registrations.
 *
 * Resolution order, highest priority first:
 *   1. `BAKIN_DOCS_EXTERNAL_SOURCES` env var (comma-separated absolute paths).
 *   2. `../bakin-bits-official/plugins/<id>` next to the bakin checkout.
 *
 * Each entry maps an extracted plugin id to a list of search paths. The first
 * existing path wins. Used by `check.ts` to render an actionable error when an
 * extracted plugin can't be found and the snippet has no source to render
 * from.
 */
/**
 * Maps the docs:exec-tools marker (the slug between `bakin_exec_` and the
 * action) to the plugin directory in the sibling repo. Only mismatched today
 * is `project` (marker, singular) vs `projects` (sibling-repo dir, plural).
 */
export const EXTRACTED_PLUGINS: Record<string, string> = {
  messaging: 'messaging',
  project: 'projects',
}

function envExternalRoots(): string[] {
  const raw = process.env.BAKIN_DOCS_EXTERNAL_SOURCES
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(p => resolve(p))
}

function siblingExternalRoot(): string | undefined {
  const candidate = resolve(repoRoot, '..', 'bakin-bits-official', 'plugins')
  return existsSync(candidate) ? candidate : undefined
}

export function externalSourceRoots(): string[] {
  const env = envExternalRoots()
  if (env.length > 0) return env
  const sibling = siblingExternalRoot()
  return sibling ? [sibling] : []
}

export function locateExtractedPlugin(marker: string): string | undefined {
  const dirName = EXTRACTED_PLUGINS[marker]
  if (!dirName) return undefined
  for (const root of externalSourceRoots()) {
    const direct = join(root, dirName)
    if (existsSync(join(direct, 'index.ts'))) return direct
    // env var may already point at the plugin dir, not the plugins parent.
    if (root.endsWith(`/${dirName}`) && existsSync(join(root, 'index.ts'))) return root
  }
  return undefined
}

function walkFiles(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.astro') continue
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) walkFiles(path, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path)
  }
  return files
}

export function sourceFiles(): string[] {
  const repoFiles = repoSourceRoots.flatMap(root => walkFiles(root))
  const externalFiles = externalSourceRoots()
    .filter(root => existsSync(root))
    .flatMap(root => walkFiles(root))
  return [...repoFiles, ...externalFiles]
}

export function relativeSource(path: string): string {
  if (path.startsWith(repoRoot)) {
    return path.replace(repoRoot, '').replace(/^\//, '')
  }
  for (const root of externalSourceRoots()) {
    // Walk up one to keep the repo name as a prefix (`bakin-bits-official/...`)
    // so paths in the generated catalog stay unambiguous when extracted plugins
    // live in a sibling repo.
    const repoParent = resolve(root, '..', '..')
    if (path.startsWith(repoParent)) {
      return path.replace(repoParent, '').replace(/^\//, '')
    }
  }
  return path
}

export interface ExecTool {
  name: string
  description?: string
  file: string
  line: number
}

export function extractExecTools(): ExecTool[] {
  const tools: ExecTool[] = []
  const seen = new Set<string>()
  for (const file of sourceFiles()) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const nameMatch = lines[i].match(/name:\s*['"`](bakin_exec_[^'"`]+)['"`]/)
      if (!nameMatch) continue
      const name = nameMatch[1]
      const key = `${name}:${file}`
      if (seen.has(key)) continue
      seen.add(key)
      const block = lines.slice(i, Math.min(lines.length, i + 35)).join('\n')
      const descMatch = block.match(/description:\s*(["'`])((?:\\.|(?!\1).)*)\1/s)
      const description = descMatch?.[2]?.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`')
      tools.push({ name, description, file: relativeSource(file), line: i + 1 })
    }
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file))
}

export function renderExecToolsSnippet(marker: string): string {
  const tools = extractExecTools().filter(t => t.name.startsWith(`bakin_exec_${marker}_`))
  if (!tools.length) return ''
  const lines = [`<!-- docs:exec-tools ${marker} -->`]
  for (const tool of tools) {
    const desc = tool.description?.trim()
    lines.push(`- \`${tool.name}\`${desc ? `: ${desc}` : ''}`)
  }
  lines.push('<!-- /docs:exec-tools -->')
  return lines.join('\n')
}
