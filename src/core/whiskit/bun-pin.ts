/**
 * Pinned bun runtime tarballs for the managed-bun fallback (margo,
 * 2026-09-21): a compiled-binary install cannot shell out to `bun` for
 * capability-pack npm payloads unless the box happens to have a dev
 * toolchain — "go install Bun" is not acceptable remediation on a customer
 * machine. When no system bun exists, Bakin installs its own from bun's
 * official npm platform tarballs (immutable registry URLs, sha256-pinned).
 *
 * The pinned version MUST track `.bun-version` (the repo pin the binary is
 * built with) — regenerate the sha256s when bumping:
 *   for p in bun-darwin-aarch64 bun-linux-x64 bun-linux-aarch64; do
 *     curl -sL "https://registry.npmjs.org/@oven/$p/-/$p-<version>.tgz" | shasum -a 256
 *   done
 */
import type { MediaPlatformKey } from '../../../packages/core/src/media/pin'

export const MANAGED_BUN_VERSION = '1.3.13'

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
    sha256: '6c2ac79ac1120b103da58363824eda14a7c4be731d5a989b35d42370f05e47c0',
  },
  'linux-x64': {
    pkg: '@oven/bun-linux-x64',
    url: `https://registry.npmjs.org/@oven/bun-linux-x64/-/bun-linux-x64-${MANAGED_BUN_VERSION}.tgz`,
    sha256: '9b4cb9580f21a220f90b39b62ff97a5c6cbb2078e734e66d6877bb71cae07b4e',
  },
  'linux-arm64': {
    pkg: '@oven/bun-linux-aarch64',
    url: `https://registry.npmjs.org/@oven/bun-linux-aarch64/-/bun-linux-aarch64-${MANAGED_BUN_VERSION}.tgz`,
    sha256: 'eb0b8e1c99f2ec199357edad2fe71a654a935bd5087e7b40bd9aecef5223f23f',
  },
}
