/**
 * Whiskit shared build backend (Phase 2): system-bun builds of a fixture
 * plugin — SDK inlined into the server bundle, SDK external in the client
 * bundle, `bun install --ignore-scripts` for declared deps (offline file:
 * dep), import-contract enforcement, SDK resolution ladder. Real bun
 * subprocesses, no network. Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'

const mockDir = join(tmpdir(), `whiskit-build-mock-${Date.now()}-${randomUUID()}`)
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(mockDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(mockDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  buildPluginInProcess,
  buildPluginWithSystemBun,
  canBuildInProcess,
  resolveSdkEntrypoints,
} from '../../../src/core/whiskit/build'
import { WhiskitBuildError } from '../../../src/core/whiskit/types'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  delete process.env.BAKIN_SDK_PATH
})
function freshDir(prefix: string): string {
  const d = join(tmpdir(), `whiskit-${prefix}-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

/** A minimal buildable plugin: server entry imports the SDK, client fills a slot. */
function seedPlugin(opts: { withClient?: boolean } = {}): string {
  const dir = freshDir('plugin')
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({
    id: 'demo', name: 'Demo', version: '0.1.0', bakin: '>=0.0.1',
    description: 'build fixture',   }))
  writeFileSync(join(dir, 'index.ts'), [
    `import type { NavItem } from '@makinbakin/sdk/types'`,
    // A runtime SDK import so inlining is observable in the output bundle.
    // /metadata is lean (no third-party deps) — the root barrel drags
    // @bakin/core/docs → zod, which the in-process build can't read under
    // the test harness. Barrel server-safety has its own system-bun pin test.
    `import { defineHookContract } from '@makinbakin/sdk/metadata'`,
    `export default {`,
    `  id: 'demo', name: 'Demo', version: '0.1.0',`,
    `  nav: [] as NavItem[],`,
    `  activate() { return defineHookContract },`,
    `}`,
    '',
  ].join('\n'))
  if (opts.withClient !== false) {
    writeFileSync(join(dir, 'client.tsx'), [
      `import { registerPlugin } from '@makinbakin/sdk'`,
      `registerPlugin({ id: 'demo', slots: {} })`,
      '',
    ].join('\n'))
  }
  return dir
}

describe('resolveSdkEntrypoints', () => {
  it('resolves repo SDK source in a source run', () => {
    const sdk = resolveSdkEntrypoints(freshDir('nosdk'))
    expect(sdk.source).toBe('repo-source')
    expect(sdk.entrypoints['@makinbakin/sdk']).toContain('packages/sdk/src/index.ts')
    expect(sdk.entrypoints['@makinbakin/sdk/slots']).toContain('slots/index.tsx')
    expect(sdk.entrypoints['@makinbakin/sdk/layout']).toContain('layout/index.ts')
    expect(sdk.entrypoints['@makinbakin/sdk/patterns']).toContain('patterns/index.ts')
    expect(sdk.entrypoints['@makinbakin/sdk/charts']).toContain('charts/index.ts')
    expect(sdk.entrypoints['@makinbakin/sdk/conversation']).toContain('conversation/index.ts')
  })

  it('honors BAKIN_SDK_PATH and rejects incomplete roots', () => {
    const fake = freshDir('fakesdk')
    // Complete fake package layout
    writeFileSync(join(fake, 'index.js'), 'export const x = 1\n')
    for (const sub of ['ui', 'layout', 'patterns', 'charts', 'conversation', 'hooks', 'components', 'slots', 'types', 'utils', 'metadata', 'routing']) {
      mkdirSync(join(fake, sub), { recursive: true })
      writeFileSync(join(fake, sub, 'index.js'), 'export const x = 1\n')
    }
    process.env.BAKIN_SDK_PATH = fake
    const sdk = resolveSdkEntrypoints(freshDir('plugindir'))
    expect(sdk.source).toBe('env')
    expect(sdk.entrypoints['@makinbakin/sdk/ui']).toBe(join(fake, 'ui', 'index.js'))

    // Incomplete root → hard error, not silent fallback
    rmSync(join(fake, 'routing'), { recursive: true, force: true })
    expect(() => resolveSdkEntrypoints(freshDir('plugindir2')))
      .toThrow(/does not contain a complete @makinbakin\/sdk/)
  })
})

