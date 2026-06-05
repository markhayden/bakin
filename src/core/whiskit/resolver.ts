/**
 * Pluggable artifact resolution (Open Q2). A resolver turns a parsed source ref
 * into a verified-against-checksum artifact location. v1 ships one HTTP(S)
 * backend that reads `whiskit-artifacts.json` from a base URL — the
 * github-release-assets path builds that base URL from the parsed source + ref
 * (the stable `releases/latest/download/` redirect or `releases/download/<tag>/`);
 * tests point it at a local fixture host. Everything below `resolve()` —
 * download, verify, extract, publish — is ecosystem-agnostic.
 *
 * Part of the Whiskit consumer install path (Phase 6).
 */
import { downloadText } from './download'
import {
  INDEX_FILENAME,
  parseArtifactsIndex,
  resolveArtifact,
  type ArtifactsIndex,
} from './artifacts-index'

export interface WhiskitArtifactLocation {
  artifactUrl: string
  sha256: string
  /** The index URL it was resolved from (for diagnostics). */
  indexUrl: string
}

export interface WhiskitArtifactResolver {
  readonly scheme: string
  /**
   * Resolve `pluginId` at `version` ('latest' or exact) for `platform` to an
   * artifact location, or null when the index has no matching artifact.
   */
  resolve(
    pluginId: string,
    version: string,
    platform: string,
  ): Promise<WhiskitArtifactLocation | null>
}

export class IndexFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IndexFetchError'
  }
}

/**
 * Resolver over an HTTP(S) base URL that serves `whiskit-artifacts.json`. The
 * github-release-assets resolver is this with the base URL pointed at a release
 * download path.
 */
export function httpIndexResolver(baseUrl: string, scheme = 'http'): WhiskitArtifactResolver {
  const indexUrl = `${baseUrl.replace(/\/+$/, '')}/${INDEX_FILENAME}`
  return {
    scheme,
    async resolve(pluginId, version, platform) {
      let index: ArtifactsIndex
      try {
        index = parseArtifactsIndex(JSON.parse(await downloadText(indexUrl)))
      } catch (err) {
        throw new IndexFetchError(
          `failed to fetch/parse artifact index from ${indexUrl}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const entry = resolveArtifact(index, pluginId, version, platform)
      if (!entry) return null
      return { artifactUrl: entry.url, sha256: entry.sha256, indexUrl }
    },
  }
}
