/**
 * `bakin plugins scaffold <name>` — generate a starter plugin (#147 TH4).
 *
 * Emits the canonical root layout (the only layout the builder supports):
 *   ./<name>/bakin-plugin.json   — manifest (contributes + permissions declared)
 *   ./<name>/package.json
 *   ./<name>/tsconfig.json
 *   ./<name>/index.ts            — server entry (definePlugin + activate)
 *   ./<name>/client.tsx          — browser entry (registerPlugin side effect)
 *   ./<name>/greeting.ts         — pure helper shared by route + exec tool
 *   ./<name>/tests/plugin.test.ts
 *   ./<name>/.gitignore
 *   ./<name>/README.md
 *
 * The scaffolded plugin must install verbatim: every route/tool the templates
 * register is declared in the manifest's `contributes`, and every permission
 * the templates exercise is declared in `permissions`.
 *
 * Validation:
 *   - <name> must match /^[a-z][a-z0-9-]{0,39}$/
 *   - ./<name>/ must not already exist
 *
 * Exit codes: 0 on success, 1 on validation / filesystem errors.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { APP_VERSION } from '../../packages/core/src/constants'
import { stripPrerelease } from '../../packages/core/src/plugins/compat'

const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/

/** The stamp `scripts/stamp-version.ts` leaves when running from source. */
const DEV_VERSION = '0.0.0-dev'

export interface PluginScaffoldResult {
  ok: boolean
  id?: string
  root?: string
  next?: string[]
  error?: string
}

/**
 * Resolve the version strings baked into the scaffold.
 *
 * Stamped release binary (the normal end-user case): pin both to the
 * scaffolding host — the manifest floor `>=${APP_VERSION}` always satisfies
 * the host that generated it, and `^${APP_VERSION}` matches the SDK
 * published for that release.
 *
 * Prerelease-stamped hosts (rc builds `0.6.0-rc.1`, describe-stamped
 * self-builds `0.6.1-3-gabc1234[-dirty]`): the manifest floor uses the
 * prerelease-STRIPPED base (matching the compat gate's comparison basis) and
 * the SDK dep falls back to `latest` — `^0.6.1-3-gabc1234` is unresolvable
 * on npm and would break the scaffold's `bun install` step.
 *
 * Dev source checkout (APP_VERSION is the 0.0.0-dev fallback): the manifest
 * floor stays host-consistent, but note `>=0.0.0` is effectively NO floor on
 * release hosts — a dev-scaffolded plugin installs anywhere; authors set a
 * real floor when they know their minimum. `^0.0.0-dev` does not exist on
 * npm — `latest` is the only resolvable choice for the SDK types.
 */
export function resolveScaffoldVersions(appVersion: string = APP_VERSION): {
  bakinRange: string
  sdkDependency: string
} {
  const isPrerelease = appVersion !== stripPrerelease(appVersion)
  return {
    bakinRange: `>=${appVersion === DEV_VERSION ? appVersion : stripPrerelease(appVersion)}`,
    sdkDependency: appVersion === DEV_VERSION || isPrerelease ? 'latest' : `^${appVersion}`,
  }
}

