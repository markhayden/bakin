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
  // rc.21 (tagged 2026-07-21), adopted 2026-07-21. Fixes the #319
  // mixed-corpus backfill accounting (media legs no longer report
  // building forever — that idle-detection override in translate.ts was
  // retired with its pin); adds query-embedding caching with singleflight
  // (upstream #346, multi-table fan-out). BREAKING absorbed here: the
  // single-process server subcommand renamed swarm → standalone (rc.19).
  // Still-open upstream at this pin (workarounds + pins retained):
  // empty/runtime-less legs report backfill running forever, filter_query
  // rejects match_phrase (composeFtsWithFilters stays), no order_by on
  // inferred fields. Pins: tests/integration/antfly/workaround-regressions.test.ts.
  version: '0.2.0-rc.21',
  baseUrl: 'https://releases.antfly.io/antfly',
  checksums: {
    'darwin-arm64': '6937dd2dfec93b8147c65b4d63f45840e3f63417947db77d5eef43dce414236e',
    'linux-arm64': '4f09411aeccd1ad3ffbf403a28a08ef0fe3297f91314573fbd62717cd4e2989e',
    'linux-x64': 'de5bec9ced4868412ca0cfe013a3bfbcb8123ac31db6092ddebf8848dc758ffa',
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
