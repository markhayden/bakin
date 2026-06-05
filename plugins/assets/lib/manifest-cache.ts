/**
 * Manifest read cache (#392) — stub.
 *
 * Pass-through placeholder so the RED specs in
 * tests/plugins/assets/manifest-cache.test.ts can land first; the
 * mtime-validated implementation replaces this in the next commit.
 */
import { readManifest, type AssetManifest } from './manifest'

/** Read an asset's manifest (uncached stub). */
export function getManifestCached(_assetId: string, assetDirAbs: string): AssetManifest | null {
  return readManifest(assetDirAbs)
}

/** @internal Test-only. */
export function __resetManifestCache(): void {}
