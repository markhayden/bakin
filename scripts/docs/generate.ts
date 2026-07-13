import { join } from 'node:path'
import { APP_VERSION } from '../../packages/core/src/constants'
import { DEFAULT_SETTINGS } from '../../packages/core/src/settings'
import { CLI_COMMANDS } from '../../src/core/cli/registry'
import {
  docsBasePath, writeStableFile, docsPath, flattenObject,
} from './lib/doc-utils'
import { renderCliReference } from './lib/cli-reference'
import { OpenApiOperation, curlForOperation, renderApiReference } from './lib/api-reference'
import { readOfficialPluginCatalog } from './lib/source-extraction'
import { readSdkExports, renderSdkReference } from './lib/sdk-reference'
import { renderHookLlmReference, renderHookReference } from './lib/hooks-reference'
import { renderExecToolReference, renderMcpLlmReference } from './lib/mcp-reference'
import { updateGeneratedContentBlocks } from './lib/snippets'
import {
  buildCoverageReport,
  renderPluginCatalog,
  renderRuntimePathsReference,
  renderSettingsReference,
} from './lib/reference-pages'

const repoRoot = new URL('../..', import.meta.url).pathname
const docsRoot = join(repoRoot, 'docs')
const generatedRoot = join(docsRoot, '.generated')
const docsOrigin = 'https://makinbakin.com'
const docsUrl = `${docsOrigin}${docsBasePath}`
const versionLine = `Docs version: Bakin ${APP_VERSION}`

writeStableFile(
  join(generatedRoot, 'coverage.json'),
  JSON.stringify(buildCoverageReport(), null, 2),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/cli.mdx'),
  renderCliReference(),
)

// T20: openapi.json + api.mdx are now generated from typed route contracts
// (the same buildOperation used by /api/openapi). Imports each in-repo
// plugin statically (no activate() invocation), reads plugin.default.routes,
// combines with packages/host/src/core-routes/coreRoutes, runs the typed
// builder. Replaces the legacy buildOpenApiDocument() that used
// manifest + source-scan with generic-object fallbacks.
//
// The api.mdx wrapper-list MUST share operationIds with openapi.json or the
// renderer can't find the operation by id. Shared `apiReferenceGroups` is
// the bridge.
const apiReferenceGroups = new Map<string, Array<{ operationId: string; curl: string; path: string; method: string }>>()
{
  const { buildOperation, normalizeOpenApiPath } = await import('../../packages/core/src/openapi')
  const { coreRoutes: typedCoreRoutes } = await import('../../packages/host/src/core-routes')

  // Canonical core-plugin list (sorted for stable page/tag ordering) — a
  // hand-maintained copy here silently dropped new plugins' routes from
  // openapi.json until docs:validate failed in CI.
  const { CORE_PLUGIN_IDS } = await import(join(repoRoot, 'src/lib/core-plugin-ids.ts'))
  const inRepoPluginIds = [...CORE_PLUGIN_IDS].sort()
  const sources: Array<{ scope: string; tag: string; fullPath: string; route: any }> = []
  for (const id of inRepoPluginIds) {
    const mod = await import(join(repoRoot, 'plugins', id, 'index.ts')) as { default?: { name?: string; routes?: any[] } }
    const routes = mod.default?.routes ?? []
    const tag = mod.default?.name ?? id
    for (const route of routes) {
      sources.push({
        scope: id,
        tag,
        fullPath: `/api/plugins/${id}${route.path}`,
        route,
      })
    }
  }
  for (const route of typedCoreRoutes) {
    sources.push({
      scope: 'core',
      tag: 'Core',
      fullPath: route.path,
      route,
    })
  }

  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Map<string, string | undefined>()
  for (const entry of sources) {
    tags.set(entry.tag, undefined)
    const op = buildOperation(entry.route, { scope: entry.scope, fullPath: entry.fullPath, tag: entry.tag }) as unknown as OpenApiOperation
    const openApiPath = normalizeOpenApiPath(entry.fullPath)
    paths[openApiPath] ??= {}
    paths[openApiPath][entry.route.method.toLowerCase()] = op
    const operationId = String(op.operationId)
    const curl = curlForOperation(entry.route.method, openApiPath, op)
    const existing = apiReferenceGroups.get(entry.tag) ?? []
    existing.push({ operationId, curl, path: openApiPath, method: entry.route.method })
    apiReferenceGroups.set(entry.tag, existing)
  }

  // Sort within each tag group so the page body matches the right-rail TOC
  // (which sorts alphabetically by path, then by HTTP method order).
  const methodOrder: Record<string, number> = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4, OPTIONS: 5, HEAD: 6 }
  for (const ops of apiReferenceGroups.values()) {
    ops.sort((a, b) =>
      a.path.localeCompare(b.path) ||
      (methodOrder[a.method] ?? 99) - (methodOrder[b.method] ?? 99),
    )
  }

  const typedDoc = {
    openapi: '3.1.0',
    info: {
      title: 'Bakin API',
      version: APP_VERSION,
      description: 'Generated from typed route contracts (defineRoute / defineCoreRoute) — same builder as /api/openapi.',
    },
    servers: [{ url: 'http://localhost:3737', description: 'Local Bakin server' }],
    tags: [...tags.entries()].map(([name, description]) => ({ name, ...(description ? { description } : {}) })),
    paths,
    components: {
      securitySchemes: {
        pluginPermissions: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Bakin-Plugin-Permission',
          description: 'Documents plugin permission requirements.',
        },
      },
    },
  }

  writeStableFile(
    join(docsRoot, 'public/openapi.json'),
    `${JSON.stringify(typedDoc, null, 2)}\n`,
  )
}

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/api.mdx'),
  renderApiReference(apiReferenceGroups),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/hooks.mdx'),
  renderHookReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/exec-tools.mdx'),
  renderExecToolReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/core-plugins.md'),
  renderPluginCatalog(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/settings.md'),
  renderSettingsReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/runtime-paths.md'),
  renderRuntimePathsReference(),
)