describe('buildPluginWithSystemBun', () => {
  it('inlines the SDK into the server bundle and keeps it external in the client', async () => {
    const dir = seedPlugin()
    const result = await buildPluginWithSystemBun({ pluginDir: dir })

    expect(result.backend).toBe('system-bun')
    expect(result.builtServer).toBe(true)
    expect(result.builtClient).toBe(true)

    const server = readFileSync(join(dir, 'dist', 'index.js'), 'utf-8')
    expect(server).not.toContain('from "@makinbakin/sdk') // inlined
    expect(server).toContain('defineHookContract')          // SDK code present

    const client = readFileSync(join(dir, 'dist', 'client.js'), 'utf-8')
    expect(client).toContain('@makinbakin/sdk')              // stays external
  }, 30_000)

  it('builds server-only plugins without a client bundle', async () => {
    const dir = seedPlugin({ withClient: false })
    const result = await buildPluginWithSystemBun({ pluginDir: dir })
    expect(result.builtClient).toBe(false)
    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(dir, 'dist', 'client.js'))).toBe(false)
  }, 30_000)

  it('rejects server bundles that retain a runtime React import (#267 residual)', async () => {
    // /slots has RUNTIME react imports (Component, hooks). Inlining it into a
    // server bundle leaves `react` as a dangling external that only resolves
    // inside a repo checkout — binary installs die at activation. Fail the
    // build instead, with the offending specifier named.
    const dir = seedPlugin()
    writeFileSync(join(dir, 'index.ts'), [
      `import { registerSlot } from '@makinbakin/sdk/slots'`,
      `export default {`,
      `  id: 'demo', name: 'Demo', version: '0.1.0',`,
      `  activate() { void registerSlot },`,
      `}`,
      '',
    ].join('\n'))

    expect(buildPluginWithSystemBun({ pluginDir: dir })).rejects.toThrow(
      /retains host-provided browser externals: "react"/,
    )
    // The poisoned artifact must not be left behind for activation to trip on.
    await buildPluginWithSystemBun({ pluginDir: dir }).catch(() => {})
    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(false)
  }, 30_000)

  it('the SDK root barrel stays server-safe — inlines react-free (slots/registry split)', async () => {
    // Regression pin for the barrel: root → register → slots/registry must
    // never re-drag the <Slot> rendering layer (runtime react) into server
    // bundles. Runs via the system-bun subprocess path — in-process builds
    // can't read the barrel's zod dependency under the test harness.
    const dir = seedPlugin({ withClient: false })
    writeFileSync(join(dir, 'index.ts'), [
      `import { getNavBadge } from '@makinbakin/sdk'`,
      `export default { id: 'demo', name: 'Demo', version: '0.1.0', activate() { return getNavBadge('demo:x') } }`,
      '',
    ].join('\n'))

    const result = await buildPluginWithSystemBun({ pluginDir: dir })
    expect(result.builtServer).toBe(true)
    const server = readFileSync(join(dir, 'dist', 'index.js'), 'utf-8')
    expect(server).toContain('getNavBadge')
    expect(server).not.toMatch(/from\s+["']react/)
  }, 30_000)

  it('type-only react imports in the SDK root stay erased and build fine (control)', async () => {
    // seedPlugin's server entry imports the SDK root, whose only react
    // dependency is `import type { ComponentType }` — erased at build.
    const dir = seedPlugin()
    const result = await buildPluginWithSystemBun({ pluginDir: dir })
    expect(result.builtServer).toBe(true)
    const server = readFileSync(join(dir, 'dist', 'index.js'), 'utf-8')
    expect(server).not.toMatch(/from\s+["']react["']/)
  }, 30_000)

  it('installs declared deps with --ignore-scripts and bundles them into the server', async () => {
    // Offline file: dependency with a lifecycle script that must NOT run.
    const depDir = freshDir('dep')
    writeFileSync(join(depDir, 'package.json'), JSON.stringify({
      name: 'demo-dep', version: '1.0.0', main: 'index.js',
      scripts: { postinstall: `node -e "require('fs').writeFileSync('${join(depDir, 'POSTINSTALL_RAN')}', '1')"` },
    }))
    writeFileSync(join(depDir, 'index.js'), 'module.exports = { marker: "demo-dep-marker-value" }\n')

    const dir = seedPlugin({ withClient: false })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 'demo', version: '0.1.0',
      dependencies: { 'demo-dep': `file:${depDir}` },
    }))
    writeFileSync(join(dir, 'index.ts'), [
      `import dep from 'demo-dep'`,
      `export default { id: 'demo', activate() { return dep.marker } }`,
      '',
    ].join('\n'))

    const result = await buildPluginWithSystemBun({ pluginDir: dir, installDeps: true })
    expect(result.installedDeps).toBe(true)
    const server = readFileSync(join(dir, 'dist', 'index.js'), 'utf-8')
    expect(server).toContain('demo-dep-marker-value') // dep bundled in
    expect(existsSync(join(depDir, 'POSTINSTALL_RAN'))).toBe(false) // scripts withheld
  }, 30_000)

  it('rejects undeclared imports before building anything', async () => {
    const dir = seedPlugin({ withClient: false })
    writeFileSync(join(dir, 'index.ts'), [
      `import _ from 'undeclared-package'`,
      `export default { id: 'demo', activate() {} }`,
      '',
    ].join('\n'))
    expect(buildPluginWithSystemBun({ pluginDir: dir })).rejects.toThrow(/not declared in package.json/)
    expect(existsSync(join(dir, 'dist'))).toBe(false)
  })

  it('surfaces server compile errors as stage-tagged failures with stderr detail', async () => {
    const dir = seedPlugin({ withClient: false })
    writeFileSync(join(dir, 'index.ts'), `import { missing } from './does-not-exist'\nexport default missing\n`)
    try {
      await buildPluginWithSystemBun({ pluginDir: dir })
      throw new Error('expected build to fail')
    } catch (err) {
      expect(err).toBeInstanceOf(WhiskitBuildError)
      expect((err as WhiskitBuildError).stage).toBe('server-build')
      expect((err as WhiskitBuildError).message).toContain('does-not-exist')
    }
  }, 30_000)
})

