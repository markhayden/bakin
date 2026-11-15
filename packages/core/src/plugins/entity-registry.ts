/**
 * The linkable entity kinds loaded plugins declare
 * (`contributes.entities` in `bakin-plugin.json`), keyed by public id
 * `<pluginId>:<kind>`.
 *
 * Populated by the plugin registry from the freshly parsed manifest, only
 * after a plugin activates, and swept with the plugin's other registrations —
 * so a failed, disabled or removed plugin never leaves a kind behind.
 */
import type { EntityContribution } from '@makinbakin/sdk/types'
import { buildEntityHref, type EntityHrefOptions } from './entity-href'

export interface EntityDeclaration extends EntityContribution {
  /** The owning plugin. */
  pluginId: string
  /** Public identity: `<pluginId>:<kind>`. */
  id: string
}

export interface EntityRegistry {
  /** Replace everything `pluginId` declares. */
  publish(pluginId: string, entities: readonly EntityContribution[]): void
  /** Remove everything `pluginId` declares. */
  sweep(pluginId: string): void
  get(id: string): EntityDeclaration | undefined
  list(): EntityDeclaration[]
}

export function createEntityRegistry(): EntityRegistry {
  const byId = new Map<string, EntityDeclaration>()
  const sweep = (pluginId: string) => {
    for (const [id, entity] of byId) if (entity.pluginId === pluginId) byId.delete(id)
  }
  return {
    publish(pluginId, entities) {
      sweep(pluginId)
      for (const entity of entities) {
        const id = `${pluginId}:${entity.kind}`
        byId.set(id, { ...entity, pluginId, id })
      }
    },
    sweep,
    get: (id) => byId.get(id),
    list: () => [...byId.values()],
  }
}

const g = globalThis as { __bakinEntityRegistry?: EntityRegistry }

/** The process-wide registry (globalThis-backed: survives module re-evaluation). */
export function getEntityRegistry(): EntityRegistry {
  return (g.__bakinEntityRegistry ??= createEntityRegistry())
}

/**
 * Server-side link to an entity: the href its declared kind resolves to, or
 * `null` when the kind is not declared by a loaded plugin (or a placeholder
 * has no value). The browser twin is `entityHref` in
 * `@makinbakin/sdk/navigation`.
 */
export function entityHref(
  kind: string,
  id: string,
  options?: EntityHrefOptions,
  registry: EntityRegistry = getEntityRegistry(),
): string | null {
  const declaration = registry.get(kind)
  return declaration ? buildEntityHref(declaration.href, id, options) : null
}
