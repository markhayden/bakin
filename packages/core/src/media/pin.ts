/**
 * Sharp prebuild pin for the media store (#889).
 *
 * Compiled-binary installs cannot carry sharp's native prebuilds, so
 * `bakin install media` downloads this pinned npm-tarball set into
 * `~/.bakin/media/` (see ./installer.ts). The concrete versions/URLs/sha256s
 * live in the GENERATED ./pin-data.ts — regenerate with
 * `bun scripts/generate-media-pin.ts` (runbook:
 * .claude/knowledge/media-pipeline.md). Platforms mirror the binary release
 * matrix (scripts/build-binary.ts); linux pins are glibc — musl reports as
 * unsupported.
 */
import { SHARP_PIN_DATA } from './pin-data'

export const MEDIA_PLATFORM_KEYS = ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const
export type MediaPlatformKey = (typeof MEDIA_PLATFORM_KEYS)[number]

export interface PinnedTarball {
  name: string
  version: string
  url: string
  /** Lowercase hex sha256 of the npm tarball. */
  sha256: string
}

export interface SharpPin {
  /** The pinned sharp version — also the store directory name. */
  version: string
  /** Platform-neutral tarballs (sharp + its runtime JS deps). */
  shared: PinnedTarball[]
  /** Native + libvips tarballs per supported platform. */
  platform: Record<MediaPlatformKey, PinnedTarball[]>
}

export const SHARP_PIN: SharpPin = SHARP_PIN_DATA

/** Map this process's platform/arch onto a media platform key. */
export function mediaPlatformKey(): MediaPlatformKey | null {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'darwin-arm64'
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64'
  if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64'
  return null
}

/** Every tarball the given platform's store needs, shared legs first. */
export function pinnedTarballsFor(key: MediaPlatformKey): PinnedTarball[] {
  return [...SHARP_PIN.shared, ...SHARP_PIN.platform[key]]
}
