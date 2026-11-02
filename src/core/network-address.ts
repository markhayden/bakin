/**
 * The machine's own address in the CGNAT range (100.64.0.0/10) — the range
 * Tailscale assigns — for the boot log's "reach me here" hint. Pure: callers
 * pass `os.networkInterfaces()`. CGNAT alone does not prove Tailscale, so the
 * log calls it the network address.
 */
import type { NetworkInterfaceInfo } from 'os'

/** First non-internal IPv4 in 100.64.0.0/10, interfaces in name order; null when none. */
export function findCgnatIPv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  for (const name of Object.keys(interfaces).sort()) {
    for (const info of interfaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue
      const [a, b] = info.address.split('.').map(Number)
      if (a === 100 && b >= 64 && b <= 127) return info.address
    }
  }
  return null
}
