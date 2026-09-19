/**
 * The pinned Antfly release Bakin installs and supervises.
 *
 * Single source of truth for the version + per-platform SHA256 checksums.
 * To upgrade: bump `version`, refresh `checksums` from the release's
 * `antfly_zig_checksums.txt`, then re-run `bakin install search` on each
 * machine. `releases.antfly.io/antfly/latest` is NOT used — it lags behind
 * pre-releases, and pinning keeps installs deterministic and checksummable.
 */

export type AntflyPlatformKey = 'darwin-arm64' | 'linux-x64' | 'linux-arm64'

export interface AntflyPin {
  version: string
  baseUrl: string
  /** SHA256 of the release tarball per platform (from antfly_zig_checksums.txt). */
  checksums: Record<AntflyPlatformKey, string>
}

export const ANTFLY_PIN: AntflyPin = {
  // v0.2.2 (published 2026-09-14) — ADOPTED 2026-09-18 after the repin gate
  // on the target M4 (tasks/evidence-antfly-0.2.2.md, bakin#843): every 0.2.0
  // sharp edge we filed is FIXED (antfly#617 add-leg wedge → clean
  // progressive backfill; #618 inline indexes → honest 400 rejection; #619
  // backfill pacing → ~17x, 20k rebuild ~83min → ~5min), and the 2026-09-18
  // live forced-rebuild HTTP-starvation wedge does not reproduce (0 probe
  // failures across three rebuild cycles under concurrent backfill load —
  // the 0.2.1 HBC cache-fill bounding). NO workaround pins flipped: order_by
  // on inferred fields still 422s and undecodable media still poisons its
  // whole batch, so the adapter carries the same workarounds as 0.2.0.
  // Upstream now also publishes Linux *_gnu (glibc) tarballs — we keep the
  // original names; switch if musl issues surface in Docker/CI.
  // For the next repin: bump version+checksums from the release's
  // antfly_zig_checksums.txt and re-run tests/integration/antfly/ + the
  // reproduction ladder (rungs in the evidence files) BEFORE adopting.
  version: '0.2.2',
  baseUrl: 'https://releases.antfly.io/antfly',
  checksums: {
    'darwin-arm64': '556a012141b7e3db0796902e3e219ad12c08a36cd9ff6b0ef0e9813948ecbcc6',
    'linux-arm64': '03154bf9bd3bbc7335e0662563c69bd3259c3bbfe8fcf8509b5f4a6265be4d84',
    'linux-x64': '17ebb65e906ce24a0a7e2672e8316c867fd9d7550b1f42eb4e1f714bb0697456',
  },
}

/** Upstream archive naming uses uname-style OS/arch tokens. */
const ARCHIVE_PLATFORM: Record<AntflyPlatformKey, string> = {
  'darwin-arm64': 'Darwin_arm64',
  'linux-x64': 'Linux_x86_64',
  'linux-arm64': 'Linux_arm64',
}

export function antflyPlatformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AntflyPlatformKey | null {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  // Note: antfly ships no darwin-x64 build — and neither does Bakin.
  return null
}

export function antflyArchiveName(pin: AntflyPin, key: AntflyPlatformKey): string {
  return `antfly_${pin.version}_${ARCHIVE_PLATFORM[key]}.tar.gz`
}

export function antflyDownloadUrl(pin: AntflyPin, key: AntflyPlatformKey): string {
  return `${pin.baseUrl}/v${pin.version}/${antflyArchiveName(pin, key)}`
}
