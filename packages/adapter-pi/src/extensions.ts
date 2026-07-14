/**
 * Pi extension discovery — the adapter side of the trust lane (#670/#626).
 *
 * Discovery asks the SDK's PACKAGE MANAGER what the loader would load
 * (`resolve()` → resolved absolute paths + source metadata), which is the
 * only authoritative answer: it covers npm packages, git packages, local
 * extension files/dirs, object-form `packages[]` entries, and project scope,
 * with the loader's own enable rules applied. It resolves paths WITHOUT
 * importing extension modules (`onMissing: 'skip'` also means it never
 * installs or touches the network).
 *
 * IDENTITY IS THE RESOLVED ABSOLUTE PATH. Not a basename, not a package name:
 * those collide across sources, and a trust decision must name exactly one
 * file. The allowlist stores paths, the loader is handed paths, and nothing
 * in between pattern-matches.
 */
import type { RuntimeExtensionInfo, RuntimeExtensionsAccess } from '@bakin/core/adapters/runtime'
import { getPiAgentDir, getPiPath } from './home'
import { extensionsPolicy, resolveExtensionResources } from './messaging'

/**
 * Human label (display + CLI convenience only — NEVER used for matching):
 * the package spec for package-installed extensions, else the file's name.
 * The SDK's metadata.source carries internal tags like "auto" for loose
 * files — those are not names a user would recognize.
 */
function labelFor(path: string, source: string | undefined): string {
  if (source && (source.startsWith('npm:') || source.startsWith('git:'))) return source
  const base = path.split('/').pop() ?? path
  const stem = base.replace(/\.(ts|js)$/, '')
  // A package's entry file is often index.* — name it by its directory.
  if (stem === 'index') {
    const parent = path.split('/').slice(-2, -1)[0]
    if (parent) return parent
  }
  return stem
}

function sourceLabel(source: string | undefined, scope: string | undefined): string {
  const projectSuffix = scope === 'project' ? ' (project)' : ''
  if (source?.startsWith('npm:')) return `npm package${projectSuffix}`
  if (source?.startsWith('git:')) return `git package${projectSuffix}`
  return scope === 'project' ? 'project extension' : 'extensions dir'
}

/**
 * The surface is created with the Bakin-side adapter settings getter — the
 * SAME policy source the messaging loader reads, so list() status can never
 * disagree with what actually loads.
 */
export function createExtensionsSurface(
  getSettings: () => Record<string, unknown> | undefined,
): RuntimeExtensionsAccess {
  return {
    async list(): Promise<RuntimeExtensionInfo[]> {
      const policy = extensionsPolicy(getSettings())
      // Discovery runs against the agent dir (user scope). Per-agent project
      // scope is resolved per turn from the agent's workspace; those paths
      // are surfaced too when the resolver reports them.
      const resources = await resolveExtensionResources(getPiPath(), getPiAgentDir())
      return resources.map((resource) => ({
        id: resource.path, // identity == the file the runtime would import
        label: labelFor(resource.path, resource.source),
        source: sourceLabel(resource.source, resource.scope),
        path: resource.path,
        status: policy.mode === 'none'
          ? 'blocked'
          : policy.mode === 'all' || policy.allow.includes(resource.path)
            ? 'allowed'
            : 'pending',
      }))
    },
  }
}
