/**
 * Dependency resolver for agent-package installs.
 *
 * V1 scope (Phase E-4): single-level resolution. The installer asks the
 * resolver for one package's `dependencies`, gets back fetched + validated
 * sub-packages, and projects them in leaves-first order. No recursion into
 * a dependency's own dependencies — that arrives in Phase H-2.
 *
 * The resolver is the bridge between the source-fetcher (which knows how
 * to fetch arbitrary sources) and the installer (which decides what to do
 * with a parsed manifest).
 *
 * Outputs are deterministic across re-runs given the same input — fetch
 * order matches manifest declaration order; fetched sources land in
 * unique staging dirs; ResolvedDep[] is leaves-first (deps before parent).
 *
 * NOT in V1 scope:
 *   - transitive dependency walks
 *   - dependency-tree size + count prompts (CC-3 settings)
 *   - cycle detection (single-level can't cycle)
 *   - lockfile-cache short-circuit (re-fetching every time is fine in V1)
 */
import type {
  Dependency,
  Manifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  formatManifestError,
  safeParseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fetchSource, type FetchedSource } from './source-fetcher'
import { createLogger } from '../logger'

const log = createLogger('agent-pkg:resolve')

export interface ResolvedDep {
  /** The sub-package manifest, fully validated. */
  manifest: Manifest
  /** Where the dep's source was staged. Installer projects from here, then cleans up. */
  fetched: FetchedSource
  /** The id under which this dep gets recorded in the lockfile. */
  resolvedId: string
  /** Source-side dep specifier — used to re-resolve on update. */
  spec: Dependency
  /** Parent package id that pulled this in (for diagnostics). */
  pulledBy: string
}

/**
 * Resolve every dep in a single manifest's `dependencies` block. Returns
 * the deps in declaration order — installer projects in this order so a
 * skill-pack used by an agent is on disk before the agent's projection runs.
 *
 * V1 single-level: doesn't recurse into the resolved deps' own dependencies.
 *
 * Errors:
 *   - Source fetch failure → throws with `cleanup()` already invoked on
 *     the staging dir; previously-resolved deps STAY staged for the
 *     caller to clean up. Caller is the installer, which holds an outer
 *     try/finally for that.
 *   - Manifest validation failure → cleans up that dep's staging dir,
 *     throws with formatManifestError-style message.
 */
export function resolveDependencies(parent: Manifest): ResolvedDep[] {
  const out: ResolvedDep[] = []

  const allDeps: Array<{ kind: keyof NonNullable<Manifest['dependencies']>; spec: Dependency }> = []
  const deps = parent.dependencies
  if (deps?.skills) for (const spec of deps.skills) allDeps.push({ kind: 'skills', spec })
  if (deps?.workflows) for (const spec of deps.workflows) allDeps.push({ kind: 'workflows', spec })
  if (deps?.knowledge) for (const spec of deps.knowledge) allDeps.push({ kind: 'knowledge', spec })

  if (allDeps.length === 0) return out

  log.info('Resolving dependencies', { parent: parent.id, count: allDeps.length })

  for (const { kind, spec } of allDeps) {
    // Build the source string the source-fetcher expects. The manifest's
    // dependency.source omits the @ref (lives in dependency.ref); we
    // re-stitch them so the fetcher's git-clone path picks the right
    // ref directly.
    const sourceWithRef = spec.source.startsWith('github:')
      ? `${spec.source}@${spec.ref}`
      : spec.source

    const fetched = fetchSource(sourceWithRef)

    let manifestPath: string
    try {
      manifestPath = join(fetched.stagingDir, 'bakin-package.json')
      const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const result = safeParseManifest(raw)
      if (!result.success) {
        throw new Error(
          `Dependency manifest at ${spec.source}@${spec.ref} failed validation: ${formatManifestError(result.error)}`,
        )
      }
      const subManifest = result.data

      const declaredKind = kindForDepCategory(kind)
      if (subManifest.kind !== declaredKind) {
        throw new Error(
          `Dependency declared as "${kind}" but its manifest reports kind="${subManifest.kind}" ` +
            `(${spec.source}@${spec.ref})`,
        )
      }

      const resolvedId = spec.installAs ?? subManifest.id
      out.push({
        manifest: subManifest,
        fetched,
        resolvedId,
        spec,
        pulledBy: parent.id,
      })
    } catch (err) {
      // Best-effort: any other resolved-deps still have their staging dirs
      // around — the installer's outer cleanup will handle them.
      throw err
    }
  }

  return out
}

function kindForDepCategory(category: keyof NonNullable<Manifest['dependencies']>): Manifest['kind'] {
  switch (category) {
    case 'skills':
      return 'skill-pack'
    case 'workflows':
      return 'workflow-pack'
    case 'knowledge':
      return 'knowledge-pack'
  }
}
