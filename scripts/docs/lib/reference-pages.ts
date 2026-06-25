/**
 * Docs generator — catalog / settings / runtime-paths reference pages and the
 * coverage report.
 *
 * Renders the plugin catalog (core-plugins.md), the settings defaults
 * (settings.md), and the runtime-paths reference (runtime-paths.md), plus the
 * machine-readable coverage.json surface inventory.
 */
import { APP_VERSION } from '../../../packages/core/src/constants'
import { DEFAULT_SETTINGS } from '../../../packages/core/src/settings'
import { CLI_COMMANDS } from '../../../src/core/cli/registry'
import { getAllRoutes } from '../../../src/core/api-docs'
import { extractExecTools } from '../source-scan'
import { escapeHtml, flattenObject, generatedPageNote } from './doc-utils'
import {
  extractHookRegistrations,
  extractSlotRegistrations,
  readCorePluginManifests,
  readOfficialPluginCatalog,
} from './source-extraction'
import { readSdkExports } from './sdk-reference'

const llmBundleFiles = [
  'llms.txt',
  'llms-full.txt',
  'llms/plugin-authoring.md',
  'llms/agent-authoring.md',
  'llms/sdk-reference.md',
  'llms/api.md',
  'llms/cli.md',
  'llms/hooks.md',
  'llms/exec-tools.md',
  'llms/core-plugins.md',
  'llms/settings.md',
]
const docsSnippetFiles = [
  'snippets/plugin-basic/bakin-plugin.json',
  'snippets/plugin-basic/index.ts',
  'snippets/plugin-basic/client.tsx',
  'snippets/agent-package-basic/bakin-package.json',
]
const publicSlotNames = [
  'asset-preview',
  'asset-detail-modal',
  'task-assets',
  'task-sidebar',
  'home-widget',
  'page:/<route>',
]

export function buildCoverageReport(): Record<string, unknown> {
  const routes = getAllRoutes()
  return {
    version: APP_VERSION,
    generatedBy: 'scripts/docs/generate.ts',
    surfaces: {
      cliCommands: {
        status: 'active',
        count: CLI_COMMANDS.length,
        examples: CLI_COMMANDS.reduce((count, command) => count + (command.examples?.length ?? 0), 0),
        source: 'src/core/cli/registry.ts',
      },
      httpRoutes: {
        status: 'active',
        count: routes.length,
        withInputSchema: routes.filter(route => Boolean(route.input)).length,
        withOutputSchema: routes.filter(route => Boolean(route.output)).length,
        withExamples: routes.filter(route => (route.examples?.length ?? 0) > 0).length,
        source: 'src/core/api-docs.ts',
      },
      pluginRoutes: {
        status: 'partial',
        count: routes.filter(route => route.pluginId !== 'core').length,
        source: 'runtime route registration metadata',
      },
      hookRegistrations: {
        status: 'audited',
        count: extractHookRegistrations().length,
        source: 'source scan',
      },
      slots: {
        status: 'documented',
        count: publicSlotNames.length,
        auditedRegistrations: extractSlotRegistrations().length,
        source: 'packages/sdk/src/register.ts and slot source scan',
      },
      execTools: {
        status: 'audited',
        count: extractExecTools().length,
        source: 'source scan',
      },
      corePlugins: {
        status: 'active',
        count: readCorePluginManifests().length,
        source: 'plugins/*/bakin-plugin.json',
      },
      settings: {
        status: 'active',
        count: flattenObject(DEFAULT_SETTINGS).length,
        source: 'packages/core/src/settings.ts',
      },
      sdkSubpaths: {
        status: 'active',
        count: readSdkExports().length,
        source: 'packages/sdk/package.json',
      },
      agentPackageKinds: {
        status: 'active',
        count: 4,
        source: 'packages/core/src/agent-packages/manifest.ts',
      },
      docsSnippets: {
        status: 'active',
        count: docsSnippetFiles.length,
        source: 'docs/snippets',
      },
      llmBundles: {
        status: 'active',
        count: llmBundleFiles.length,
        source: 'scripts/docs/generate.ts',
      },
    },
  }
}

export function renderPluginCatalog(): string {
  const plugins = readOfficialPluginCatalog()
  const lines = [
    '---',
    'title: Official Plugins',
    'description: Generated catalog of official plugins supported by Bakin.',
	    '---',
	    '',
    '<div class="plugin-catalog-intro">',
    '  <p>Official plugins are maintained with Bakin and documented as supported product surfaces. Core plugins ship in this repo; official plugins can also live in the official plugin repo.</p>',
    '</div>',
    '',
    '<table class="plugin-catalog-table">',
    '  <thead>',
    '    <tr><th>Plugin</th><th>ID</th><th>Source</th><th>Version</th><th>Depends On</th></tr>',
    '  </thead>',
    '  <tbody>',
	  ]

	  for (const plugin of plugins) {
    const name = escapeHtml(plugin.name)
    const description = plugin.description ? `<br/><span>${escapeHtml(plugin.description)}</span>` : ''
    const deps = plugin.dependencies?.length ? plugin.dependencies.map(d => `<code>${escapeHtml(d)}</code>`).join(' ') : 'none'
    lines.push(
      '    <tr>',
      `      <td>${name}${description}</td>`,
      `      <td><code>${escapeHtml(plugin.id)}</code></td>`,
      `      <td>${plugin.origin}</td>`,
      `      <td><code>${escapeHtml(plugin.version)}</code></td>`,
      `      <td>${deps}</td>`,
      '    </tr>',
    )
	  }
  lines.push('  </tbody>', '</table>', '')
	  lines.push(generatedPageNote(), '')

	  return lines.join('\n')
	}

