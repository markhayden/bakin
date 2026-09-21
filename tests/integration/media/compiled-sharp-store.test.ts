/**
 * Compile-and-run regression for the media store (#889), per the #886
 * pattern (tests/adapter-pi/compiled-oauth-static.test.ts): compile real
 * fixtures with `bun build --compile`, run the produced binaries, assert on
 * their stdout.
 *
 * The store is staged from the REPO'S OWN node_modules (no network): on
 * darwin CI/local this exercises the darwin rpath placement, on linux CI the
 * $ORIGIN RUNPATH placement — the leg no darwin spike can prove.
 *
 * No content-dir mocks needed: the fixtures run as SEPARATE processes with
 * BAKIN_HOME pointed at a temp dir; this test file itself never imports
 * server-reachable code.
 */
import { afterAll, describe, expect, it } from 'bun:test'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..')
const FIXTURES = join(REPO_ROOT, 'tests', 'fixtures', 'media')
const testDir = join(tmpdir(), `bakin-test-compiled-sharp-${Date.now()}-${Math.random().toString(16).slice(2)}`)

const platformKey = process.platform === 'darwin' && process.arch === 'arm64'
  ? 'darwin-arm64'
  : process.platform === 'linux' && process.arch === 'x64'
    ? 'linux-x64'
    : process.platform === 'linux' && process.arch === 'arm64'
      ? 'linux-arm64'
      : null
if (!platformKey) throw new Error(`unsupported test platform ${process.platform}-${process.arch}`)

/** Package root of a module resolved FROM sharp's real dir (correct versions). */
function packageRoot(entryFile: string): string {
  let dir = dirname(entryFile)
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no package.json above ${entryFile}`)
    dir = parent
  }
  return dir
}

/**
 * Stage the pinned-tarball node_modules layout from the repo's own installed
 * packages. Symlinks (bun's .bun store) are DEREFERENCED — a dangling
 * symlink copy cost the spike an hour.
 */
function stageNodeModules(dest: string): void {
  const sharpReal = realpathSync(join(REPO_ROOT, 'node_modules', 'sharp'))
  cpSync(sharpReal, join(dest, 'sharp'), { recursive: true, dereference: true })
  for (const dep of ['detect-libc', 'semver', '@img/colour']) {
    const entry = (Bun as unknown as { resolveSync(spec: string, from: string): string }).resolveSync(dep, sharpReal)
    cpSync(packageRoot(entry), join(dest, dep), { recursive: true, dereference: true })
  }
  for (const native of [`@img/sharp-${platformKey}`, `@img/sharp-libvips-${platformKey}`]) {
    const real = realpathSync(join(REPO_ROOT, 'node_modules', '.bun', 'node_modules', native))
    cpSync(real, join(dest, native), { recursive: true, dereference: true })
  }
}

async function compileFixture(entry: string, outName: string, opts: { externalSharp: boolean }): Promise<string> {
  const outfile = join(testDir, outName)
  const args = ['bun', 'build', '--compile', `--outfile=${outfile}`]
  if (opts.externalSharp) args.push('--external', 'sharp')
  args.push(join(FIXTURES, entry))
  const proc = Bun.spawn(args, { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`compile of ${entry} failed (exit ${code}): ${err.slice(-800)}`)
  }
  return outfile
}

async function run(binary: string, env: Record<string, string>, cwd: string): Promise<string> {
  const proc = Bun.spawn([binary], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  await proc.exited
  return (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text())
}

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('compiled media store', () => {
  it('a compiled binary installs the store (real Bun.build + probe) and resizes through the loader', async () => {
    const staged = join(testDir, 'staged-node-modules')
    stageNodeModules(staged)

    const binary = await compileFixture('compiled-store-entry.ts', 'store-entry-bin', { externalSharp: true })
    const home = join(testDir, 'bakin-home')
    mkdirSync(home, { recursive: true })
    const output = await run(binary, { BAKIN_HOME: home, STAGED_NODE_MODULES: staged }, testDir)

    expect(output).toContain('STORE INSTALL OK')
    expect(output).toContain('LOADER OK')
    expect(output).toContain('METADATA: 1x1 png')
    expect(output).toMatch(/RESIZED OK: \d+ bytes/)
  }, 120_000)

  it('TEETH: the bare sharp import stays broken in compiled binaries (premise pin)', async () => {
    // Compiled WITHOUT the external, run from a cwd with no node_modules. If
    // this starts passing pixels, bun learned to embed sharp's natives — the
    // media store machinery is obsolete; delete it (#889).
    const binary = await compileFixture('compiled-bundled-import.ts', 'teeth-bin', { externalSharp: false })
    const emptyCwd = join(testDir, 'empty-cwd')
    mkdirSync(emptyCwd, { recursive: true })
    const output = await run(binary, {}, emptyCwd)

    expect(output).toContain('FAILED:')
    expect(output).not.toContain('BUNDLED IMPORT OK')
  }, 120_000)

  it('source pin: the production compile keeps sharp external', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts', 'build-binary.ts'), 'utf-8')
    expect(source).toContain("const EXTERNAL_NATIVE_MEDIA = ['sharp']")
    expect(source).toContain('EXTERNAL_NATIVE_MEDIA].flatMap')
  })
})
