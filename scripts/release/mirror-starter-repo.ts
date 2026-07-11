/**
 * Mirror examples/reference-plugin/ into the public starter repo
 * (markhayden/bakin-plugin-starter) at release time.
 *
 * The script is the PURE half: it stages a verbatim copy of the example into
 * a target directory (the workflow's clone of the starter repo), rewrites the
 * `@makinbakin/sdk` dependency from the in-repo `latest`/`workspace:`/`file:`
 * form to the released `^<version>`, and prepends a starter header to the
 * README. Cloning, committing, and pushing stay in the release workflow
 * (same split as update-homebrew-formula.ts / the tap-publish step).
 *
 * Fail-soft is the WORKFLOW's job (a missing starter repo must never break a
 * release); this script fails loud on bad inputs so the dry-run test and the
 * workflow both surface real staging problems.
 *
 * Usage:
 *   bun run scripts/release/mirror-starter-repo.ts \
 *     --version 0.7.0 --target /tmp/starter-clone [--source examples/reference-plugin]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

interface MirrorOptions {
  source: string
  target: string
  version: string
}

const STARTER_HEADER = (version: string) => `<!-- mirrored from markhayden/bakin examples/reference-plugin — do not edit here; changes land upstream -->

> **This is the Bakin plugin starter.** Fork it (or "Use this template") to
> build your own plugin, then follow the authoring docs:
> https://makinbakin.com/docs/extending/plugins/overview/
> Mirrored automatically from the Bakin repo at release \`v${version}\`.

`

/** Stage the starter copy into `target`. Preserves target/.git; replaces everything else. */
export function mirrorStarter(opts: MirrorOptions): { staged: string[] } {
  const source = resolve(opts.source)
  const target = resolve(opts.target)
  if (!existsSync(join(source, 'bakin-plugin.json'))) {
    throw new Error(`source ${source} is not a plugin directory (no bakin-plugin.json)`)
  }
  if (!/^\d+\.\d+\.\d+$/.test(opts.version)) {
    throw new Error(`--version must be a stable x.y.z version (got '${opts.version}') — the mirror only runs on stable releases`)
  }

  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(target)) {
    if (entry === '.git') continue
    rmSync(join(target, entry), { recursive: true, force: true })
  }
  cpSync(source, target, {
    recursive: true,
    filter: (src) => !src.includes('node_modules') && !src.includes('/dist') && !src.endsWith('.installedBy'),
  })

  // Rewrite the SDK dep to the released version. The example intentionally
  // declares `latest` (dev-source hosts can't resolve a real range); the
  // starter must pin to the release that mirrored it.
  const pkgPath = join(target, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    private?: boolean
  }
  for (const bucket of [pkg.dependencies, pkg.devDependencies]) {
    if (bucket?.['@makinbakin/sdk'] !== undefined) bucket['@makinbakin/sdk'] = `^${opts.version}`
  }
  delete pkg.private
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

  // No repo-internal dependency forms may leak into the public starter.
  const rendered = readFileSync(pkgPath, 'utf-8')
  if (/workspace:|file:/.test(rendered)) {
    throw new Error(`staged package.json still carries a repo-internal dependency form:\n${rendered}`)
  }

  // Starter framing on top of the example's own README.
  const readmePath = join(target, 'README.md')
  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf-8') : ''
  writeFileSync(readmePath, `${STARTER_HEADER(opts.version)}${readme}`)

  return { staged: readdirSync(target).filter((e) => e !== '.git').sort() }
}

function parseArgs(argv: string[]): MirrorOptions & { dryRun: boolean } {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const version = get('--version')
  const target = get('--target')
  if (!version || !target) {
    console.error('usage: mirror-starter-repo.ts --version <x.y.z> --target <dir> [--source <dir>] [--dry-run]')
    process.exit(2)
  }
  return {
    version,
    target,
    source: get('--source') ?? 'examples/reference-plugin',
    dryRun: argv.includes('--dry-run'),
  }
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2))
  const { staged } = mirrorStarter(opts)
  console.log(`${opts.dryRun ? '[dry-run] ' : ''}staged ${staged.length} entries into ${opts.target}: ${staged.join(', ')}`)
}
