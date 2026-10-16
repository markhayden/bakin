/**
 * The rules behind `ctx.operations` (#895 D19), shared by the host's plugin
 * context and the SDK testing harness so both behave identically:
 *
 * - `kind` and `fingerprint` are namespaced `<pluginId>:` and the owner is
 *   `plugin:<pluginId>` (separate from `origin`), so a plugin can neither
 *   attach to nor impersonate another owner's operation.
 * - Resources: every plugin may declare its own `<pluginId>:<name>`; the core
 *   resources (`install-state`, `media-store`, `search-engine`) are reserved
 *   for core plugins — the same rule as repair resource declarations (D10).
 * - `origin` comes from the triggering request (web or cli), else `system`.
 */
import { CORE_RESOURCES, type PluginOperationStartInput } from '@makinbakin/sdk/types'
import { operationOriginFromRequest } from './origin'
import type { StartOperationInput } from './registry'

export class OperationResourceDeniedError extends Error {
  constructor(public readonly pluginId: string, public readonly resource: string) {
    super(`Plugin "${pluginId}" may not declare operation resource "${resource}" — use "${pluginId}:<name>"${(CORE_RESOURCES as readonly string[]).includes(resource) ? ' (core resources are reserved for core plugins)' : ''}`)
    this.name = 'OperationResourceDeniedError'
  }
}

/** Throws `OperationResourceDeniedError` for the first resource `pluginId` may not declare. */
export function assertPluginResources(pluginId: string, isCore: boolean, resources: readonly string[]): void {
  for (const resource of resources) {
    const own = resource.startsWith(`${pluginId}:`) && resource.length > pluginId.length + 1
    const core = isCore && (CORE_RESOURCES as readonly string[]).includes(resource)
    if (!own && !core) throw new OperationResourceDeniedError(pluginId, resource)
  }
}

export function toPluginOperationInput<B>(
  pluginId: string,
  isCore: boolean,
  input: PluginOperationStartInput<B>,
): StartOperationInput<B> {
  const resources = input.resources ?? []
  assertPluginResources(pluginId, isCore, resources)
  return {
    kind: `${pluginId}:${input.kind}`,
    owner: `plugin:${pluginId}`,
    origin: input.request ? operationOriginFromRequest(input.request) : 'system',
    title: input.title,
    ...(input.href ? { href: input.href } : {}),
    fingerprint: `${pluginId}:${input.fingerprint}`,
    resources,
    plan: input.plan,
    run: input.run,
  }
}
