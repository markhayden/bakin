/**
 * Host/plugin compatibility gate (T15/R13) — enforces the manifest's required
 * `bakin` semver range against the running host version, at install time
 * (validate-manifest) and at user-plugin activation (plugin-registry).
 *
 * Two-layer check:
 *
 * 1. **Well-formedness** (always enforced): `Bun.semver.satisfies` silently
 *    treats an unparseable range as match-everything ("banana" satisfies any
 *    version), so a typo'd range would never gate anything. We validate the
 *    range grammar ourselves and reject garbage loudly.
 * 2. **Satisfaction** (skipped on dev hosts): a source checkout runs with the
 *    unstamped APP_VERSION `0.0.0-dev`, which is meaningless for
 *    compatibility — enforcing it would reject every real plugin (e.g.
 *    `>=0.5.0`) on dev hosts. Stamped release builds always enforce.
 *
 * Core plugins never pass through this gate: they are version-locked to the
 * host by definition (no independent lifecycle), and the enforcement sites
 * are install + user-plugin activation only.
 */
import { semver } from 'bun'

import { APP_VERSION } from '../generated-version'

/** The unstamped dev-build version — satisfaction is skipped on these hosts. */
const DEV_HOST_VERSION = '0.0.0-dev'

/** Thrown by the activation gate; callers map it to the `incompatible_host` failure code. */
export class IncompatibleHostError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IncompatibleHostError'
  }
}

// One comparator: optional operator + version, where minor/patch may be
// x-ranges and a prerelease/build suffix is allowed. Also matches bare `*`.
const COMPARATOR_RE = new RegExp(
  '^(>=|<=|>|<|=|\\^|~)?v?' +
  '(\\d+|[xX*])(\\.(\\d+|[xX*]))?(\\.(\\d+|[xX*]))?' +
  '(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?' +
  '(\\+[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
)

/** A plain version / x-range with no operator — the operands of a hyphen range. */
const PLAIN_VERSION_RE = new RegExp(
  '^v?(\\d+|[xX*])(\\.(\\d+|[xX*]))?(\\.(\\d+|[xX*]))?' +
  '(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
)

/**
 * Structural validation of an npm-style semver range: `||`-separated
 * alternatives, each either a hyphen range (`1.0.0 - 2.0.0`) or
 * whitespace-separated comparators (`>=1.0.0 <2.0.0`). Bare `*` is valid.
 *
 * Deliberately rejects things Bun quietly accepts as match-all: empty
 * strings, dist-tags (`latest`), and non-numeric versions (`>=x.y.z` — an
 * x MAJOR makes the whole comparator meaningless).
 */
export function isWellFormedSemverRange(range: string): boolean {
  const trimmed = range.trim()
  if (trimmed === '') return false
  if (trimmed === '*') return true

  for (const alternative of trimmed.split('||')) {
    const alt = alternative.trim()
    if (alt === '') return false

    const hyphenParts = alt.split(/\s+-\s+/)
    if (hyphenParts.length === 2) {
      if (!hyphenParts.every(part => PLAIN_VERSION_RE.test(part) || part === '*')) return false
      continue
    }
    if (hyphenParts.length > 2) return false

    for (const comparator of alt.split(/\s+/)) {
      if (comparator === '*') continue
      if (!COMPARATOR_RE.test(comparator)) return false
      // An x/* MAJOR under an operator (or bare `x.y.z`) matches nothing
      // meaningful — reject non-numeric majors outside the bare-* case.
      const major = comparator.replace(/^(>=|<=|>|<|=|\^|~)?v?/, '').split(/[.+-]/)[0]
      if (major === 'x' || major === 'X' || major === '*') return false
    }
  }
  return true
}

export type BakinRangeCheck = { ok: true } | { ok: false; message: string }

/**
 * Check a manifest's `bakin` range against the host version.
 * `hostVersion` defaults to the build's APP_VERSION; tests pass explicit
 * versions to exercise stamped-host behavior on a dev checkout.
 */
export function checkBakinRangeCompatibility(
  range: string,
  hostVersion: string = APP_VERSION,
): BakinRangeCheck {
  if (!isWellFormedSemverRange(range)) {
    return {
      ok: false,
      message:
        `bakin-plugin.json field "bakin" is not a valid semver range: "${range}". ` +
        'Use a range like ">=0.5.0".',
    }
  }

  // Dev hosts (source checkouts) skip satisfaction — 0.0.0-dev is not a real
  // version and would fail every release-floor range.
  if (hostVersion === DEV_HOST_VERSION) return { ok: true }

  if (!semver.satisfies(hostVersion, range)) {
    return {
      ok: false,
      message:
        `Plugin requires Bakin "${range}" but this host is ${hostVersion}. ` +
        'Upgrade Bakin, or update the plugin\'s "bakin" range if it actually supports this version.',
    }
  }
  return { ok: true }
}
