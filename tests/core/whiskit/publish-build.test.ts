/**
 * `bakin plugins publish --build` (Phase 2 wiring): the CLI compiles an
 * UNBUILT plugin via the Whiskit system-bun backend before assembling the
 * artifact. Runs the real CLI as a subprocess with isolated homes — purely
 * local, no server, no network. Mandatory isolation mocks per project rule.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { spawnSync } from 'child_process'

const mockDir = join(tmpdir(), `whiskit-publish-build-mock-${Date.now()}-${randomUUID()}`)
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

const REPO_ROOT = resolve(import.meta.dir, '../../..')
const CLI = join(REPO_ROOT, 'cli', 'bakin.ts')

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function freshDir(prefix: string): string {
  const d = join(tmpdir(), `whiskit-${prefix}-${Date.now()}-${randomUUID()}`)
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

function seedUnbuiltPlugin(): string {
  const dir = freshDir('pub-src')
  writeFileSync(join(dir, 'bakin-plugin.json'), JSON.stringify({
    id: 'pubdemo', name: 'Pub Demo', version: '0.2.0', bakin: '>=0.0.1',
    description: 'publish --build fixture', entry: { server: 'index.ts', client: 'client.tsx' },
  }))
  writeFileSync(join(dir, 'index.ts'), [
    `import { getRegistryVersion } from '@makinbakin/sdk'`,
    `export default { id: 'pubdemo', name: 'Pub Demo', version: '0.2.0', activate() { return getRegistryVersion() } }`,
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'client.tsx'), [
    `import { registerPlugin } from '@makinbakin/sdk'`,
    `registerPlugin({ id: 'pubdemo', slots: {} })`,
    '',
  ].join('\n'))
  return dir
}

function runPublish(pluginDir: string, outDir: string, extra: string[] = []): { exitCode: number; output: string } {
  const home = freshDir('pub-home')
  const result = spawnSync('bun', [CLI, 'plugins', 'publish', pluginDir, '--out', outDir, ...extra], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      BAKIN_HOME: home,
      OPENCLAW_HOME: join(home, 'openclaw'),
      NO_COLOR: '1',
    },
    encoding: 'utf-8',
    timeout: 120_000,
  })
  return {
    exitCode: result.status ?? -1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

describe('bakin plugins publish --build', () => {
  it('builds an unbuilt plugin and assembles a checksummed artifact', () => {
    const pluginDir = seedUnbuiltPlugin()
    const outDir = freshDir('pub-out')
    expect(existsSync(join(pluginDir, 'dist'))).toBe(false)

    const { exitCode, output } = runPublish(pluginDir, outDir, ['--build'])
    expect(output).toContain('Built pubdemo')
    expect(output).toContain('Published pubdemo@0.2.0')
    expect(exitCode).toBe(0)

    // dist produced with the proven externals strategy
    const server = readFileSync(join(pluginDir, 'dist', 'index.js'), 'utf-8')
    expect(server).not.toContain('from "@makinbakin/sdk"')
    const client = readFileSync(join(pluginDir, 'dist', 'client.js'), 'utf-8')
    expect(client).toContain('@makinbakin/sdk')

    // artifact + sidecar checksum + carried-forward index
    const artifact = join(outDir, 'pubdemo-0.2.0-neutral.tar.gz')
    expect(existsSync(artifact)).toBe(true)
    expect(existsSync(`${artifact}.sha256`)).toBe(true)
    const index = JSON.parse(readFileSync(join(outDir, 'whiskit-artifacts.json'), 'utf-8')) as {
      plugins?: Record<string, unknown>
    }
    expect(JSON.stringify(index)).toContain('pubdemo')
  }, 120_000)

  it('still refuses an unbuilt plugin without --build, pointing at the flag', () => {
    const pluginDir = seedUnbuiltPlugin()
    const outDir = freshDir('pub-out')
    const { exitCode, output } = runPublish(pluginDir, outDir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('--build')
    expect(existsSync(join(outDir, 'pubdemo-0.2.0-neutral.tar.gz'))).toBe(false)
  }, 120_000)

  it('fails with a stage-tagged error when the source does not compile', () => {
    const pluginDir = seedUnbuiltPlugin()
    writeFileSync(join(pluginDir, 'index.ts'), `import { nope } from './missing'\nexport default nope\n`)
    const outDir = freshDir('pub-out')
    const { exitCode, output } = runPublish(pluginDir, outDir, ['--build'])
    expect(exitCode).not.toBe(0)
    expect(output).toContain('Build failed')
    expect(output).toContain('server-build')
  }, 120_000)
})