describe('buildPluginInProcess (dev fast path)', () => {
  it('rejects server bundles that retain a runtime React import (#267 residual)', async () => {
    const dir = seedPlugin()
    writeFileSync(join(dir, 'index.ts'), [
      `import { registerSlot } from '@makinbakin/sdk/slots'`,
      `export default { id: 'demo', name: 'Demo', version: '0.1.0', activate() { void registerSlot } }`,
      '',
    ].join('\n'))

    expect(buildPluginInProcess({ pluginDir: dir })).rejects.toThrow(
      /retains host-provided browser externals: "react"/,
    )
  }, 30_000)


  it('is available from a source run', () => {
    expect(canBuildInProcess()).toBe(true)
  })

  it('produces the same bundle shape as the system-bun backend', async () => {
    const dir = seedPlugin()
    const result = await buildPluginInProcess({ pluginDir: dir })
    expect(result.backend).toBe('in-process')

    const server = readFileSync(join(dir, 'dist', 'index.js'), 'utf-8')
    expect(server).not.toContain('from "@makinbakin/sdk')
    expect(server).toContain('defineHookContract')
    const client = readFileSync(join(dir, 'dist', 'client.js'), 'utf-8')
    expect(client).toContain('@makinbakin/sdk')
  }, 30_000)
})
