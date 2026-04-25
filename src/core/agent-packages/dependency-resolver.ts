/**
 * Dependency resolver for agent-package installs.
 *
 * Recursively walks `manifest.dependencies` for the top-level package
 * and every transitively-pulled-in package. Returns a flat
 * `ResolvedDep[]` in topological order — leaves first — so the
 * installer can project them in iteration order without needing a
 * second sort.
 *
 * Cycle detection uses a fully-resolved `<source>@<ref>` key per dep.
 * Cycles throw with a clear path describing the loop.
 *
 * Diamond deps (A→B, A→C, B→D, C→D) get D resolved twice (one per
 * incoming edge), but the result list contains a single ResolvedDep
 * for D — the second visit is short-circuited by an already-resolved
 * cache. The installer ref-counts D once per dependent in
 * `incrementRefCount` so the lockfile counts both A→D and the
 * intermediate B→D / C→D edges correctly.
 *
 * V1 caps:
 *   - max recursion depth: 8 (deeper trees are almost certainly a bug)
 *   - tree size warning: >5 packages or >25 MB total → log a warning
 *     for the CLI / UI to surface as a confirm prompt
 *
 * Outputs are deterministic given the same input — fetch order matches
 * manifest declaration order; same-source repeats short-circuit; the
 * topological sort is stable across runs.
 */
import type {
  Dependency,
  Manifest,
} from '../../../packages/core/src/agent-packages/manifest'
import {
  formatManifestError,
  safeParseManifest,
} from '../../../packages/core/src/agent-packages/manifest'
import { readFileSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { fetchSource, type FetchedSource } from './source-fetcher'
import { createLogger } from '../logger'

const log = createLogger('agent-pkg:resolve')

const MAX_DEPTH = 8
const WARN_PACKAGE_COUNT = 5
const WARN_TREE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

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
  /** 1 = direct dep of the top-level pkg; 2 = dep-of-dep; etc. */
  depth: number
}

export interface ResolveOptions {
  /** Override the max-depth cap. V1 default is 8. */
  maxDepth?: number
}

interface ResolutionState {
  visiting: Map<string, string[]> // sourceKey → ancestor sourceKey chain (for cycle msg)
  resolved: Map<string, ResolvedDep>  // sourceKey → already-resolved entry
  out: ResolvedDep[]
  totalSize: number
}

/** Stable cache key for a dep — source + ref pair, normalized. */
function depCacheKey(spec: Dependency): string {
  return `${spec.source}@${spec.ref}`
}

/**
 * Estimate the staged size in bytes by walking the directory.
 * Best-effort — failures don't block the resolve.
 */
