/**
 * Compiled-binary OAuth regression: pi-ai loads its OAuth flow modules via
 * bundler-opaque dynamic imports, which fail inside `bun build --compile`
 * binaries ("Cannot find module './openai-codex.js' from '/$bunfs/root/…'")
 * — on rc.30 this killed EVERY Pi turn on a compiled install. The fix is
 * the adapter's static registration (src/bun-static-modules.ts, mirroring
 * the SDK's own dist/bun/runtime-setup.js).
 *
 * These tests compile real binaries from fixtures and run them:
 *   1. WITH registration → derivation succeeds.
 *   2. WITHOUT registration → still fails (teeth: if this starts passing,
 *      the SDK/bun fixed the underlying limitation and the workaround
 *      should be re-evaluated).
 *   3. The adapter entry actually wires the registration (source pin).
 *
 * No content-dir/PI_HOME mocks needed: the fixtures take an explicit
 * PI_AUTH_DIR temp dir and never touch ~/.bakin or ~/.pi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const repoRoot = join(import.meta.dir, '..', '..')
const fixtureDir = join(repoRoot, 'packages', 'adapter-pi', 'test-fixtures', 'compiled-oauth')
const workDir = join(tmpdir(), `bakin-test-compiled-oauth-${Date.now()}-${randomUUID()}`)
const authDir = join(workDir, 'auth')

beforeAll(() => {
  mkdirSync(authDir, { recursive: true })
  writeFileSync(join(authDir, 'auth.json'), JSON.stringify({
    'openai-codex': { type: 'oauth', access: 'fake-token', refresh: 'fake-refresh', expires: Date.now() + 3_600_000 },
  }))
})

afterAll(() => rmSync(workDir, { recursive: true, force: true }))

async function compileAndRun(entry: string, outName: string): Promise<string> {
  const outfile = join(workDir, outName)
  const build = Bun.spawn(['bun', 'build', '--compile', join(fixtureDir, entry), '--outfile', outfile], {
    cwd: repoRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const buildExit = await build.exited
  if (buildExit !== 0) {
    throw new Error(`compile failed: ${await new Response(build.stderr).text()}`)
  }
  const run = Bun.spawn([outfile], {
    env: { ...process.env, PI_AUTH_DIR: authDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await run.exited
  return `${await new Response(run.stdout).text()}${await new Response(run.stderr).text()}`
}

describe('compiled-binary pi OAuth (bun-static-modules)', () => {
  it('derives codex OAuth inside a compiled binary WITH the static registration', async () => {
    const output = await compileAndRun('entry-registered.ts', 'bin-registered')
    expect(output).toContain('AUTH RESULT: OAuth')
  }, 30_000)

  it('TEETH: still fails without the registration — if this passes, the workaround is obsolete', async () => {
    const output = await compileAndRun('entry-unregistered.ts', 'bin-unregistered')
    expect(output).toContain('FAILED:')
    expect(output).toContain("Cannot find module './openai-codex.js'")
  }, 30_000)

  it('the adapter entry wires the registration as a side-effect import', () => {
    const source = readFileSync(join(repoRoot, 'packages', 'adapter-pi', 'src', 'index.ts'), 'utf-8')
    expect(source).toContain("import './bun-static-modules'")
  })
})
