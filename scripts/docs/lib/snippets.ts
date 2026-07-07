/**
 * Docs generator — content-block snippets.
 *
 * Renders the in-place `<!-- docs:* -->` marker blocks (CLI command tables,
 * api-route tables, settings tables, the plugin-permissions table, and the
 * fenced source snippets) and rewrites every markdown page under
 * docs/src/content/docs that contains them.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  extractPluginSettings,
  getApiRoutes,
  getCliCommands,
  renderExecToolsSnippet,
} from '../source-scan'
import { CLI_COMMANDS } from '../../../src/core/cli/registry'
import { PERMISSION_DESCRIPTIONS, PermissionSchema } from '../../../packages/core/src/plugins/permissions'
import { escapeTableCell, writeStableFile } from './doc-utils'

const repoRoot = new URL('../../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'docs')

const commandSnippets = {
  tasks: ['tasks list', 'tasks create', 'tasks move', 'tasks log', 'tasks block', 'tasks depend', 'tasks complete'],
  workflows: ['workflows list', 'workflows start', 'workflows step', 'workflows submit'],
  health: ['doctor', 'status'],
  schedule: ['schedule'],
}
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

/** External-plugin markers (e.g. bits-shipped messaging) have no in-repo
 * source to regenerate from — warn and leave the committed block as-is
 * rather than failing the whole docs build (this broke `docs:generate` on
 * main once messaging.md landed with markers). */
function warnMissingSnippetSource(message: string): null {
  console.warn(`[docs] ${message} — leaving the existing block unchanged`)
  return null
}

function renderCommandSnippet(marker: string): string | null {
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

  // 2. Legacy hardcoded grouping for in-repo plugins that haven't backfilled.
  const names = commandSnippets[marker as keyof typeof commandSnippets]
  if (!names) return warnMissingSnippetSource(`cli-commands snippet "${marker}" has no in-repo source`)

  const byName = new Map(CLI_COMMANDS.map(command => [command.name, command]))
  const lines = [
    `<!-- docs:cli-commands ${marker} -->`,
    '| Command | Purpose |',
    '| --- | --- |',
  ]

  for (const name of names) {
    const command = byName.get(name)
    if (!command) throw new Error(`Missing CLI command for docs snippet "${marker}": ${name}`)
    lines.push(`| \`${command.usage.replace(/\|/g, '\\|')}\` | ${command.summary} |`)
  }

  lines.push('<!-- /docs:cli-commands -->')
  return lines.join('\n')
}

function renderApiRoutesSnippet(marker: string): string | null {
  const routes = getApiRoutes(marker)
  if (!routes.length) return warnMissingSnippetSource(`api-routes snippet "${marker}" has no in-repo source`)
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

function renderSettingsSnippet(marker: string): string | null {
  const fields = extractPluginSettings(marker)
  if (!fields.length) return warnMissingSnippetSource(`settings snippet "${marker}" has no in-repo source`)
  const lines = [
    `<!-- docs:settings ${marker} -->`,
    '<div class="settings-table">',
    '',
    '| Setting | Type | Default | What it does |',
    '| --- | --- | --- | --- |',
  ]
  for (const field of fields) {
    const name = escapeTableCell(field.label || field.key)
    const type = `\`${field.type}\``
    const def = field.default ? `\`${escapeTableCell(field.default)}\`` : ''
    const desc = escapeTableCell(field.description || '')
    lines.push(`| ${name} | ${type} | ${def} | ${desc} |`)
  }
  lines.push('')
  lines.push('</div>')
  lines.push('<!-- /docs:settings -->')
  return lines.join('\n')
}

function renderPluginPermissionsSnippet(): string {
  const lines = [
    '<!-- docs:plugin-permissions -->',
    '<div class="table-light-full table-label-wrap permissions-table">',
    '',
    '| Permission | Typical use |',
    '| --- | --- |',
  ]
  for (const permission of PermissionSchema.options) {
    lines.push(`| \`${permission}\` | ${escapeTableCell(PERMISSION_DESCRIPTIONS[permission])} |`)
  }
  lines.push('')
  lines.push('</div>')
  lines.push('<!-- /docs:plugin-permissions -->')
  return lines.join('\n')
}

function renderDocsSnippetBlock(marker: string): string {
  const snippet = docsSnippetBlocks[marker as keyof typeof docsSnippetBlocks]
  if (!snippet) throw new Error(`Unknown docs snippet block: ${marker}`)

  const sourcePath = join(docsRoot, snippet.file)
  const contents = readFileSync(sourcePath, 'utf8').trimEnd()
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

export function updateGeneratedContentBlocks(): void {
  const docsContentRoot = join(docsRoot, 'src/content/docs')
  const markdownFiles: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) markdownFiles.push(path)
    }
  }
  walk(docsContentRoot)

  const commandMarkerPattern = /<!-- docs:cli-commands ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:cli-commands -->/g
  const snippetMarkerPattern = /<!-- docs:snippet ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:snippet -->/g
  const execToolsMarkerPattern = /<!-- docs:exec-tools ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:exec-tools -->/g
  const apiRoutesMarkerPattern = /<!-- docs:api-routes ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:api-routes -->/g
  const settingsMarkerPattern = /<!-- docs:settings ([a-z0-9-]+) -->[\s\S]*?<!-- \/docs:settings -->/g
  const pluginPermissionsMarkerPattern = /<!-- docs:plugin-permissions -->[\s\S]*?<!-- \/docs:plugin-permissions -->/g
  for (const file of markdownFiles) {
    const text = readFileSync(file, 'utf8')
    const next = text
      .replace(commandMarkerPattern, (match, marker: string) => renderCommandSnippet(marker) ?? match)
      .replace(snippetMarkerPattern, (_match, marker: string) => renderDocsSnippetBlock(marker))
      .replace(execToolsMarkerPattern, (match, marker: string) => renderExecToolsSnippet(marker) ?? match)
      .replace(apiRoutesMarkerPattern, (match, marker: string) => renderApiRoutesSnippet(marker) ?? match)
      .replace(settingsMarkerPattern, (match, marker: string) => renderSettingsSnippet(marker) ?? match)
      .replace(pluginPermissionsMarkerPattern, renderPluginPermissionsSnippet())
    if (next !== text) writeStableFile(file, next)
  }
}