export function renderSettingsReference(): string {
  const settings = flattenObject(DEFAULT_SETTINGS)
  const grouped = new Map<string, Array<{ key: string; value: unknown }>>()
  for (const setting of settings) {
    const namespace = setting.key.split('.')[0] || 'other'
    const existing = grouped.get(namespace) ?? []
    existing.push(setting)
    grouped.set(namespace, existing)
  }

  const lines = [
    '---',
    'title: Defaults',
    'description: Generated reference for Bakin core settings defaults.',
	    '---',
    '',
    '<div class="settings-reference-intro">',
    '  <p>Bakin starts with these values, then deep-merges anything you set in <code>settings.json</code>. Use this page when you need the exact key for CLI updates, automation, or troubleshooting.</p>',
    '</div>',
    '',
  ]

  const settingGroupTitles: Record<string, string> = { restartRecovery: 'Restart Recovery', sse: 'SSE' }

  for (const namespace of [...grouped.keys()].sort((a, b) => a.localeCompare(b))) {
    const title = settingGroupTitles[namespace] ?? (namespace === 'other' ? 'Other' : `${namespace[0].toUpperCase()}${namespace.slice(1)}`)
    lines.push(`## ${title}`, '')
    lines.push(
      '<table class="settings-defaults-table">',
      '  <thead>',
      '    <tr><th>Key</th><th>Default</th></tr>',
      '  </thead>',
      '  <tbody>',
    )
    for (const setting of [...(grouped.get(namespace) ?? [])].sort((a, b) => a.key.localeCompare(b.key))) {
      lines.push(
        '    <tr>',
        `      <td><code>${escapeHtml(setting.key)}</code></td>`,
        `      <td><code>${escapeHtml(JSON.stringify(setting.value))}</code></td>`,
        '    </tr>',
      )
    }
    lines.push('  </tbody>', '</table>', '')
  }
  lines.push('', generatedPageNote(), '')
  return lines.join('\n')
}

export function renderRuntimePathsReference(): string {
  const resolution = [
    ['BAKIN_HOME', 'Used when the environment variable is set.'],
    ['~/.bakin/', 'Default location when no override is present.'],
  ]
  const paths = [
    ['home', 'Resolved Bakin home directory.'],
    ['settings', 'Runtime settings file.'],
    ['memoryLog', 'Shared memory log.'],
    ['audit', 'Append-only audit log.'],
    ['logs', 'Server and runtime logs.'],
    ['assets', 'Asset runtime root.'],
    ['assets.store', 'Month-sharded asset files.'],
    ['assets.inbox', 'Asset ingestion inbox.'],
    ['assets.trash', 'Soft-deleted asset files.'],
    ['agents', 'Agent runtime assets.'],
    ['team', 'Team runtime data.'],
    ['personas', 'Agent persona files.'],
    ['heartbeats', 'Agent heartbeat files.'],
    ['inbox', 'General inbox directory.'],
    ['tasks', 'Task metadata store.'],
    ['workflows', 'Workflow definitions, skills, and instances.'],
  ]
  const lines = [
    '---',
    'title: Runtime Paths',
    'description: Reference for Bakin runtime files under the resolved Bakin home directory.',
    '---',
    '',
    '<div class="runtime-paths-intro">',
    '  <p>Bakin keeps local state under one home directory. Use these keys when you need to find logs, settings, assets, task metadata, workflow state, or other files created by the runtime.</p>',
    '</div>',
    '',
    '## Home Resolution',
    '',
    '<table class="runtime-paths-table">',
    '  <thead>',
    '    <tr><th>Source</th><th>When Used</th></tr>',
    '  </thead>',
    '  <tbody>',
  ]
  for (const [source, description] of resolution) {
    lines.push(
      '    <tr>',
      `      <td><code>${escapeHtml(source)}</code></td>`,
      `      <td>${escapeHtml(description)}</td>`,
      '    </tr>',
    )
  }
  lines.push(
    '  </tbody>',
    '</table>',
    '',
    '## Path Keys',
    '',
    '<table class="runtime-paths-table">',
    '  <thead>',
    '    <tr><th>Key</th><th>Purpose</th></tr>',
    '  </thead>',
    '  <tbody>',
  )
  for (const [key, description] of paths) {
    lines.push(
      '    <tr>',
      `      <td><code>${escapeHtml(key)}</code></td>`,
      `      <td>${escapeHtml(description)}</td>`,
      '    </tr>',
    )
  }
  lines.push('  </tbody>', '</table>', '', generatedPageNote(), '')
  return lines.join('\n')
}
