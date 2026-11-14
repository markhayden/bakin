/**
 * Pack `bakin` range gate (spec provider-integrations §4.1, plan 1.1).
 *
 * A pack manifest's `bakin` field is a semver range naming the hosts it can
 * run on. It used to be cosmetic: parsed, never checked. That let an older
 * host accept a manifest with requirements it cannot read (the lax
 * `RequiresSchema` drops unknown legs such as `requires.login`) and report
 * the pack ready. Enforced at install and upgrade only — an installed pack
 * keeps running; sync never re-judges it.
 *
 * Reuses the plugins' checker (well-formedness always; satisfaction skipped
 * on the unstamped `0.0.0-dev` host; rc floors of the host's own base
 * compare the full prerelease version).
 */
import { APP_VERSION } from '@bakin/core/constants'
import { checkBakinRangeCompatibility } from '@bakin/core/plugins/compat'
import type { Manifest } from '../../../packages/core/src/agent-packages/manifest'
import { appendAudit } from '../audit'
import { getContentDir } from '../content-dir'
import { SkillRefusalError } from './errors'

const PACK_SUBJECT = { label: 'Package', file: 'bakin-package.json' }

/** Throws `SkillRefusalError('bakin-range')` when the host cannot run this pack. Audited. */
export function assertBakinRangeCompatible(manifest: Manifest, hostVersion: string = APP_VERSION): void {
  const range = manifest.bakin
  if (range === undefined) return
  const compat = checkBakinRangeCompatibility(range, hostVersion, PACK_SUBJECT)
  if (compat.ok) return
  appendAudit(getContentDir(), 'pkg.install_refused', manifest.id, {
    packageId: manifest.id,
    reason: 'bakin-range',
    range,
    hostVersion,
  }, 'cli')
  throw new SkillRefusalError(`Package "${manifest.id}": ${compat.message}`, 'bakin-range')
}
