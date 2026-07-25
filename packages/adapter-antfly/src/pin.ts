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
  // rc.18 (tagged 2026-07-09) — RE-PINNED 2026-07-22 after the rc.21
  // evaluation ended in a crash dossier: concurrent embed-bearing writes
  // crash the engine outright (metal-command-buffer-failed, process exit);
  // it exits mid table-create even on an EMPTY data dir; sustained embed
  // load sickens the data plane; and the in-place rc.18→rc.21 upgrade
  // migrates table files one-way. All reported upstream with shell-only
  // repros (antfly#382 + the crash dossier). Re-evaluate on the next
  // release: bump version+checksums, flip the server subcommand back to
  // `standalone` (rc.19+ rename) at the three spawn sites, and re-run
  // tests/integration/antfly/ + the reproduction ladder BEFORE adopting.
  // rc.18 runs the pre-rename `swarm` subcommand.
  version: '0.2.0-rc.18',
  baseUrl: 'https://releases.antfly.io/antfly',
  checksums: {
    'darwin-arm64': 'e2b0df4461d78782d11a4e2740f299844a9a6cfed4df1a167c632a5b9ecdafe1',
    'linux-arm64': 'c74b3ea59b3e99f46cb8d3bbc723b9fd672b8a62779ca050ce11de1f5044a1ad',
    'linux-x64': 'e3d606d153f7713f389e414b40b855850347c4f67aec8827217e6076cc31a0be',
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
