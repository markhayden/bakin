import type { GatewayLogEntry } from './types'

const NOISE_PATTERNS = [
  /discord: skipping guild message/i,
  /subsystem restart/i,
  /keepalive ping/i,
  /heartbeat tick/i,
]

export function parseGatewayLog(
  content: string,
  opts?: { offset?: number; limit?: number }
): { entries: GatewayLogEntry[]; total: number; hasMore: boolean } {
  const lines = content.split('\n')
  const allEntries: GatewayLogEntry[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Match log lines: [YYYY-MM-DD HH:MM:SS] LEVEL message
    // or: YYYY-MM-DDTHH:MM:SS LEVEL message
    const match = trimmed.match(
      /^(?:\[?(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s+)?(\w+)\s+(.+)$/
    )

    if (!match) continue

    const [, timestamp, level, message] = match

    // Only INFO level
    if (level?.toUpperCase() !== 'INFO') continue

    // Filter noise
    if (NOISE_PATTERNS.some((p) => p.test(message))) continue

    allEntries.push({
      timestamp: timestamp || '',
      level: level || 'INFO',
      message,
      raw: trimmed,
    })
  }

  const total = allEntries.length
  const offset = opts?.offset ?? 0
  const limit = opts?.limit ?? 50
  const sliced = allEntries.slice(offset, offset + limit)

  return {
    entries: sliced,
    total,
    hasMore: offset + limit < total,
  }
}
