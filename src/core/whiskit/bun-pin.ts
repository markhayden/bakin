/**
 * Pinned bun runtime tarballs for the managed-bun fallback (margo,
 * 2026-09-21): a compiled-binary install cannot shell out to `bun` for
 * capability-pack npm payloads unless the box happens to have a dev
 * toolchain — "go install Bun" is not acceptable remediation on a customer
 * machine. When no system bun exists, Bakin installs its own from bun's
 * official npm platform tarballs (immutable registry URLs, sha256-pinned).
 *
 * The pinned version MUST track `.bun-version` (the repo pin the binary is
 * built with; tests/architecture/bun-pin.test.ts refuses a mismatch) —
 * regenerate the sha256s when bumping:
 *   for p in bun-darwin-aarch64 bun-linux-x64 bun-linux-aarch64; do
 *     curl -sL "https://registry.npmjs.org/@oven/$p/-/$p-<version>.tgz" | shasum -a 256
 *   done
 */
import type { MediaPlatformKey } from '../../../packages/core/src/media/pin'

export const MANAGED_BUN_VERSION = '1.4.3'

export interface ManagedBunDownload {
  /** npm platform package name (bun's naming, not ours). */
  pkg: string
  url: string
  sha256: string
}

/** Bakin platform key → bun's npm platform tarball. */
export const MANAGED_BUN_DOWNLOADS: Record<MediaPlatformKey, ManagedBunDownload> = {
  'darwin-arm64': {
    pkg: '@oven/bun-darwin-aarch64',
    url: `https://registry.npmjs.org/@oven/bun-darwin-aarch64/-/bun-darwin-aarch64-${MANAGED_BUN_VERSION}.tgz`,
    sha256: 'efac3433b75cbbe8478bd0a339f2bf196d2cc1bc8dd348118c689391b412bf79',
  },
  'linux-x64': {
    pkg: '@oven/bun-linux-x64',
    url: `https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-${MANAGED_BUN_VERSION}.tgz`,
    sha256: 'efd069d474e6addceede0dc9c0981b4421cf35ceb3348e4b83462053a177281f',
  },
  'linux-arm64': {
    pkg: '@oven/bun-linux-aarch64',
    url: `https://registry.npmjs.org/@oven/bun-linux-aarch64/-/bun-linux-aarch64-${MANAGED_BUN_VERSION}.tgz`,
    sha256: '557e9d56871b316ccc56856995283e798839b2fcb21adeef39d6413b715633e1',
  },
}
