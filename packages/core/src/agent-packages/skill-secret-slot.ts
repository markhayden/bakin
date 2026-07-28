/**
 * Secret-slot minting for skill packs (#687).
 *
 * Slots are ALWAYS minted by core, never chosen by a skill author or by the
 * mapping agent — an author-chosen slot could bind a real provider
 * credential (`discord.botToken`, `anthropic.apiKey`) to an env var the
 * skill's own scripts read. Two rules make that unrepresentable:
 *
 *  1. Every skill slot lives under the `skills.` provider namespace, and
 *     `collectPackSecretMappings` refuses to bind anything outside it.
 *  2. Slots are namespaced PER PACKAGE (`skills.<packageId>.<ENV_VAR>`), so
 *     two skills that happen to want `GITHUB_TOKEN` don't silently share one
 *     stored credential — a fresh install always prompts for its own key
 *     rather than inheriting a neighbour's and reporting "ready".
 */

/** The one provider namespace skill-declared secrets may bind to. */
export const SKILL_SECRET_PROVIDER = 'skills'

/**
 * Mint the canonical slot for a package's env var. `packageId` is already
 * constrained to `[a-z0-9][a-z0-9-_]*` by the manifest schema and `envVar` to
 * `[A-Z_][A-Z0-9_]*` by its callers, so the result is always a valid
 * `<provider>.<name>` slot (the name segment may contain dots — parse with
 * `parseSecretSlot`, never `split('.', 2)`).
 */
export function mintSkillSecretSlot(packageId: string, envVar: string): string {
  // The NAME segment is `<packageId>.<envVar>` and the secret store caps
  // names at 64 chars — a long pack id plus a long env var would mint a slot
  // the manifest schema accepts but `POST /api/secrets` then rejects, leaving
  // the key unstorable forever. Clamp the pack segment (it is only a
  // disambiguator; the env var carries the meaning).
  const budget = MAX_SECRET_NAME_LENGTH - envVar.length - 1
  const pack = budget >= packageId.length ? packageId : packageId.slice(0, Math.max(budget, 0))
  return pack.length > 0
    ? `${SKILL_SECRET_PROVIDER}.${pack}.${envVar}`
    : `${SKILL_SECRET_PROVIDER}.${envVar}`
}

/** Mirrors `isValidSecretName`'s bound in packages/core/src/media/secret-store.ts. */
const MAX_SECRET_NAME_LENGTH = 64
