/**
 * Recursive plain-object merge — `patch` wins, nested plain objects merge
 * key-wise, arrays and null replace wholesale (never merged element-wise).
 *
 * Single home for the deepMerge that used to live privately in settings.ts
 * and separately in the OpenClaw adapter's runtime-utils (the two bodies were
 * semantically identical: same recursion condition, same override-wins rule).
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key]
    out[key] = isPlainObject(existing) && isPlainObject(value)
      ? deepMerge(existing, value)
      : value
  }
  return out
}
