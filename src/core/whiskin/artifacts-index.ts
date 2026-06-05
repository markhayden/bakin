/**
 * `whiskin-artifacts.json` — the per-release catalog a plugin repo attaches to
 * each GitHub release (Open Q3). It maps pluginId → version → platform → a
 * verified artifact location, so a consumer can resolve "latest" (or a pinned
 * version) for its platform via the stable releases/latest/download redirect.
 *
 * Each release's index is immutable; entries carry ABSOLUTE artifact URLs so an
 * entry may point at a tarball attached to an older release. On publish the new
 * index is built by CARRYING FORWARD the previous latest index's entries for
 * plugins that weren't rebuilt (mergeArtifactsIndex), which is what lets plugins
 * in a monorepo release independently while each index stays a complete catalog.
 *
 * Part of the Whiskin artifact format (Phase 3).
 */
import { readFileSync } from 'fs'
import { z } from 'zod'
import { atomicWriteJson } from '@bakin/core/install-core/atomic-write'

export const ARTIFACTS_INDEX_VERSION = 1
export const INDEX_FILENAME = 'whiskin-artifacts.json'
/** Platform key for a single platform-neutral (pure-JS) artifact. */
export const NEUTRAL_PLATFORM = 'neutral'

const ArtifactEntrySchema = z.object({
  /** Absolute URL of the artifact tarball (may point at an older release). */
  url: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  externalsContract: z.string().min(1),
  bakinRange: z.string().min(1),
})

const VersionEntrySchema = z.object({
  /** Keyed by platform (e.g. "darwin-arm64") or NEUTRAL_PLATFORM. */
  platforms: z.record(z.string(), ArtifactEntrySchema),
})

const PluginIndexSchema = z.object({
  /** The newest version present for this plugin in this index. */
  latest: z.string().min(1),
  versions: z.record(z.string(), VersionEntrySchema),
})

export const ArtifactsIndexSchema = z.object({
  version: z.literal(ARTIFACTS_INDEX_VERSION),
  plugins: z.record(z.string(), PluginIndexSchema),
})

export type ArtifactEntry = z.infer<typeof ArtifactEntrySchema>
export type ArtifactsIndex = z.infer<typeof ArtifactsIndexSchema>

export function parseArtifactsIndex(raw: unknown): ArtifactsIndex {
  return ArtifactsIndexSchema.parse(raw)
}

export function readArtifactsIndex(path: string): ArtifactsIndex {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    throw new Error(
      `whiskin-artifacts.json at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return parseArtifactsIndex(parsed)
}

export function writeArtifactsIndex(path: string, index: ArtifactsIndex): void {
  atomicWriteJson(path, ArtifactsIndexSchema.parse(index))
}

/**
 * Resolve the artifact for `pluginId` at `version` ('latest' or an exact
 * semver) for `platform`. Falls back to a platform-neutral entry. Returns null
 * when nothing matches.
 */
export function resolveArtifact(
  index: ArtifactsIndex,
  pluginId: string,
  version: string,
  platform: string,
): ArtifactEntry | null {
  const plugin = index.plugins[pluginId]
  if (!plugin) return null
  const resolvedVersion = version === 'latest' ? plugin.latest : version
  const versionEntry = plugin.versions[resolvedVersion]
  if (!versionEntry) return null
  return versionEntry.platforms[platform] ?? versionEntry.platforms[NEUTRAL_PLATFORM] ?? null
}

/**
 * Build the next index by overlaying `incoming` (this release's freshly-built
 * plugins) onto `previous` (the prior latest index). Plugins absent from
 * `incoming` are carried forward unchanged; for plugins present in both, the
 * version maps merge (incoming wins on conflict) and `latest` takes incoming's
 * value (the just-published version).
 */
export function mergeArtifactsIndex(
  previous: ArtifactsIndex,
  incoming: ArtifactsIndex,
): ArtifactsIndex {
  const plugins: ArtifactsIndex['plugins'] = { ...previous.plugins }
  for (const [id, idx] of Object.entries(incoming.plugins)) {
    const prev = plugins[id]
    plugins[id] = {
      latest: idx.latest,
      versions: { ...(prev?.versions ?? {}), ...idx.versions },
    }
  }
  return { version: ARTIFACTS_INDEX_VERSION, plugins }
}

/** An empty index — the seed for a repo's first release. */
export function emptyArtifactsIndex(): ArtifactsIndex {
  return { version: ARTIFACTS_INDEX_VERSION, plugins: {} }
}
