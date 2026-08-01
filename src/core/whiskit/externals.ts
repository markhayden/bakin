/**
 * The host-provided externals contract — single source of truth.
 *
 * Plugin bundles must NOT bundle their own React or SDK; the host provides one
 * instance of each via the import map (see packages/host/public/index.html).
 * This list was previously duplicated in `user-plugin-builder.ts` (user plugin
 * builds) and `scripts/build-plugins.ts` (core plugin builds) — if one added an
 * SDK sub-path the other didn't, plugins broke inconsistently between the two
 * build paths. Owning it once keeps the "one React, one SDK" invariant.
 *
 * First slice of the Whiskit shared build backend (Phase 2).
 */

/** React + router specifiers the host always provides. */
export const REACT_EXTERNALS: string[] = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@tanstack/react-router',
]

/** The published SDK surface (root + every sub-path). */
export const SDK_EXTERNALS: string[] = [
  '@makinbakin/sdk',
  '@makinbakin/sdk/ui',
  '@makinbakin/sdk/layout',
  '@makinbakin/sdk/patterns',
  '@makinbakin/sdk/charts',
  '@makinbakin/sdk/conversation',
  '@makinbakin/sdk/content',
  '@makinbakin/sdk/hooks',
  '@makinbakin/sdk/slots',
  '@makinbakin/sdk/types',
  '@makinbakin/sdk/utils',
  '@makinbakin/sdk/metadata',
  '@makinbakin/sdk/routing',
  '@makinbakin/sdk/navigation',
  '@makinbakin/sdk/internal',
]

/**
 * Client bundles externalize React + router + the full SDK surface (the host
 * import map maps each to a shared vendor bundle).
 */
export const PLUGIN_CLIENT_EXTERNALS: string[] = [...REACT_EXTERNALS, ...SDK_EXTERNALS]

/**
 * Server bundles externalize React + router only; the SDK is inlined and other
 * node_modules are kept external via Bun's `--packages external`.
 */
export const PLUGIN_SERVER_EXTERNALS: string[] = [...REACT_EXTERNALS]

/**
 * Stable identifier for this externals contract, recorded in build provenance.
 * Versions in this family are additive: a newer host can satisfy artifacts
 * built against any earlier version. Breaking changes require a new family.
 */
export const EXTERNALS_CONTRACT = 'react19-sdk-makinbakin-v2'

interface ParsedExternalsContract {
  family: string
  version: number
}

function parseExternalsContract(contract: string): ParsedExternalsContract | null {
  const match = /^(.+)-v([1-9]\d*)$/.exec(contract)
  if (!match) return null
  return { family: match[1], version: Number(match[2]) }
}

/** Whether this host provides every external expected by an artifact. */
export function supportsExternalsContract(
  artifactContract: string,
  hostContract = EXTERNALS_CONTRACT,
): boolean {
  const artifact = parseExternalsContract(artifactContract)
  const host = parseExternalsContract(hostContract)
  return artifact !== null
    && host !== null
    && artifact.family === host.family
    && artifact.version <= host.version
}
