/**
 * Plugin permission taxonomy (#142).
 *
 * Locked Zod enum sized to exactly what current manifests declare. Adding
 * a new permission = one line here + one entry in PERMISSION_DESCRIPTIONS.
 * No migration; existing manifests declare a subset.
 *
 * Per design decision 12, the enum is intentionally minimal. New
 * permissions ship in the same PR that introduces the capability needing
 * them — not in this PR.
 */
import { z } from 'zod'

export const PermissionSchema = z.enum([
  'events.emit',
  'openclaw.read',
  'storage.read',
  'storage.write',
])

export type Permission = z.infer<typeof PermissionSchema>

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'events.emit':   'Broadcast Server-Sent Events to connected browsers',
  'openclaw.read': 'Read agent identity, skills, and workspace state from the runtime adapter',
  'storage.read':  'Read files in ~/.bakin/',
  'storage.write': 'Write files in ~/.bakin/',
}

const KNOWN_PERMISSIONS: readonly Permission[] = PermissionSchema.options

/**
 * Pure: returns the permissions present in `next` that weren't in `prev`.
 * Used by upgrade flow to decide whether to re-prompt for consent.
 */
export function newPermissions(prev: readonly string[], next: readonly string[]): Permission[] {
  const prevSet = new Set(prev)
  const out: Permission[] = []
  for (const p of next) {
    if (prevSet.has(p)) continue
    if ((KNOWN_PERMISSIONS as readonly string[]).includes(p)) out.push(p as Permission)
  }
  return out
}

/**
 * Suggest a known permission within edit-distance 2 of the unknown
 * input — used to render "did you mean…" in install/upgrade errors.
 * Returns null when nothing matches closely enough.
 *
 * Bounded input length: any reasonable permission is ≤ 32 chars; a
 * hostile manifest with a 1MB string here would burn O(N×M) CPU in
 * Levenshtein. Truncate before comparing.
 */
const MAX_SUGGEST_LEN = 64
export function suggestPermission(unknown: string): Permission | null {
  if (unknown.length > MAX_SUGGEST_LEN) return null
  let best: { perm: Permission; dist: number } | null = null
  for (const known of KNOWN_PERMISSIONS) {
    const dist = levenshtein(unknown, known)
    if (dist <= 2 && (!best || dist < best.dist)) {
      best = { perm: known, dist }
    }
  }
  return best?.perm ?? null
}

/**
 * Validate a manifest's `permissions` field. Returns the parsed array on
 * success or throws an Error whose message includes a "did you mean"
 * suggestion for the first unknown permission.
 *
 * Empty/missing input normalizes to []. Non-string entries throw.
 */
export function parseManifestPermissions(input: unknown): Permission[] {
  if (input === undefined || input === null) return []
  if (!Array.isArray(input)) {
    throw new Error(`bakin-plugin.json "permissions" must be an array of strings`)
  }
  const seen = new Set<Permission>()
  for (const raw of input) {
    if (typeof raw !== 'string') {
      throw new Error(`bakin-plugin.json "permissions" entries must be strings; got ${typeof raw}`)
    }
    const parsed = PermissionSchema.safeParse(raw)
    if (!parsed.success) {
      const suggestion = suggestPermission(raw)
      const hint = suggestion ? ` Did you mean "${suggestion}"?` : ''
      throw new Error(`Unknown permission "${raw}" in bakin-plugin.json.${hint}`)
    }
    seen.add(parsed.data)
  }
  // Dedup at parse time — duplicate entries are equivalent and they bloat
  // the audit log + lockfile noise.
  return [...seen]
}

// ─── Levenshtein (small, no external dep) ────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}
