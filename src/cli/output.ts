/**
 * Shared pure output helpers for the Bakin CLI — stdout printers, usage-string
 * normalizers, and small value formatters extracted from cli/bakin.ts. No I/O
 * beyond console, no heavy deps; safe to import anywhere in the CLI surface.
 *
 * The TUI exit helpers (exitCommandIssue/exitCommandFailure/…) stay in cli/bakin.ts
 * for now: they render via the printCommandIssueTui/printCommandFailureTui wrappers,
 * and printCommandFailureTui is also used by non-exit command sites there.
 */

/** Print a value to stdout — strings as-is, everything else pretty-printed JSON. */
export function print(data: unknown): void {
  if (typeof data === 'string') {
    console.log(data)
  } else {
    console.log(JSON.stringify(data, null, 2))
  }
}

/** Print an aligned plain-text table; "(none)" when there are no rows. */
export function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log('(none)')
    return
  }
  const cols = columns || Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))

  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ')
  const sep = cols.map((_, i) => '-'.repeat(widths[i])).join('  ')
  console.log(header)
  console.log(sep)
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '))
  }
}

/** Render the invoking command line for display (e.g. "bakin tasks list"). */
export function invocationCommand(args: string[]): string {
  return args.length > 0 ? `bakin ${args.join(' ')}` : 'bakin'
}

/** Strip a leading "Usage: " prefix from a usage string. */
export function normalizeUsage(usage: string): string {
  return usage.replace(/^Usage:\s*/, '')
}

/** Ensure a usage string carries the "Usage: " prefix exactly once. */
export function usageLine(usage: string): string {
  return usage.startsWith('Usage:') ? usage : `Usage: ${usage}`
}

/** ASCII status glyph for doctor/check output. */
export function statusIcon(status: string): string {
  switch (status) {
    case 'ok': return '[OK]'
    case 'warn': return '[WARN]'
    case 'error': return '[FAIL]'
    case 'missing': return '[MISS]'
    case 'broken': return '[FAIL]'
    case 'skipped': return '[SKIP]'
    default: return `[${status.toUpperCase()}]`
  }
}

/** Human-readable byte count (B / KB / MB). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Days until a date string, or "expiring" when at/past it. */
export function daysUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'expiring'
  return `${days}d`
}