writeStableFile(
  join(docsRoot, 'src/content/docs/reference/generated/sdk.md'),
  renderSdkReference(),
)

updateGeneratedContentBlocks()

writeStableFile(
  join(docsRoot, 'public/llms.txt'),
  `# Bakin Docs

${versionLine}

Bakin is a self-hosted dashboard, backend, CLI, and extension system for running agent work through a configured runtime adapter. Use these docs to install Bakin, operate it, build plugins, author agent packages, and understand the public contracts exposed by the SDK, hooks, slots, CLI, and HTTP API.

Primary docs:

- Install Bakin: ${docsUrl}/start/install/
  Use this for the released one-line install path and platform notes.

- Initial Setup: ${docsUrl}/start/first-time-setup/
  Use this to create the Bakin home directory and validate local dependencies.

- Daily Operation: ${docsUrl}/start/operation/
  Use this for lifecycle commands, health checks, updates, and runtime operation.

- Essentials: ${docsUrl}/using/essentials/
  Use this for the core Bakin areas and the quickest map of day-to-day product concepts.

- Tasks: ${docsUrl}/using/tasks/
  Use this for the task model, task lifecycle, approvals, output, and agent execution flow.

- Plugin authoring: ${docsUrl}/extending/plugins/overview/
  Use this when building Bakin plugins with @makinbakin/sdk.

- Agent authoring: ${docsUrl}/extending/agents/overview/
  Use this when creating agent packages or writing instructions for coding agents working with Bakin.

- SDK docs: ${docsUrl}/extending/sdk/overview/
  Use this for @makinbakin/sdk imports, UI components, hooks, slots, and public extension contracts.

LLM bundles:

- Full context: ${docsUrl}/llms-full.txt
- Plugin authoring bundle: ${docsUrl}/llms/plugin-authoring.md
- Agent authoring bundle: ${docsUrl}/llms/agent-authoring.md
- SDK reference bundle: ${docsUrl}/llms/sdk-reference.md
- API reference bundle: ${docsUrl}/llms/api.md
`,
)