export function createPluginScaffold(name: string): PluginScaffoldResult {
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      error: `Invalid plugin name: ${JSON.stringify(name)}. Must start with a lowercase letter, be <=40 chars, and use only [a-z0-9-].`,
    }
  }

  const root = resolve(process.cwd(), name)
  if (existsSync(root)) {
    return {
      ok: false,
      error: `Refusing to scaffold into existing directory: ${root}`,
    }
  }

  const { bakinRange, sdkDependency } = resolveScaffoldVersions()
  const toolName = `bakin_exec_${name}_greet`

  try {
    mkdirSync(join(root, 'tests'), { recursive: true })

    writeFileSync(
      join(root, 'bakin-plugin.json'),
      JSON.stringify(
        {
          id: name,
          name: name,
          version: '0.1.0',
          bakin: bakinRange,
          description: `${name} plugin for Bakin`,
          permissions: ['storage.read', 'storage.write'],
          contributes: {
            apiRoutes: [
              {
                method: 'GET',
                path: '/hello',
                summary: 'Return the current greeting',
                description: 'Reads the last greeting saved by the greet exec tool.',
              },
            ],
            routes: [
              { path: `/${name}`, summary: `${name} page` },
            ],
            nav: [
              { id: name, label: name, icon: 'Puzzle', href: `/${name}`, order: 100 },
            ],
            execTools: [
              {
                name: toolName,
                summary: 'Save and return a greeting',
                description: 'Builds a greeting, persists it to plugin storage, and returns it.',
              },
            ],
          },
          dependencies: [],
        },
        null,
        2,
      ) + '\n',
    )

    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify(
        {
          name: `bakin-plugin-${name}`,
          version: '0.1.0',
          private: true,
          type: 'module',
          dependencies: {
            zod: '^4.3.0',
          },
          devDependencies: {
            '@makinbakin/sdk': sdkDependency,
            '@types/bun': '^1.0.0',
            '@types/react': '^19',
            '@types/react-dom': '^19',
            react: '^19.0.0',
            'react-dom': '^19.0.0',
            typescript: '^5.0.0',
          },
        },
        null,
        2,
      ) + '\n',
    )

    writeFileSync(
      join(root, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'esnext',
            moduleResolution: 'bundler',
            jsx: 'react-jsx',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            isolatedModules: true,
            forceConsistentCasingInFileNames: true,
          },
          include: ['**/*.ts', '**/*.tsx'],
          exclude: ['dist', 'node_modules'],
        },
        null,
        2,
      ) + '\n',
    )

    writeFileSync(
      join(root, 'greeting.ts'),
      `/** Pure helper shared by the /hello route and the greet exec tool. */
export function buildGreeting(name?: string): string {
  return \`Hello from \${name?.trim() || 'the ${name} plugin'}!\`
}
`,
    )

    writeFileSync(
      join(root, 'index.ts'),
      `/**
 * ${name} — server entry.
 *
 * Exports a plugin via definePlugin(). Declarative \`routes\` handle HTTP;
 * activate() runs once at server start-up and registers everything else
 * (exec tools, hooks, health checks).
 *
 * Every route here must be declared in bakin-plugin.json under
 * \`contributes.apiRoutes\`, and every exec tool under \`contributes.execTools\`
 * — activation fails otherwise.
 */
import { definePlugin, defineRoute } from '@makinbakin/sdk'
import type { PluginContext } from '@makinbakin/sdk/types'
import { z } from 'zod'
import { buildGreeting } from './greeting'

const plugin = definePlugin({
  id: '${name}',
  name: '${name}',
  version: '0.1.0',
  routes: [
    defineRoute({
      method: 'GET',
      path: '/hello',
      summary: 'Return the current greeting',
      description: 'Reads the last greeting saved by the greet exec tool.',
      handler: async (_req, ctx) => {
        // ctx.storage is scoped to this plugin (requires the storage.read
        // permission declared in the manifest).
        const saved = ctx.storage.read('last-greeting.txt')
        return Response.json({ message: saved ?? buildGreeting() })
      },
    }),
  ],
  async activate(ctx: PluginContext) {
    // Exec tools are how agents call into your plugin over MCP. User-plugin
    // tool names must start with "bakin_exec_${name}_".
    ctx.registerExecTool({
      name: '${toolName}',
      description: 'Builds a greeting, persists it to plugin storage, and returns it.',
      parameters: {
        name: z.string().optional().describe('Who to greet'),
      },
      handler: async (params, _agent, toolCtx) => {
        const message = buildGreeting(typeof params.name === 'string' ? params.name : undefined)
        // Requires the storage.write permission declared in the manifest.
        toolCtx?.storage.write('last-greeting.txt', message)
        return { ok: true, message }
      },
    })

    // Cross-plugin calls go through the hook registry. Example:
    // ctx.hooks.register('${name}.greet', (data) => buildGreeting(String(data)))
  },
})

export default plugin
`,
    )

    writeFileSync(
      join(root, 'client.tsx'),
      `/**
 * ${name} — client entry.
 *
 * Loaded by the Bakin host shell via its runtime plugin loader. Calling
 * \`registerPlugin\` as a module side effect contributes nav items, client
 * routes, and slot implementations into the shared shell runtime.
 *
 * The \`routes\` keys must exactly match the manifest's \`contributes.routes\`
 * patterns so the host knows which plugin owns a path before this bundle
 * loads.
 */
import { registerPlugin } from '@makinbakin/sdk'

function ${pascalCase(name)}Page() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">${name}</h1>
      <p className="text-sm text-bakin-text-muted">
        Edit client.tsx to build this page.
      </p>
    </div>
  )
}

registerPlugin({
  id: '${name}',
  navItems: [
    { id: '${name}', label: '${name}', icon: 'Puzzle', href: '/${name}', order: 100 },
  ],
  routes: {
    '/${name}': ${pascalCase(name)}Page,
  },
  // slots: { 'task-sidebar': MyTaskSidebar },
})
`,
    )

    writeFileSync(
      join(root, 'tests/plugin.test.ts'),
      `/**
 * Starter test — runs with \`bun test\` after \`bun install\`.
 *
 * Uses @makinbakin/sdk/testing: \`activatePlugin\` builds an isolated context
 * (plugin storage in a throwaway temp dir — no host, no ~/.bakin) and
 * \`callRoute\` drives handlers exactly like the host's router.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { activatePlugin, callRoute, findRoute } from '@makinbakin/sdk/testing'
import plugin from '../index'

describe('${name}', () => {
  const ready = activatePlugin(plugin)
  afterAll(async () => (await ready).dispose())

  it('activates and serves GET /hello', async () => {
    const harness = await ready
    const route = findRoute(harness.routes, 'GET', '/hello')
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route!, harness.ctx)
    expect(status).toBe(200)
    expect(body.message).toBe('Hello from the ${name} plugin!')
  })
})
`,
    )

    writeFileSync(
      join(root, '.gitignore'),
      'node_modules\ndist\n',
    )

    writeFileSync(
      join(root, 'README.md'),
      `# ${name}

A Bakin plugin.

## Develop

\`\`\`sh
bun install    # @makinbakin/sdk + react for typechecking
bun test       # run tests/
bun x tsc --noEmit
\`\`\`

## Install into Bakin

\`\`\`sh
bakin plugins install .
\`\`\`

This copies the plugin into \`~/.bakin/plugins/${name}\`, where the server
auto-builds the \`dist/\` output. For a live dev loop against a running
server, use \`bakin plugins link .\` instead.

## Layout

\`\`\`
index.ts          — server entry (definePlugin: routes + activate)
client.tsx        — browser entry (registerPlugin side effect)
greeting.ts       — pure logic, unit-testable without a host
tests/            — bun:test tests
bakin-plugin.json — manifest: contributes + permissions (must match the code)
\`\`\`

Routes registered in code must be declared in \`contributes.apiRoutes\`;
exec tools in \`contributes.execTools\` (names prefixed \`bakin_exec_${name}_\`);
client route patterns in \`contributes.routes\`. Activation fails loudly on
undeclared registrations.
`,
    )

    return {
      ok: true,
      id: name,
      root,
      next: [`cd ${name} && bun install && bakin plugins install .`],
    }
  } catch (err) {
    return {
      ok: false,
      error: `Scaffold failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** `my-plugin` → `MyPlugin` (component names in the client template). */
function pascalCase(name: string): string {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

export function scaffoldPlugin(name: string): number {
  const result = createPluginScaffold(name)
  if (!result.ok) {
    console.error(result.error)
    return 1
  }

  console.log(`Scaffolded plugin at ${result.root}`)
  console.log('')
  console.log('Next steps:')
  for (const next of result.next ?? []) {
    console.log(`  ${next}`)
  }
  return 0
}
