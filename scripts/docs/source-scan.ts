import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const repoRoot = new URL('../..', import.meta.url).pathname
const sourceRoots = [
  join(repoRoot, 'plugins'),
  join(repoRoot, 'src'),
  join(repoRoot, 'packages'),
  join(repoRoot, 'scripts/lib'),
]

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
  return sourceRoots.flatMap(root => walkFiles(root))
}

export function relativeSource(path: string): string {
  return path.replace(repoRoot, '').replace(/^\//, '')
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
      const description = block.match(/description:\s*['"`]([^'"`]+)['"`]/)?.[1]
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
