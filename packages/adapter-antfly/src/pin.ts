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
  // v0.2.0 FINAL (published 2026-08-11) — ADOPTED 2026-08-31 after the full
  // hard-gate evaluation on the target M4 (tasks/evidence-antfly-0.2.0.md):
  // every rc.19–rc.21 dossier blocker (antfly#382/#383/#384/#386) disproven
  // locally, 45-min concurrent embed-write soak clean, reindex-under-load
  // fixed (194x median query latency vs rc.18, zero failed queries). The
  // server subcommand is `standalone` (the rc.19+ rename; `swarm` is gone).
  // Known 0.2.0 sharp edges, both OFF Bakin's production path and ticketed
  // upstream: inline `indexes` at table-create are silently dead (we create
  // legs via POST /tables/{t}/indexes/{name} — see client.ts tables.create),
  // and adding a leg to a POPULATED table wedges it durably. For the next
  // repin: bump version+checksums from the release's antfly_zig_checksums.txt
  // and re-run tests/integration/antfly/ + the reproduction ladder (rungs in
  // the evidence file) BEFORE adopting.
  version: '0.2.0',
  baseUrl: 'https://releases.antfly.io/antfly',
  checksums: {
    'darwin-arm64': '82690d5c7e7cac5f7cd56c46ced8f4dd9acace577fb7982060667bcdb2632db6',
    'linux-arm64': 'a4993e854f4c7676708602b2765113f0caad8b8b1097e6c12fac5f562be16ac6',
    'linux-x64': '1eb63abba8d0608355a075e3a39586ee72d9c8a4870ba2365558cea2b7d3defe',
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
