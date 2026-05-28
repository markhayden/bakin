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
  'assets.read',
  'assets.write',
  'runtime.read',
  'runtime.agents',
  'runtime.messaging',
  'runtime.channels',
  'runtime.cron',
  'runtime.skills',
  'runtime.models',
  'runtime.images',
  'search.read',
  'search.write',
  'storage.read',
  'storage.write',
  'tasks.read',
  'tasks.write',
])

export type Permission = z.infer<typeof PermissionSchema>

export class PermissionDenied extends Error {
  readonly pluginId: string
  readonly permission: Permission
  readonly method: string

  constructor(input: { pluginId: string; permission: Permission; method: string }) {
    super(
      `Plugin "${input.pluginId}" called ${input.method} without declaring permission "${input.permission}". ` +
      `Add "${input.permission}" to permissions in bakin-plugin.json.`,
    )
    this.name = 'PermissionDenied'
    this.pluginId = input.pluginId
    this.permission = input.permission
    this.method = input.method
  }
}

export const PERMISSION_DESCRIPTIONS: Record<Permission, string> = {
  'events.emit':   'Broadcast Server-Sent Events to connected browsers',
  'assets.read':   'Read asset metadata and runtime-deliverable asset references',
  'assets.write':  'Save files into the asset store and write asset metadata',
  'runtime.read':  'Read general runtime adapter state',
  'runtime.agents': 'Read runtime agent identity and status',
  'runtime.messaging': 'Send messages through the runtime adapter',
  'runtime.channels': 'Send messages or content to configured runtime channels',
  'runtime.cron': 'Create and manage runtime cron jobs',
  'runtime.skills': 'Read runtime skills',
  'runtime.models': 'Read runtime model metadata',
  'runtime.images': 'Generate images through the configured runtime adapter',
  'search.read': 'Query Bakin search indexes',
  'search.write': 'Register or mutate plugin-owned search indexes',
  'storage.read':  'Read files in ~/.bakin/',
  'storage.write': 'Write files in ~/.bakin/',
  'tasks.read': 'Read tasks through the public task service',
  'tasks.write': 'Create and mutate tasks through the public task service',
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
