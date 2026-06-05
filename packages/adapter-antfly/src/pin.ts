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
  version: '0.2.0-rc.2',
  baseUrl: 'https://releases.antfly.io/antfly',
  checksums: {
    'darwin-arm64': '1eb09c565b36f885f3a2ccc949f14a488c0d1c5e4f9dda2925228e2bc7313ea1',
    'linux-arm64': 'cfed5c2c97f75acbfd8c3d597f30d36a0155ec5221e2b6bef80ace5fd238a239',
    'linux-x64': 'f9c6710bc9bac2f7689f3f6f5850d432f7f2af482f4253f587be3180abc2809e',
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
