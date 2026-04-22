/**
 * Cross-platform binary build (#147 TG1).
 *
 * For each supported target triple, runs `bun build --compile` on
 * server.ts and writes to dist/bakin-<platform>-<arch>. The embedded-
 * assets manifest (_embedded-assets.ts) must be regenerated immediately
 * beforehand so Bun's --compile picks up the most recent dist/ + public/
 * + plugins/<id>/dist trees.
 *
 * Prerequisites (chained by the "build" script in package.json):
 *   bun run build:vendors && bun run build:plugins && bun run build:host-shell
 *
 * Acceptance (from spec):
 *   - Produces 3 files under dist/ each well under 120 MB.
 *   - ./dist/bakin-darwin-arm64 version prints a version string.
 *   - ./dist/bakin-darwin-arm64 start boots + serves /api/plugins/manifest
 *     on a fresh BAKIN_HOME.
 */
import { mkdirSync, statSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '..')
const DIST_DIR = join(REPO_ROOT, 'dist')

interface Target {
  /** Bun --target triple. */
  triple: 'bun-darwin-arm64' | 'bun-linux-x64' | 'bun-linux-arm64'
  /** Output filename (relative to dist/). */
  outName: string
}

const TARGETS: Target[] = [
  { triple: 'bun-darwin-arm64', outName: 'bakin-darwin-arm64' },
  { triple: 'bun-linux-x64', outName: 'bakin-linux-x64' },
  { triple: 'bun-linux-arm64', outName: 'bakin-linux-arm64' },
]

async function regenerateEmbeddedManifest(): Promise<void> {
  const proc = Bun.spawn(['bun', 'run', join(REPO_ROOT, 'scripts/generate-embedded-assets.ts')], {
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) throw new Error('generate-embedded-assets failed')
}

async function compile(target: Target): Promise<void> {
  const outfile = join(DIST_DIR, target.outName)
  // --compile expects one entry module.
  const proc = Bun.spawn([
    'bun', 'build',
    '--compile',
    `--target=${target.triple}`,
    `--outfile=${outfile}`,
    join(REPO_ROOT, 'server.ts'),
  ], {
    cwd: REPO_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`bun build --compile failed for ${target.triple} (exit ${code})`)
  }
  if (!existsSync(outfile)) {
    throw new Error(`bun build --compile produced no file for ${target.triple}`)
  }
}

function humanSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

async function main(): Promise<void> {
  rmSync(DIST_DIR, { recursive: true, force: true })
  mkdirSync(DIST_DIR, { recursive: true })

  console.log('Regenerating embedded-assets manifest...')
  await regenerateEmbeddedManifest()

  const results: { target: Target; size: number }[] = []
  for (const target of TARGETS) {
    console.log(`\nCompiling ${target.triple} → dist/${target.outName}`)
    await compile(target)
    const size = statSync(join(DIST_DIR, target.outName)).size
    results.push({ target, size })
  }

  console.log('\nBuilt binaries:')
  for (const r of results) {
    console.log(`  dist/${r.target.outName.padEnd(24)} ${humanSize(r.size)}`)
  }
}

await main()

export {}
