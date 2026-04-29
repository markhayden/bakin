import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import {
  EXTRACTED_PLUGINS,
  extractExecTools,
  getApiRoutes,
  getCliCommands,
  locateExtractedPlugin,
  renderExecToolsSnippet,
} from './source-scan'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'docs')
const docsContentRoot = join(docsRoot, 'src/content/docs')
const docsSnippetBlocks = {
  'plugin-basic-manifest': {
    file: 'snippets/plugin-basic/bakin-plugin.json',
    language: 'json',
  },
  'plugin-basic-server': {
    file: 'snippets/plugin-basic/index.ts',
    language: 'ts',
  },
  'plugin-basic-client': {
    file: 'snippets/plugin-basic/client.tsx',
    language: 'tsx',
  },
  'agent-package-basic-manifest': {
    file: 'snippets/agent-package-basic/bakin-package.json',
    language: 'json',
  },
} satisfies Record<string, { file: string; language: string }>

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

const commandSnippets = {
  tasks: ['tasks list', 'tasks create', 'tasks move', 'tasks log', 'tasks block', 'tasks depend', 'tasks complete'],
  workflows: ['workflows list', 'workflows start', 'workflows step', 'workflows submit'],
  health: ['doctor', 'status'],
  schedule: ['schedule'],
} satisfies Record<string, string[]>

function renderCommandSnippet(marker: string): string {
  // 1. Manifest-first: plugins that declare contributes.cliCommands win.
  const manifestCommands = getCliCommands(marker)
  if (manifestCommands.length) {
    const lines = [
      `<!-- docs:cli-commands ${marker} -->`,
      '| Command | Purpose |',
      '| --- | --- |',
    ]
    for (const command of manifestCommands) {
      lines.push(`| \`${command.usage.replace(/\|/g, '\\|')}\` | ${command.summary} |`)
    }
    lines.push('<!-- /docs:cli-commands -->')
    return lines.join('\n')
  }

  // 2. Legacy: hardcoded grouping in `commandSnippets` for in-repo plugins.
  const names = commandSnippets[marker as keyof typeof commandSnippets]
  if (!names) return ''

  const byName = new Map(CLI_COMMANDS.map(command => [command.name, command]))
  const lines = [
    `<!-- docs:cli-commands ${marker} -->`,
    '| Command | Purpose |',
    '| --- | --- |',
  ]

  for (const name of names) {
    const command = byName.get(name)
    if (!command) return ''
    lines.push(`| \`${command.usage.replace(/\|/g, '\\|')}\` | ${command.summary} |`)
  }

  lines.push('<!-- /docs:cli-commands -->')
  return lines.join('\n')
}

function cliMarkerKnown(marker: string): boolean {
  if (commandSnippets[marker as keyof typeof commandSnippets]) return true
  if (getCliCommands(marker).length) return true
  return false
}

function validateCliCommandBlocks(file: string, text: string): void {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const commandMarkerPattern = /<!-- docs:cli-commands ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:cli-commands -->/g
  for (const match of text.matchAll(commandMarkerPattern)) {
    const marker = match[1]
    if (!cliMarkerKnown(marker)) {
      errors.push(`${rel}: unknown CLI command snippet marker "${marker}"`)
      continue
    }
    const expected = renderCommandSnippet(marker)
    if (match[0].trimEnd() !== expected) {
      errors.push(`${rel}: CLI command snippet "${marker}" is out of sync with manifest contributes.cliCommands or src/core/cli/registry.ts`)
    }
  }
}

function renderApiRoutesSnippet(marker: string): string {
  const routes = getApiRoutes(marker)
  if (!routes.length) return ''
  const lines = [
    `<!-- docs:api-routes ${marker} -->`,
    '| Method | Path | Purpose |',
    '| --- | --- | --- |',
  ]
  for (const route of routes) {
    lines.push(`| \`${route.method}\` | \`${route.path}\` | ${route.summary} |`)
  }
  lines.push('<!-- /docs:api-routes -->')
  return lines.join('\n')
}

function validateApiRouteBlocks(file: string, text: string): void {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const markerPattern = /<!-- docs:api-routes ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:api-routes -->/g
  for (const match of text.matchAll(markerPattern)) {
    const marker = match[1]
    const expected = renderApiRoutesSnippet(marker)
    if (!expected) {
      errors.push(`${rel}: unknown api-routes snippet marker "${marker}" (no manifest contributes.apiRoutes and no ctx.registerRoute calls in plugins/${marker}/)`)
      continue
    }
    if (match[0].trimEnd() !== expected) {
      errors.push(`${rel}: api-routes snippet "${marker}" is out of sync with manifest contributes.apiRoutes (or in-repo plugin source)`)
    }
  }
}

function execToolMarkerExists(marker: string): boolean {
  const prefix = `bakin_exec_${marker}_`
  return extractExecTools().some(t => t.name.startsWith(prefix))
}