function estimateStagedSize(dir: string): number {
  let total = 0
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        total += estimateStagedSize(full)
      } else if (entry.isFile()) {
        try {
          total += statSync(full).size
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* skip */
  }
  return total
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

function listDirectDeps(parent: Manifest): Array<{ kind: keyof NonNullable<Manifest['dependencies']>; spec: Dependency }> {
  const out: Array<{ kind: keyof NonNullable<Manifest['dependencies']>; spec: Dependency }> = []
  const deps = parent.dependencies
  if (deps?.skills) for (const spec of deps.skills) out.push({ kind: 'skills', spec })
  if (deps?.workflows) for (const spec of deps.workflows) out.push({ kind: 'workflows', spec })
  if (deps?.knowledge) for (const spec of deps.knowledge) out.push({ kind: 'knowledge', spec })
  return out
}

/**
 * Recursive worker. Visits a single dep, fetches, validates, recurses
 * into its own deps, then pushes itself onto `out` (post-order so the
 * resulting array is leaves-first / topologically sorted).
 */
function visitDep(
  state: ResolutionState,
  spec: Dependency,
  category: keyof NonNullable<Manifest['dependencies']>,
  pulledBy: string,
  depth: number,
  maxDepth: number,
): void {
  if (depth > maxDepth) {
    throw new Error(
      `Dependency tree exceeds max depth ${maxDepth} (resolving ${spec.source}@${spec.ref} pulled by "${pulledBy}"). ` +
        `Likely a packaging bug — flatten the tree or raise the limit explicitly.`,
    )
  }

  const cacheKey = depCacheKey(spec)

  // Cycle detection — if we're already resolving this dep further up the
  // tree, we'd recurse forever.
  const ancestorChain = state.visiting.get(cacheKey)
  if (ancestorChain !== undefined) {
    const loop = [...ancestorChain, cacheKey].join(' → ')
    throw new Error(
      `Dependency cycle detected: ${loop}. Break the cycle in one of the manifests.`,
    )
  }

  // Already-resolved diamond-dep — short-circuit.
  if (state.resolved.has(cacheKey)) return

  // Fetch source
  const sourceWithRef = spec.source.startsWith('github:')
    ? `${spec.source}@${spec.ref}`
    : spec.source
  const fetched = fetchSource(sourceWithRef)

  // Parse manifest
  const manifestPath = join(fetched.stagingDir, 'bakin-package.json')
  let subManifest: Manifest
  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const parseResult = safeParseManifest(raw)
    if (!parseResult.success) {
      throw new Error(
        `Dependency manifest at ${spec.source}@${spec.ref} failed validation: ${formatManifestError(parseResult.error)}`,
      )
    }
    subManifest = parseResult.data
  } catch (err) {
    if (err instanceof Error && err.message.includes('failed validation')) throw err
    throw new Error(
      `Dependency manifest at ${spec.source}@${spec.ref} unreadable: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const declaredKind = kindForDepCategory(category)
  if (subManifest.kind !== declaredKind) {
    throw new Error(
      `Dependency declared as "${category}" but its manifest reports kind="${subManifest.kind}" ` +
        `(${spec.source}@${spec.ref})`,
    )
  }

  // Track size before recursing into transitive deps so the warning fires
  // accurately for the cumulative tree.
  state.totalSize += estimateStagedSize(fetched.stagingDir)

  // Mark as currently-visiting before recursing. Pop on exit (in either branch).
  const newAncestors = [...(ancestorChain ?? []), cacheKey]
  state.visiting.set(cacheKey, newAncestors)
  try {
    // Recurse into this dep's own dependencies (transitive walk)
    for (const childDep of listDirectDeps(subManifest)) {
      visitDep(state, childDep.spec, childDep.kind, subManifest.id, depth + 1, maxDepth)
    }
  } finally {
    state.visiting.delete(cacheKey)
  }

  // Post-order push — ensures topological order (children land before parents)
  const resolvedId = spec.installAs ?? subManifest.id
  const entry: ResolvedDep = {
    manifest: subManifest,
    fetched,
    resolvedId,
    spec,
    pulledBy,
    depth,
  }
  state.resolved.set(cacheKey, entry)
  state.out.push(entry)
}

/**
 * Resolve every dep in a manifest's `dependencies` block, recursively.
 * Returns deps in topological order (leaves first) so the installer can
 * project them in iteration order.
 */
export function resolveDependencies(
  parent: Manifest,
  options: ResolveOptions = {},
): ResolvedDep[] {
  const directDeps = listDirectDeps(parent)
  if (directDeps.length === 0) return []

  const maxDepth = options.maxDepth ?? MAX_DEPTH
  const state: ResolutionState = {
    visiting: new Map(),
    resolved: new Map(),
    out: [],
    totalSize: 0,
  }

  log.info('Resolving dependencies', { parent: parent.id, directCount: directDeps.length })

  for (const { kind, spec } of directDeps) {
    visitDep(state, spec, kind, parent.id, 1, maxDepth)
  }

  // Tree-size warning (CC-3 setting). The CLI / UI should surface this as
  // a confirm prompt; here we just log so the install proceeds. Phase H-2
  // acceptance criteria called for "confirm prompt" — that lives in the
  // CLI (Phase F-1 extension) when this signal makes its way up.
  if (state.out.length > WARN_PACKAGE_COUNT) {
    log.warn('Large dependency tree', {
      parent: parent.id,
      packages: state.out.length,
      sizeMb: Math.round(state.totalSize / (1024 * 1024)),
    })
  }
  if (state.totalSize > WARN_TREE_SIZE_BYTES) {
    log.warn('Dependency tree size exceeds soft limit', {
      parent: parent.id,
      sizeMb: Math.round(state.totalSize / (1024 * 1024)),
      limitMb: Math.round(WARN_TREE_SIZE_BYTES / (1024 * 1024)),
    })
  }

  return state.out
}

/** Test/diagnostic helper: count resolved + total size of a tree. */
export function summarizeResolution(deps: ResolvedDep[]): { count: number; maxDepth: number } {
  return {
    count: deps.length,
    maxDepth: deps.reduce((m, d) => Math.max(m, d.depth), 0),
  }
}
