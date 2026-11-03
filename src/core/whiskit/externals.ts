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
  '@makinbakin/sdk/routing',
  '@makinbakin/sdk/navigation',
  '@makinbakin/sdk/internal',
]

/**
 * zod is host-provided in the browser too (#948): the SDK's routing entry and
 * any plugin client that validates at a boundary share ONE copy behind the
 * import map (`/vendor/zod.js`) instead of each bundling ~400 KB of its own.
 * Only the bare specifier is provided — every import in the tree is bare.
 * Plugins still DECLARE zod (server bundles run under `--packages external`
 * and need it installed), so the import scan does not treat it as provided.
 */
export const ZOD_EXTERNALS: string[] = ['zod']

/**
 * Client bundles externalize React + router + the full SDK surface + zod (the
 * host import map maps each to a shared vendor bundle).
 */
export const PLUGIN_CLIENT_EXTERNALS: string[] = [...REACT_EXTERNALS, ...SDK_EXTERNALS, ...ZOD_EXTERNALS]

/**
 * The package roots the host provides. Bun's `--external <pkg>` matches every
 * sub-path of the package too, so a client bundle keeps e.g. `zod/v4` or
 * `@makinbakin/sdk/not-an-entry` as a BARE import — which the import map
 * (exact specifiers only) cannot resolve. The client build refuses such a
 * bundle; see `unprovidedHostSubpath`.
 */
const HOST_PROVIDED_ROOTS: string[] = ['react', 'react-dom', '@tanstack/react-router', '@makinbakin/sdk', ...ZOD_EXTERNALS]

function packageRoot(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

/**
 * The host-provided package root a specifier belongs to WITHOUT the import
 * map resolving that exact specifier — or null when the specifier is either
 * provided exactly (`zod`, `react/jsx-runtime`, every SDK entry) or not a
 * host package at all. Relative/absolute paths are never host packages.
 */
export function unprovidedHostSubpath(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null
  if (PLUGIN_CLIENT_EXTERNALS.includes(specifier)) return null
  const root = packageRoot(specifier)
  return HOST_PROVIDED_ROOTS.includes(root) ? root : null
}

/**
 * Server bundles externalize React + router only; the SDK is inlined and other
 * node_modules are kept external via Bun's `--packages external`.
 */
export const PLUGIN_SERVER_EXTERNALS: string[] = [...REACT_EXTERNALS]

/**
 * Stable identifier for this externals contract, recorded in build provenance.
 * The focused family retires /metadata; the previous family promised that entry.
 * Versions in this family are additive: a newer host can satisfy artifacts
 * built against any earlier version. Breaking changes require a new family.
 *
 * v2 (#948) adds zod to the provided set. A v1 artifact carries its own zod
 * and still loads on a v2 host (it never asks the import map for it); a v2
 * artifact on a v1 host would 404 on `zod`, which `supportsExternalsContract`
 * refuses by version order.
 */
export const EXTERNALS_CONTRACT = 'react19-sdk-focused-v2'

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
