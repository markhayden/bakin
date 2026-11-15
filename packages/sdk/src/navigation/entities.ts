/**
 * Browser entity registry — the linkable kinds loaded plugins declare
 * (`contributes.entities`), keyed by public id `<pluginId>:<kind>`.
 *
 * The host seeds it from `/api/plugins/manifest` and replaces it whole on
 * every manifest refresh, so a removed plugin's kinds disappear with it.
 * Everything that links to an entity resolves through here.
 */
import { buildEntityHref, type EntityHrefOptions } from '@bakin/core/plugins/entity-href'
import type { EntityContribution } from '../types/manifest'

/** A declared entity kind with its owner and public identity. */
export interface EntityDeclaration extends EntityContribution {
  /** The owning plugin. */
  pluginId: string
  /** Public identity: `<pluginId>:<kind>`. */
  id: string
}

let declarations = new Map<string, EntityDeclaration>()
let version = 0
const listeners = new Set<() => void>()

/** Replace every declaration. Host-only: called when manifest metadata is applied. */
export function setEntityDeclarations(next: readonly EntityDeclaration[]): void {
  declarations = new Map(next.map((entity) => [entity.id, entity]))
  version += 1
  for (const listener of listeners) listener()
}

/** The declaration for a public kind id (`projects:project`), if its plugin is loaded. */
export function getEntityDeclaration(id: string): EntityDeclaration | undefined {
  return declarations.get(id)
}

/** Changes whenever the registry is replaced: the `useSyncExternalStore` snapshot. */
export function getEntityDeclarationsVersion(): number {
  return version
}

/** Subscribe to registry replacement (`useSyncExternalStore`-shaped). */
export function subscribeEntityDeclarations(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * The in-app href for an entity: its declared kind's template filled with
 * `id`, plus `options.params` for a compound route and `options.query` for
 * extra query parameters. `null` when the kind is not declared by a loaded
 * plugin — render no link. Never build an entity URL by hand; the owning
 * plugin's manifest is the one place its route is written.
 */
export function entityHref(kind: string, id: string, options?: EntityHrefOptions): string | null {
  const declaration = declarations.get(kind)
  return declaration ? buildEntityHref(declaration.href, id, options) : null
}

export type { EntityHrefOptions }
