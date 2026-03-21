import type { AuditEntry } from './types'

export function parseAuditLog(jsonl: string): AuditEntry[] {
  const entries: AuditEntry[] = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const entry = JSON.parse(trimmed) as AuditEntry
      if (entry.ts && entry.event) {
        entries.push(entry)
      }
    } catch {
      // skip malformed lines
    }
  }
  return entries
}

export function filterAuditEntries(
  entries: AuditEntry[],
  opts?: { agent?: string; event?: string; limit?: number }
): AuditEntry[] {
  let filtered = entries

  if (opts?.agent) {
    const agent = opts.agent.toLowerCase()
    filtered = filtered.filter((e) => e.agent.toLowerCase() === agent)
  }

  if (opts?.event) {
    const pattern = opts.event
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2)
      filtered = filtered.filter((e) => e.event.startsWith(prefix + '.') || e.event === prefix)
    } else {
      filtered = filtered.filter((e) => e.event === pattern)
    }
  }

  if (opts?.limit && opts.limit > 0) {
    filtered = filtered.slice(-opts.limit)
  }

  return filtered
}