writeStableFile(
  join(docsRoot, 'public/llms-full.txt'),
  `# Bakin Full LLM Context

${versionLine}

Audience: coding agents, plugin authors, agent authors, and technical operators.

Canonical docs: ${docsUrl}/

## Operating Rules

- Use \`Bakin\` for the product and \`bakin\` for the CLI.
- Prefer the released one-line installer for end-user install instructions.
- Use \`@makinbakin/sdk/*\` imports for plugin-facing code.
- Do not import host internals or another plugin's internals from a plugin.
- Treat public hooks, slots, CLI commands, HTTP routes, settings, and SDK exports as documented contracts.
- Prefer tested docs snippets and generated reference over guessing APIs.

## Useful Bundles

- Plugin authoring: ${docsPath('/llms/plugin-authoring.md')}
- Agent authoring: ${docsPath('/llms/agent-authoring.md')}
- SDK reference: ${docsPath('/llms/sdk-reference.md')}
- API reference: ${docsPath('/llms/api.md')}
- CLI reference: ${docsPath('/reference/generated/cli/')}
- API reference: ${docsPath('/reference/generated/api/')}
- Hooks reference: ${docsPath('/reference/generated/hooks/')}
- Exec/MCP tools reference: ${docsPath('/reference/generated/exec-tools/')}
- Core plugin catalog: ${docsPath('/reference/generated/core-plugins/')}
- Settings reference: ${docsPath('/reference/generated/settings/')}
- Runtime paths: ${docsPath('/reference/generated/runtime-paths/')}
- SDK reference: ${docsPath('/reference/generated/sdk/')}

## Fetch Examples

\`\`\`sh
curl -fsSL ${docsUrl}/llms/plugin-authoring.md
curl -fsSL ${docsUrl}/llms/agent-authoring.md
\`\`\`
`,
)

const bundles = {
  'plugin-authoring.md': {
    title: 'Bakin Plugin Authoring',
    body: 'Use `@makinbakin/sdk/*` for plugin code. Public plugin examples must be backed by tested snippets. Public hooks, slots, routes, settings, and exec/MCP tools require metadata, schemas, examples, visibility, and stability before launch.',
  },
  'agent-authoring.md': {
    title: 'Bakin Agent Authoring',
    body: 'Agent-facing docs are explicit and labeled. Explain runtime-specific concepts only when a package depends on them. Agent package examples must be validated before publication.',
  },
  'api.md': {
    title: 'Bakin API',
    body: 'HTTP API docs are generated from docs-aware route definitions and emitted as OpenAPI 3.1 at /docs/openapi.json. Public inputs are validated with Zod at runtime where handlers define schemas. Structured outputs are validated in tests, docs generation, or development checks where practical.',
  },
  'cli.md': {
    title: 'Bakin CLI Reference',
    body: `The CLI reference is generated from src/core/cli/registry.ts. Current public command count: ${CLI_COMMANDS.length}. Help output and generated docs use the same registry.`,
  },
  'hooks.md': {
    title: 'Bakin Hooks',
    body: renderHookLlmReference(),
  },
  'exec-tools.md': {
    title: 'Bakin MCP Tools',
    body: renderMcpLlmReference(),
  },
  'core-plugins.md': {
    title: 'Bakin Official Plugins',
    body: `The official plugin catalog is generated from supported plugin manifests. Current official plugin count: ${readOfficialPluginCatalog().length}. Core plugins ship in this repo; additional official plugins can live in the official plugin repo.`,
  },
  'settings.md': {
    title: 'Bakin Settings Reference',
    body: `The settings reference is generated from packages/core/src/settings.ts. Current flattened setting count: ${flattenObject(DEFAULT_SETTINGS).length}. Operators can override settings in settings.json under the resolved Bakin home directory.`,
  },
  'sdk-reference.md': {
    title: 'Bakin SDK Reference',
    body: `The SDK reference is generated from JSDoc comments on SDK barrel exports plus the canonical Health type leaf resolved from the public types barrel. Current SDK subpath count: ${readSdkExports().length}. Core plugin contract types (BakinPlugin, PluginContext, etc.) include field-level documentation; remaining types are grouped by domain with one-line summaries.`,
  },
}

for (const [file, { title, body }] of Object.entries(bundles)) {
  writeStableFile(
    join(docsRoot, 'public/llms', file),
    `# ${title}

${versionLine}

Audience: coding agents and technical authors.

Canonical docs: ${docsUrl}/

${body}
`,
  )
}

console.log('Generated docs scaffolding artifacts')
