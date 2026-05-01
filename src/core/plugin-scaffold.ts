/**
 * `bakin plugins scaffold <name>` — generate a starter plugin (#147 TH4).
 *
 * Writes:
 *   ./<name>/bakin-plugin.json
 *   ./<name>/package.json
 *   ./<name>/src/index.ts
 *   ./<name>/src/client.tsx
 *   ./<name>/.gitignore
 *   ./<name>/README.md
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

const NAME_RE = /^[a-z][a-z0-9-]{0,39}$/

export function scaffoldPlugin(name: string): number {
  if (!NAME_RE.test(name)) {
    console.error(`Invalid plugin name: ${JSON.stringify(name)}`)
    console.error('  Must start with a lowercase letter, be <=40 chars, and use only [a-z0-9-].')
    return 1
  }

  const root = resolve(process.cwd(), name)
  if (existsSync(root)) {
    console.error(`Refusing to scaffold into existing directory: ${root}`)
    return 1
  }

  try {
    mkdirSync(join(root, 'src'), { recursive: true })

    writeFileSync(
      join(root, 'bakin-plugin.json'),
      JSON.stringify(
        {
          id: name,
          name: name,
          version: '0.1.0',
          bakin: `>=${APP_VERSION}`,
          description: `${name} plugin for Bakin`,
          entry: {
            server: 'src/index.ts',
            client: 'src/client.tsx',
          },
          permissions: [],
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
          devDependencies: {
            '@bakin/sdk': `^${APP_VERSION}`,
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
      join(root, 'src/index.ts'),
      `/**
 * ${name} — server entry.
 *
 * Exports a BakinPlugin whose activate() runs once during server start-up.
 * Use ctx.registerRoute / registerExecTool / registerHook etc. to wire in
 * functionality.
 */
import type { BakinPlugin, PluginContext } from '@bakin/sdk/types'

const plugin: BakinPlugin = {
  id: '${name}',
  name: '${name}',
  version: '0.1.0',
  async activate(_ctx: PluginContext) {
    // TODO: register routes, hooks, and exec tools here.
  },
}

export default plugin
`,
    )

    writeFileSync(
      join(root, 'src/client.tsx'),
      `/**
 * ${name} — client entry.
 *
 * Loaded by the Bakin host shell via its runtime plugin loader.
 * \`registerPlugin\` contributes nav items + slot implementations into the
 * shared shell runtime.
 */
import { registerPlugin } from '@bakin/sdk'

registerPlugin({
  id: '${name}',
  navItems: [],
  // slots: { 'task-sidebar': MyTaskSidebar },
  // pages: { '/my-route': MyPage },
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
bun install           # install @bakin/sdk + react for typechecking
\`\`\`

## Install into Bakin

\`\`\`sh
bakin plugins install .
\`\`\`

This copies the plugin into \`~/.bakin/plugins/${name}\`, where the server
auto-builds the \`dist/\` output on boot.

## Layout

\`\`\`
src/index.ts   — server entry (BakinPlugin)
src/client.tsx — browser entry (registerPlugin)
bakin-plugin.json — manifest
\`\`\`
`,
    )

    console.log(`Scaffolded plugin at ${root}`)
    console.log('')
    console.log('Next steps:')
    console.log(`  cd ${name} && bun install && bakin plugins install .`)
    return 0
  } catch (err) {
    console.error(`Scaffold failed: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
}
