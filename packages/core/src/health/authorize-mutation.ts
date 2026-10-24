/**
 * The ONE authorization gate (spec §3.2, A1): every mutation path — the
 * auto-apply pass, boot convergence, a Health repair (system or click), the
 * CLI honouring `--yes`, an agent exec tool — asks the same question and
 * gets the same answer with the same reason.
 *
 * Rules, in precedence order for unattended actors (`system`/`agent`):
 *   delete/policy → operator-only · restart/rebuild → allowed ·
 *   hub skills never unattended · quarantined identity never retried ·
 *   declined subject never unattended · kind switched off blocks a VERSION
 *   change (a same-version repair is still allowed, A1) · trusted source or
 *   a trusted-by-construction kind · empty consent delta · reviewed record.
 *   One honest exception: a caller that has NO record and computed NO delta
 *   (today's Health repair path, before the updates engine supplies consent
 *   records) knows nothing about the release yet — "review first" is the
 *   truthful reason, not a source list it never consulted.
 * An `operator` click is always allowed: the gate is about automation; the
 * operator's own provenance is checked elsewhere (#898).
 *
 * Inputs the updates engine supplies later (consent records, deltas,
 * declined/quarantined flags) are plain parameters here, so the policy is
 * complete and table-tested before any caller exists.
 */

import { HEALTH_MUTATION_KINDS, HEALTH_MUTATION_REFUSAL_REASONS, type HealthMutationKind, type HealthMutationRefusalReason } from '@makinbakin/sdk/types'

export const MUTATION_REFUSAL_REASONS = HEALTH_MUTATION_REFUSAL_REASONS
export type MutationRefusalReason = HealthMutationRefusalReason
export const MUTATION_KINDS = HEALTH_MUTATION_KINDS

/** Engine-owned repair actions any check owner may reference — an explicit list, never a prefix. */
export const SHARED_ENGINE_ACTIONS: readonly string[] = Object.freeze(['core.diagnose'])

/** Kinds whose identities are pinned in the binary and verified by checksum — trusted without a consent record (spec §3.6). */
export const TRUSTED_BY_CONSTRUCTION_KINDS: readonly string[] = Object.freeze(['search-engine', 'search-models', 'bakin'])

export type MutationKind = HealthMutationKind
export type MutationActor = 'system' | 'agent' | 'operator'

/** What a release asks for beyond the signed consent record; all empty = empty delta. */
export interface ConsentDelta {
  permissions: readonly string[]
  bins: readonly string[]
  secrets: readonly string[]
  npm: readonly string[]
}

export interface MutationAuthorizationInput {
  subject: { kind: string; id: string }
  mutation: MutationKind
  /** The install source (`github:owner/repo#path`, a local path, …); absent for kinds trusted by construction. */
  source?: string
  trustedSources?: readonly string[]
  /** Absent = unknown = not empty (the caller must compute it before claiming an empty delta). */
  consentDelta?: ConsentDelta
  /** A valid signed consent record exists for this subject. */
  consentReviewed: boolean
  actor: MutationActor
  /** `updates.autoApply.<kind>`; absent = on. */
  kindEnabled?: boolean
  /** The mutation keeps the installed version (a same-commit reinstall or re-projection). */
  sameVersion?: boolean
  declined?: boolean
  quarantined?: boolean
}

export type MutationAuthorization = { allowed: true } | { allowed: false; reason: MutationRefusalReason }

const refuse = (reason: MutationRefusalReason): MutationAuthorization => ({ allowed: false, reason })

export function isEmptyConsentDelta(delta: ConsentDelta | undefined): boolean {
  return delta !== undefined && delta.permissions.length === 0 && delta.bins.length === 0 && delta.secrets.length === 0 && delta.npm.length === 0
}

/** Trust is by repository (or exact local path): the `#path` suffix of a source never widens or narrows it. */
export function isTrustedSource(source: string | undefined, trusted: readonly string[] | undefined): boolean {
  if (!source || !trusted) return false
  const repo = source.split('#')[0]!.replace(/\/+$/, '')
  return trusted.some((entry) => entry.replace(/\/+$/, '') === repo)
}

/** Mutations that may change the installed version when the kind switch is off (A1). */
function changesVersion(input: MutationAuthorizationInput): boolean {
  if (input.mutation === 'upgrade') return true
  if (input.mutation === 'sync') return input.sameVersion !== true
  return false
}

export function authorizeMutation(input: MutationAuthorizationInput): MutationAuthorization {
  if (input.actor === 'operator') return { allowed: true }
  switch (input.mutation) {
    case 'delete':
    case 'policy':
      return refuse('operator-only')
    case 'restart':
    case 'rebuild':
      return { allowed: true }
    default:
      break
  }
  if (input.subject.kind === 'hub-skill') return refuse('hub-skill')
  if (input.quarantined) return refuse('quarantined')
  if (input.declined) return refuse('declined')
  if (input.kindEnabled === false && changesVersion(input)) return refuse('disabled')
  if (TRUSTED_BY_CONSTRUCTION_KINDS.includes(input.subject.kind)) return { allowed: true }
  // Nothing reviewed and no delta computed: the caller has no consent facts at all → review first.
  if (!input.consentReviewed && input.consentDelta === undefined) return refuse('consent-unreviewed')
  if (!isTrustedSource(input.source, input.trustedSources)) return refuse('untrusted-source')
  if (!isEmptyConsentDelta(input.consentDelta)) return refuse('consent-delta')
  if (!input.consentReviewed) return refuse('consent-unreviewed')
  return { allowed: true }
}
