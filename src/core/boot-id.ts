/**
 * Per-process boot generation id.
 *
 * Stamped on every execution-ledger run claim; the startup sweep marks
 * runs from any OTHER boot id as lost so a crashed process can never leave
 * a claim that blocks re-dispatch. Random (not pid — pids recycle; not
 * time — clocks change), minted once, HMR-safe via globalThis (same reason
 * as __bakinBroadcast in sse.ts).
 */
import { randomUUID } from 'crypto'

const g = globalThis as { __bakinBootId?: string }

export function getBootId(): string {
  if (!g.__bakinBootId) g.__bakinBootId = randomUUID()
  return g.__bakinBootId
}
