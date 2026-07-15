/**
 * Schedule plugin — pure utility helpers.
 *
 * Zero-coupling leaf functions (no plugin ctx, no module state): system-timezone
 * detection, the JSON Response shorthand the routes use, and `{var}` task-title/
 * prompt template expansion. Extracted from index.ts so the bigger seam modules
 * can share them without reaching back into the entry file.
 */

/** Detect system IANA timezone. Falls back to UTC. */
export function getSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'UTC'
  }
}

/**
 * The timezone a native runtime cron carries, when it carries one. Adapters
 * hoist the provider's schedule tz into `metadata.tz` (the OpenClaw
 * cron-store does this explicitly) — adoption must prefer it over the
 * system timezone or an evening job adopted on a UTC box silently shifts.
 */
export function nativeCronTz(job: { metadata?: Record<string, unknown> }): string | undefined {
  const tz = job.metadata?.tz
  return typeof tz === 'string' && tz.length > 0 ? tz : undefined
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function expandTemplate(template: string, vars: Record<string, string>): string {
  let result = template
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value)
  }
  return result
}