function validateExecToolBlocks(file: string, text: string): void {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const markerPattern = /<!-- docs:exec-tools ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:exec-tools -->/g
  for (const match of text.matchAll(markerPattern)) {
    const marker = match[1]
    if (!execToolMarkerExists(marker)) {
      if (EXTRACTED_PLUGINS[marker] && !locateExtractedPlugin(marker)) {
        errors.push(
          `${rel}: exec-tools snippet "${marker}" references the extracted plugin "${EXTRACTED_PLUGINS[marker]}" but its source isn't reachable. ` +
          `Clone bakin-bits-official next to bakin (sibling path) or set BAKIN_DOCS_EXTERNAL_SOURCES to its plugins directory.`,
        )
        continue
      }
      errors.push(`${rel}: unknown exec-tools snippet marker "${marker}" (no tools start with bakin_exec_${marker}_)`)
      continue
    }
    const expected = renderExecToolsSnippet(marker)
    if (match[0].trimEnd() !== expected) {
      errors.push(`${rel}: exec-tools snippet "${marker}" is out of sync with registerExecTool calls in source`)
    }
  }
}

function renderDocsSnippetBlock(marker: string): string {
  const snippet = docsSnippetBlocks[marker as keyof typeof docsSnippetBlocks]
  if (!snippet) return ''
  const contents = readFileSync(join(docsRoot, snippet.file), 'utf8').trimEnd()
  return [
    `<!-- docs:snippet ${marker} -->`,
    `Source: \`docs/${snippet.file}\``,
    '',
    `\`\`\`${snippet.language}`,
    contents,
    '```',
    '<!-- /docs:snippet -->',
  ].join('\n')
}

const referencedSnippetBlocks = new Set<string>()

function validateDocsSnippetBlocks(file: string, text: string): void {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const snippetMarkerPattern = /<!-- docs:snippet ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:snippet -->/g
  for (const match of text.matchAll(snippetMarkerPattern)) {
    const marker = match[1]
    referencedSnippetBlocks.add(marker)
    if (!docsSnippetBlocks[marker as keyof typeof docsSnippetBlocks]) {
      errors.push(`${rel}: unknown docs snippet marker "${marker}"`)
      continue
    }
    const expected = renderDocsSnippetBlock(marker)
    if (match[0].trimEnd() !== expected) {
      errors.push(`${rel}: docs snippet "${marker}" is out of sync with docs/${docsSnippetBlocks[marker as keyof typeof docsSnippetBlocks].file}`)
    }
  }
}

function validateJsonFences(file: string, text: string): void {
  const rel = file.replace(repoRoot, '').replace(/^\//, '')
  const jsonBlockPattern = /```json\n([\s\S]*?)```/g
  for (const match of text.matchAll(jsonBlockPattern)) {
    try {
      JSON.parse(match[1])
    } catch (error) {
      const blockStart = match.index ?? 0
      const startLine = text.slice(0, blockStart).split('\n').length
      errors.push(`${rel}:${startLine + 1}: invalid JSON snippet (${error instanceof Error ? error.message : String(error)})`)
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
  const cleanedText = text.replace(/--column=todo/g, '--column=column-name')
  if (/\bTODO\b/.test(cleanedText) || /placeholder/i.test(cleanedText)) {
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
  validateCliCommandBlocks(file, text)
  validateExecToolBlocks(file, text)
  validateApiRouteBlocks(file, text)
  validateDocsSnippetBlocks(file, text)
  validateJsonFences(file, text)
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
  if (!existsSync(join(docsRoot, file))) errors.push(`docs/${file}: required docs asset missing`)
}

for (const file of requiredSnippetFiles) {
  if (!existsSync(join(docsRoot, file))) errors.push(`docs/${file}: required docs snippet missing`)
}

for (const file of requiredSnippetFiles.filter((file) => file.endsWith('.json'))) {
  const path = join(docsRoot, file)
  if (!existsSync(path)) continue
  try {
    JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    errors.push(`docs/${file}: invalid JSON (${error instanceof Error ? error.message : String(error)})`)
  }
}

const pluginManifestPath = join(docsRoot, 'snippets/plugin-basic/bakin-plugin.json')
if (existsSync(pluginManifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(pluginManifestPath, 'utf8')) as { id?: string }
    const pluginId = manifest.id
    if (!pluginId) {
      errors.push('docs/snippets/plugin-basic/bakin-plugin.json: missing id')
    } else {
      for (const file of ['snippets/plugin-basic/index.ts', 'snippets/plugin-basic/client.tsx']) {
        const path = join(docsRoot, file)
        if (!existsSync(path)) continue
        const text = readFileSync(path, 'utf8')
        if (!text.includes(`'${pluginId}'`) && !text.includes(`"${pluginId}"`)) {
          errors.push(`docs/${file}: does not reference plugin manifest id "${pluginId}"`)
        }
      }
    }
  } catch {
    // The JSON parsing loop above reports the invalid manifest.
  }
}

for (const [marker, snippet] of Object.entries(docsSnippetBlocks)) {
  if (!referencedSnippetBlocks.has(marker)) {
    errors.push(`docs/${snippet.file}: required docs snippet is not referenced by a generated docs block (${marker})`)
  }
}

if (errors.length > 0) {
  fail(`Docs validation failed:\n${errors.map(e => `- ${e}`).join('\n')}`)
}

console.log(`Docs validation passed (${walkMarkdown(docsContentRoot).length} pages checked)`)
