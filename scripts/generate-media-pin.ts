/**
 * Regenerate the sharp prebuild pin (packages/core/src/media/pin-data.ts).
 *
 * Resolves the FULL tarball set for one sharp version from the npm registry —
 * sharp's own runtime deps at their max-satisfying versions (NEVER the repo's
 * hoisted copies: the #889 spike shipped a wrong semver exactly that way) plus
 * the per-platform native packages at the libvips version sharp itself pins —
 * downloads every tarball, computes sha256 (the registry only serves
 * sha1/sha512), and emits the generated pin module.
 *
 * Usage:
 *   bun scripts/generate-media-pin.ts [--sharp-version 0.34.5] [--check]
 *
 * --check regenerates in memory and exits 1 on drift against the committed
 * file (manual/network — never wired into the test suite).
 *
 * Pin-bump runbook: .claude/knowledge/media-pipeline.md
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'

const REGISTRY = 'https://registry.npmjs.org'
const PLATFORM_KEYS = ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const
const OUT_PATH = join(import.meta.dir, '..', 'packages', 'core', 'src', 'media', 'pin-data.ts')

interface RegistryVersion {
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dist: { tarball: string }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

/** Highest version in the packument satisfying a caret/exact range (Bun.semver). */
async function resolveVersion(name: string, range: string): Promise<RegistryVersion> {
  const packument = await fetchJson<{ versions: Record<string, RegistryVersion> }>(
    `${REGISTRY}/${name.replace('/', '%2f')}`,
  )
  const semver = (Bun as unknown as { semver: { satisfies(v: string, r: string): boolean; order(a: string, b: string): number } }).semver
  const matching = Object.keys(packument.versions)
    .filter((v) => semver.satisfies(v, range))
    .sort((a, b) => semver.order(a, b))
  const picked = matching.at(-1)
  if (!picked) throw new Error(`no version of ${name} satisfies "${range}"`)
  return packument.versions[picked]!
}

async function pinTarball(name: string, meta: RegistryVersion): Promise<{ name: string; version: string; url: string; sha256: string }> {
  const res = await fetch(meta.dist.tarball, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${meta.dist.tarball} → ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  console.log(`  ${name}@${meta.version}  ${(bytes.length / 1024 / 1024).toFixed(1)} MB  ${sha256.slice(0, 12)}…`)
  return { name, version: meta.version, url: meta.dist.tarball, sha256 }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const versionFlag = args.indexOf('--sharp-version')
  const sharpRange = versionFlag >= 0 ? args[versionFlag + 1]! : readCommittedSharpVersion()

  console.log(`Resolving sharp ${sharpRange} …`)
  const sharp = await resolveVersion('sharp', sharpRange)

  // Shared JS deps: resolved from SHARP's manifest, not the repo tree.
  const shared = [await pinTarball('sharp', sharp)]
  for (const [dep, range] of Object.entries(sharp.dependencies ?? {})) {
    shared.push(await pinTarball(dep, await resolveVersion(dep, range)))
  }

  // Per-platform natives: sharp pins the native range; the native package
  // pins its exact libvips sibling.
  const platform: Record<string, { name: string; version: string; url: string; sha256: string }[]> = {}
  for (const key of PLATFORM_KEYS) {
    console.log(`Platform ${key} …`)
    const nativeName = `@img/sharp-${key}`
    const nativeRange = sharp.optionalDependencies?.[nativeName]
    if (!nativeRange) throw new Error(`sharp ${sharp.version} has no optionalDependency on ${nativeName}`)
    const native = await resolveVersion(nativeName, nativeRange)
    const libvipsName = `@img/sharp-libvips-${key}`
    const libvipsRange = native.optionalDependencies?.[libvipsName]
    if (!libvipsRange) throw new Error(`${nativeName} ${native.version} has no optionalDependency on ${libvipsName}`)
    const libvips = await resolveVersion(libvipsName, libvipsRange)
    platform[key] = [await pinTarball(nativeName, native), await pinTarball(libvipsName, libvips)]
  }

  const generated = render(sharp.version, shared, platform)
  if (check) {
    const committed = readFileSync(OUT_PATH, 'utf-8')
    if (committed !== generated) {
      console.error('DRIFT: committed pin-data.ts does not match a fresh regeneration')
      process.exit(1)
    }
    console.log('pin-data.ts matches a fresh regeneration')
    return
  }
  writeFileSync(OUT_PATH, generated, 'utf-8')
  console.log(`Wrote ${OUT_PATH}`)
}

function readCommittedSharpVersion(): string {
  const committed = readFileSync(OUT_PATH, 'utf-8')
  const match = committed.match(/version: '([^']+)'/)
  if (!match) throw new Error('cannot read committed sharp version — pass --sharp-version')
  return match[1]!
}

function render(
  version: string,
  shared: { name: string; version: string; url: string; sha256: string }[],
  platform: Record<string, { name: string; version: string; url: string; sha256: string }[]>,
): string {
  const tarball = (t: { name: string; version: string; url: string; sha256: string }) =>
    `    { name: '${t.name}', version: '${t.version}', url: '${t.url}', sha256: '${t.sha256}' },`
  const platformBlock = PLATFORM_KEYS
    .map((key) => `  '${key}': [\n${platform[key]!.map(tarball).join('\n')}\n  ],`)
    .join('\n')
  return `/**
 * GENERATED by scripts/generate-media-pin.ts — do not edit by hand.
 * Regenerate: bun scripts/generate-media-pin.ts --sharp-version <v>
 * Pin-bump runbook: .claude/knowledge/media-pipeline.md
 */
import type { MediaPlatformKey, PinnedTarball } from './pin'

export const SHARP_PIN_DATA: { version: string; shared: PinnedTarball[]; platform: Record<MediaPlatformKey, PinnedTarball[]> } = {
  version: '${version}',
  shared: [
${shared.map(tarball).join('\n')}
  ],
  platform: {
${platformBlock}
  },
}
`
}

await main()
