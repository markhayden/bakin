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
  // v0.2.5 (published 2026-09-28) — the repin gate is in
  // tasks/evidence-antfly-0.2.5.md. 0.2.3/0.2.5 are v0.2.x backports; the one
  // that touches Bakin is upstream #898 (secure deployment defaults): remote
  // templates now DENY file:// unless remote_content.security.allowed_paths
  // names the directory, so service.ts passes --config with the asset store
  // allowlisted (renderEngineConfig) — without it every asset batch with an
  // image 500s whole. Pinned by workaround-regressions "file:// media needs
  // Bakin's engine config". Workarounds unchanged: order_by on inferred
  // fields still 422s and undecodable media still poisons its whole batch.
  // Linux stays on the static tarballs (not *_gnu): the static-only artifact
  // mix-up (antfly#1202) needs a GGUF+ONNX install, which Bakin no longer
  // creates (MODEL_PULL_VARIANTS), and *_gnu would break musl hosts.
  // For the next repin: bump version+checksums from the release's
  // antfly_zig_checksums.txt and re-run tests/integration/antfly/ + the
  // reproduction ladder (rungs in the evidence files) BEFORE adopting.
  version: '0.2.5',
  baseUrl: 'https://releases.antfly.io/antfly',
  checksums: {
    'darwin-arm64': '4fc5a948be9e14cefc8393de22ce1ea6e35b927aa79cc35b7d80bef55b712ac8',
    'linux-arm64': 'ad166bedb9eb4d137240b2f20c82ae143c211c3f2c95d0aad0ac864ba179c24d',
    'linux-x64': 'd123bd0f92c9a9837e4f079c6aca91a587051a3acfed64a74ccd6951398e1b08',
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
