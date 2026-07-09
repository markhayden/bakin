/**
 * Secret redaction for human-facing previews (tool args, command lines,
 * URLs). Moved from adapter-openclaw's runtime-utils so BOTH runtime
 * adapters share one implementation — preview fields on turn-activity
 * chunks reach every connected browser, so redaction is part of the
 * adapter contract, not an OpenClaw detail.
 *
 * Covers: Authorization bearer headers, x-access-token headers, secret-ish
 * URL query params, and `key: value` / `key=value` pairs whose key smells
 * like a credential. Best-effort by design — callers must still avoid
 * logging raw payloads.
 */
export function redactSensitiveText(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s"'`]+/gi, '$1[redacted]')
    .replace(/(x-access-token:)[^\s"'`@]+/gi, '$1[redacted]')
    .replace(/([?&][^=\s"'`]*(?:token|password|secret|api[_-]?key)[^=\s"'`]*=)[^&\s"'`]+/gi, '$1[redacted]')
    .replace(/\b([A-Za-z0-9_]*(?:token|password|secret|api[_-]?key)[A-Za-z0-9_]*\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,"'`}]+)/gi, '$1[redacted]')
}
