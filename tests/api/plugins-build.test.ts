/**
 * Tests for the in-binary user plugin builder (#147 TE14).
 *
 * Copies tests/fixtures/sample-user-plugin/ into an isolated temp dir,
 * invokes buildUserPlugin(), and asserts:
 *   1. dist/index.js + dist/client.js appear
 *   2. client output retains unresolved imports for the shell's externals
 *      (`react`, `react/jsx-runtime`, `@makinbakin/sdk/*`)
 *   3. server output bundles SDK imports so runtime activation does not
 *      depend on plugin-local SDK symlinks.
 *
 * Per CLAUDE.md testing rules, getContentDir is mocked to a temp dir so
 * nothing leaks into ~/.bakin/ even though buildUserPlugin operates on
 * explicit paths. Logger is mocked for noise suppression.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

const testDir = (() => {
  const { join } = require('path')
  const { tmpdir } = require('os')
  return join(tmpdir(), `bakin-test-plugin-build-${Date.now()}`)
})()

// ES imports are hoisted above mock.module — set env so the content-dir
// guard doesn't trip when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import { buildUserPlugin } from '../../packages/host/src/plugin-host/user-plugin-builder'

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'sample-user-plugin')
const targetDir = join(testDir, 'plugins', 'sample')

function writeMinimalPlugin(dir: string, source: string, packageJson?: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({
    id: 'minimal',
    name: 'Minimal',
    version: '0.1.0',
    bakin: '>=0.0.0-dev',
    description: 'Minimal test plugin',
    entry: { server: 'index.ts' },
  }))
  writeFileSync(join(dir, 'index.ts'), source)
  if (packageJson) writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2))
}

beforeAll(() => {
  mkdirSync(targetDir, { recursive: true })
  cpSync(FIXTURE_DIR, targetDir, { recursive: true })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('buildUserPlugin', () => {
  it('produces dist/index.js and dist/client.js', async () => {
    await buildUserPlugin(targetDir)
    expect(existsSync(join(targetDir, 'dist', 'index.js'))).toBe(true)
    expect(existsSync(join(targetDir, 'dist', 'client.js'))).toBe(true)
  }, 60_000)

  it('preserves externals for @makinbakin/sdk/* in client.js', () => {
    const client = readFileSync(join(targetDir, 'dist', 'client.js'), 'utf-8')
    // The `@makinbakin/sdk/slots` import must survive so the runtime loader can
    // resolve it via the browser import map (not get bundled into client.js).
    expect(client).toMatch(/from\s+["']@makinbakin\/sdk\/slots["']/)
  }, 60_000)

  it('preserves externals for react + react/jsx-runtime in client.js', () => {
    const client = readFileSync(join(targetDir, 'dist', 'client.js'), 'utf-8')
    // React hooks must stay external — plugins share the shell's React via
    // the import map. Bundling react would break hooks dispatcher identity.
    expect(client).toMatch(/from\s+["']react["']/)
    // The JSX runtime must also stay external.
    expect(client).toMatch(/from\s+["']react\/jsx-runtime["']/)
  }, 60_000)

  it('does not bundle react into dist/client.js', () => {
    // A real-size React bundle is > 100 KB. If our externals list failed,
    // client.js would balloon. The fixture client is trivially small, so
    // the absence of React's internal sentinels confirms externals held.
    const client = readFileSync(join(targetDir, 'dist', 'client.js'), 'utf-8')
    expect(client).not.toMatch(/React\.createElement\s*=\s*function/)
    expect(client).not.toMatch(/__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/)
  }, 60_000)

  it('bundles SDK imports into dist/index.js for runtime activation', () => {
    const server = readFileSync(join(targetDir, 'dist', 'index.js'), 'utf-8')
    expect(server).not.toMatch(/from\s+["']@makinbakin\/sdk/)
    expect(server).not.toMatch(/import\(["']@makinbakin\/sdk/)
  }, 60_000)

  it('rejects old SDK imports before building', async () => {
    const dir = join(testDir, 'plugins', 'old-sdk')
    const oldSdk = '@bakin' + '/sdk/utils'
    writeMinimalPlugin(dir, `import { cn } from '${oldSdk}'; export default { id: 'minimal', name: cn('x'), version: '0.1.0', activate() {} }`)

    await expect(buildUserPlugin(dir)).rejects.toThrow(/no longer supported/)
  })

  it('rejects app and Bakin internal imports before building', async () => {
    const dir = join(testDir, 'plugins', 'internal-import')
    writeMinimalPlugin(dir, `import { readPluginLockfile } from '@bakin/core/plugins/lockfile'; export default { id: 'minimal', name: 'x', version: '0.1.0', activate() { readPluginLockfile() } }`)

    await expect(buildUserPlugin(dir)).rejects.toThrow(/imports Bakin internals/)
  })

  it('rejects undeclared third-party imports before building', async () => {
    const dir = join(testDir, 'plugins', 'undeclared')
    writeMinimalPlugin(dir, `import { z } from 'zod'; export default { id: 'minimal', name: 'x', version: '0.1.0', activate() { z.string() } }`)

    await expect(buildUserPlugin(dir)).rejects.toThrow(/not declared/)
  })

  it('ignores test-only imports during runtime dependency validation', async () => {
    const dir = join(testDir, 'plugins', 'test-only-import')
    writeMinimalPlugin(dir, `export default { id: 'minimal', name: 'x', version: '0.1.0', activate() {} }`)
    mkdirSync(join(dir, 'tests'), { recursive: true })
    writeFileSync(join(dir, 'tests', 'component.test.tsx'), `import { render } from '@testing-library/react'; render(null)`)

    await expect(buildUserPlugin(dir)).resolves.toBeUndefined()
    expect(existsSync(join(dir, 'dist', 'index.js'))).toBe(true)
  }, 60_000)
})
