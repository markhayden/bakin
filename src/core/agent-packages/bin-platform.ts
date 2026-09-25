/**
 * Leaf: this process's platform/arch as a manifest platform key. Kept
 * dependency-free so ownership (bin-owners) and the installer can both use
 * it without importing each other.
 */
import type { BinPlatformKey } from '../../../packages/core/src/plugins/bin-requirement'

/** Map this process's platform/arch onto a manifest platform key. */
export function binPlatformKey(): BinPlatformKey | null {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null
  if (!os || !arch) return null
  return `${os}-${arch}` as BinPlatformKey
}
