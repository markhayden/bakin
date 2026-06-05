/**
 * Whiskit publish core — turn a BUILT plugin directory into a published
 * artifact: stamp provenance, stage only the artifact entries, assemble the
 * tarball + checksum, and produce the whiskit-artifacts.json index entry.
 *
 * This is the orchestration the `bakin plugins publish` command and the reusable
 * GitHub Action drive (Phase 4). It assumes the plugin is already built (dist/
 * present) — building is the build backend's job (the caller runs it first).
 * It does NOT touch any live install state.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { assembleArtifact, computeSha256 } from './artifact'
import {
  writeProvenance,
  WHISKIT_PROVENANCE_VERSION,
  PROVENANCE_FILENAME,
  type WhiskitBuildProvenance,
} from './provenance'
import { EXTERNALS_CONTRACT } from './externals'
import { hashFile, hashSourceTree } from './source-hash'
import {
  ARTIFACTS_INDEX_VERSION,
  type ArtifactEntry,
  type ArtifactsIndex,
} from './artifacts-index'

export interface AssembleArtifactInput {
  /** Built plugin dir: bakin-plugin.json + dist/ (+ optional node_modules/). */
  builtDir: string
  pluginId: string
  pluginVersion: string
  bakinVersion: string
  bakinRange: string
  /** Platform key (NEUTRAL_PLATFORM for pure-JS). */
  platform: string
  whiskitVersion: string
  buildBackend: string
  sourceCommitSha?: string
  /** Absolute URL the artifact will be downloadable at. */
  artifactUrl: string
  /** Directory to write the `.tar.gz` + `.sha256` into. */
  outDir: string
  approvedInstallScripts?: WhiskitBuildProvenance['approvedInstallScripts']
  /** ISO timestamp (passed in — modules can't call Date.now). */
  builtAt: string
}

export interface IndexEntryRef {
  pluginId: string
  version: string
  platform: string
  entry: ArtifactEntry
}

export interface AssembledArtifact {
  artifactPath: string
  sha256: string
  provenance: WhiskitBuildProvenance
  indexEntry: IndexEntryRef
}

/**
 * Top-level entries copied into the artifact (a subset of artifact.ts
 * ALLOWED_TOP_LEVEL). v1 is pure-JS only: the build inlines real deps and the
 * host provides React/SDK externals, so `node_modules/` is NOT shipped — it
 * would bloat the artifact and ship duplicate React/SDK copies, breaking the
 * "one React, one SDK" invariant. Native support (deferred Phase 7) will add
 * only the specific runtime modules listed in provenance.outputs.runtimeModules.
 */
const ARTIFACT_CONTENTS = ['bakin-plugin.json', 'dist'] as const

/**
 * Assemble a published artifact from a built plugin directory. Stages only the
 * artifact entries (so plugin SOURCE files never leak into the tarball — they
 * would fail the consumer's safe-extract allow-list), writes provenance into
 * `.whiskit/build.json`, tars + checksums, and returns the index entry.
 */
export async function assemblePluginArtifact(input: AssembleArtifactInput): Promise<AssembledArtifact> {
  const manifestPath = join(input.builtDir, 'bakin-plugin.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`assemblePluginArtifact: ${manifestPath} not found`)
  }
  if (!existsSync(join(input.builtDir, 'dist', 'index.js'))) {
    throw new Error(`assemblePluginArtifact: ${input.builtDir}/dist/index.js not found (build first)`)
  }

  const hasClient = existsSync(join(input.builtDir, 'dist', 'client.js'))
  const hasCss = existsSync(join(input.builtDir, 'dist', 'client.css'))

  const provenance: WhiskitBuildProvenance = {
    version: WHISKIT_PROVENANCE_VERSION,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    bakinVersion: input.bakinVersion,
    bakinRange: input.bakinRange,
    whiskitVersion: input.whiskitVersion,
    buildBackend: input.buildBackend,
    platform: input.platform,
    sourceCommitSha: input.sourceCommitSha ?? '',
    sourceTreeSha: hashSourceTree(input.builtDir),
    manifestSha: hashFile(manifestPath),
    externalsContract: EXTERNALS_CONTRACT,
    approvedInstallScripts: input.approvedInstallScripts ?? [],
    outputs: {
      serverEntry: 'dist/index.js',
      clientEntry: hasClient ? 'dist/client.js' : undefined,
      clientCss: hasCss ? 'dist/client.css' : undefined,
    },
    builtAt: input.builtAt,
  }

  // Stage only the artifact entries (never the plugin source).
  const staging = mkdtempSync(join(tmpdir(), `whiskit-pack-${input.pluginId}-`))
  try {
    for (const name of ARTIFACT_CONTENTS) {
      const src = join(input.builtDir, name)
      if (!existsSync(src)) continue
      cpSync(src, join(staging, name), { recursive: true, dereference: false })
    }
    mkdirSync(join(staging, '.whiskit'), { recursive: true })
    writeProvenance(join(staging, '.whiskit', PROVENANCE_FILENAME), provenance)

    mkdirSync(input.outDir, { recursive: true })
    const filename = `${input.pluginId}-${input.pluginVersion}-${input.platform}.tar.gz`
    const artifactPath = join(input.outDir, filename)
    await assembleArtifact(staging, artifactPath)
    const sha256 = await computeSha256(artifactPath)
    await Bun.write(`${artifactPath}.sha256`, `${sha256}  ${filename}\n`)

    const entry: ArtifactEntry = {
      url: input.artifactUrl,
      sha256,
      externalsContract: EXTERNALS_CONTRACT,
      bakinRange: input.bakinRange,
    }
    return {
      artifactPath,
      sha256,
      provenance,
      indexEntry: { pluginId: input.pluginId, version: input.pluginVersion, platform: input.platform, entry },
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/**
 * Build a fresh `whiskit-artifacts.json` for one release from its assembled
 * entries. (Carry-forward against the previous latest index is applied
 * separately via mergeArtifactsIndex.)
 */
export function indexFromEntries(entries: IndexEntryRef[]): ArtifactsIndex {
  const plugins: ArtifactsIndex['plugins'] = {}
  for (const { pluginId, version, platform, entry } of entries) {
    const plugin = plugins[pluginId] ?? { latest: version, versions: {} }
    const versionEntry = plugin.versions[version] ?? { platforms: {} }
    versionEntry.platforms[platform] = entry
    plugin.versions[version] = versionEntry
    plugin.latest = version
    plugins[pluginId] = plugin
  }
  return { version: ARTIFACTS_INDEX_VERSION, plugins }
}
