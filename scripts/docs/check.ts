import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { CLI_COMMANDS } from '../../src/core/cli/registry'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'apps/docs')
const docsContentRoot = join(docsRoot, 'src/content/docs')

interface Frontmatter {
  title?: string
  description?: string
}

function walkMarkdown(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkMarkdown(path, files)
    else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) files.push(path)
  }
  return files
}

function parseFrontmatter(file: string): Frontmatter {
  const text = readFileSync(file, 'utf8')
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  return (yaml.load(match[1]) ?? {}) as Frontmatter
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const cliCommandNames = new Set(CLI_COMMANDS.map(command => command.name))
const cliAliases = new Set(CLI_COMMANDS.flatMap(command => command.aliases ?? []))
const cliTopLevelNames = new Set([...cliCommandNames].map(name => name.split(' ')[0]))
const builtinCliArgs = new Set(['--help', '-h', 'help'])

function shellWords(line: string): string[] {
  return line.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? []
}

function commandAfterBakin(line: string): string | undefined {
  const stripped = line.trim()
  if (!stripped || stripped.startsWith('#') || !/\bbakin\b/.test(stripped)) return undefined

  const words = shellWords(stripped)
  const bakinIndex = words.findIndex(word => word === 'bakin' || word.endsWith('/bakin'))
  if (bakinIndex === -1) return undefined

  const args = words.slice(bakinIndex + 1)
  const first = args[0]
  if (!first) return 'start'
  if (builtinCliArgs.has(first) || cliAliases.has(first)) return first

  const twoPart = args.length > 1 ? `${first} ${args[1]}` : first
  if (cliCommandNames.has(twoPart)) return twoPart
  if (cliCommandNames.has(first)) return first
  if (cliTopLevelNames.has(first)) return first

  return undefined
}

function validateBakinCommands(file: string, text: string): void {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const fencedBlockPattern = /```(?:sh|shell|bash)\n([\s\S]*?)```/g
  for (const match of text.matchAll(fencedBlockPattern)) {
    const blockStart = match.index ?? 0
    const startLine = text.slice(0, blockStart).split('\n').length
    for (const [offset, rawLine] of match[1].split('\n').entries()) {
      const line = rawLine.trim()
      const words = shellWords(line)
      if (!words.some(word => word === 'bakin' || word.endsWith('/bakin'))) continue
      if (commandAfterBakin(line)) continue
      errors.push(`${rel}:${startLine + offset + 1}: unknown bakin command in shell snippet: ${line}`)
    }
  }
}

const errors: string[] = []

for (const file of walkMarkdown(docsContentRoot)) {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const text = readFileSync(file, 'utf8')
  const frontmatter = parseFrontmatter(file)
  if (!frontmatter.title) errors.push(`${rel}: missing frontmatter title`)
  if (!frontmatter.description) errors.push(`${rel}: missing frontmatter description`)
  if (/\bTODO\b|placeholder/i.test(text.replace(/--column=todo/g, '--column=column-name'))) {
    errors.push(`${rel}: contains TODO/placeholder language`)
  }
  if (text.includes('https://docs.makinbakin.com')) {
    errors.push(`${rel}: references retired docs.makinbakin.com host`)
  }
  const rootDocsLinks = text.match(/\]\(\/(?!docs\/)/g)
  if (rootDocsLinks) {
    errors.push(`${rel}: contains root-relative docs links that should start with /docs/`)
  }
  const rootFrontmatterLinks = text.match(/^\s*link:\s*\/(?!docs\/)/gm)
  if (rootFrontmatterLinks) {
    errors.push(`${rel}: contains root-relative frontmatter links that should start with /docs/`)
  }
  validateBakinCommands(file, text)
}

const requiredPublicFiles = [
  '.generated/coverage.json',
  'public/robots.txt',
  'public/_redirects',
  'public/llms.txt',
  'public/llms-full.txt',
  'public/llms/plugin-authoring.md',
  'public/llms/agent-authoring.md',
  'public/llms/sdk-reference.md',
  'public/llms/api.md',
  'public/llms/cli.md',
  'public/llms/hooks.md',
  'public/llms/exec-tools.md',
  'public/llms/core-plugins.md',
  'public/llms/settings.md',
]

const requiredSnippetFiles = [
  'snippets/plugin-basic/index.ts',
  'snippets/plugin-basic/client.tsx',
  'snippets/plugin-basic/bakin-plugin.json',
  'snippets/agent-package-basic/bakin-package.json',
]

for (const file of requiredPublicFiles) {
  if (!existsSync(join(docsRoot, file))) errors.push(`apps/docs/${file}: required docs asset missing`)
}

for (const file of requiredSnippetFiles) {
  if (!existsSync(join(docsRoot, file))) errors.push(`apps/docs/${file}: required docs snippet missing`)
}

for (const file of requiredSnippetFiles.filter((file) => file.endsWith('.json'))) {
  const path = join(docsRoot, file)
  if (!existsSync(path)) continue
  try {
    JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push(`apps/docs/${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

if (errors.length > 0) {
  fail(`Docs validation failed:\n${errors.map(e => `- ${e}`).join('\n')}`)
}

console.log(`Docs validation passed (${walkMarkdown(docsContentRoot).length} pages checked)`)
