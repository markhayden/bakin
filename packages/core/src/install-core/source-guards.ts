/**
 * Shared source-string guards for the install core.
 *
 * The plugin install parser (`packages/core/src/plugins/source.ts`) and the
 * agent-package parser (`src/core/agent-packages/source-fetcher.ts`)
 * historically carried byte-for-byte identical `#subpath` validation, with only
 * their error messages differing — a textbook drift surface (one copy could
 * tighten or loosen a rule the other didn't). This module owns the RULES once;
 * each parser maps a violation to its own typed error + message, so observable
 * behavior is unchanged while the rules can no longer diverge.
 *
 * First extraction of the Whiskit shared install core (Phase 5). The two
 * install paths converge here further in later slices (materialization,
 * transaction, lockfile IO, provenance). See
 * `.claude/specs/whiskit-plugin-builder-plan.md` (Phase 5).
 */

/** Characters permitted in a monorepo `#subpath`. */
export const SUBPATH_PATTERN = /^[A-Za-z0-9._/-]+$/

export type SubpathViolation =
  | 'empty'
  | 'invalid-chars'
  | 'leading-or-trailing-slash'
  | 'dot-segment'

/**
 * Validate a `#subpath` (the part after `#` in a source string) against the
 * shared rules. Returns the first violation, or `null` when valid. Pure — never
 * throws — so each caller renders its own error type and message.
 */
export function checkSubpath(subpath: string): SubpathViolation | null {
  if (subpath.length === 0) return 'empty'
  if (!SUBPATH_PATTERN.test(subpath)) return 'invalid-chars'
  if (subpath.startsWith('/') || subpath.endsWith('/')) return 'leading-or-trailing-slash'
  if (subpath.split('/').some((segment) => segment === '..' || segment === '.')) {
    return 'dot-segment'
  }
  return null
}
