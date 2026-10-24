/** Owner-aware canonical Health registration stores. */
import type {
  HealthCheckDef,
  HealthCheckRegistrationInput,
  HealthIncidentDeclaration,
  HealthOwner,
  HealthRepairActionDef,
  HealthRepairActionDefinition,
} from '../../packages/core/src/plugin-types'
import { SHARED_ENGINE_ACTIONS } from '@bakin/core/health/authorize-mutation'
import { CORE_RESOURCES } from '@bakin/core/operations'
import {
  healthIncidentDeclarationSchema,
  parseHealthCheckRegistration,
  parseHealthRepairActionDefinition,
} from './health-contract'

export type {
  HealthCheckDef,
  HealthCheckRegistrationInput,
  HealthRepairActionDef,
  HealthRepairActionDefinition,
}

const checks = new Map<string, HealthCheckDef>()
const repairActions = new Map<string, HealthRepairActionDef>()
const changeListeners = new Set<(removedCheckIds: readonly string[]) => void>()

function owner(kind: HealthOwner['kind'], id: string, label: string): HealthOwner {
  return { kind, id, label }
}

function notifyChanged(removedCheckIds: readonly string[] = []): void {
  for (const listener of changeListeners) listener(removedCheckIds)
}

/** Cache/report layers subscribe so unregister cannot leave ghost snapshots. */
export function onHealthRegistryChanged(
  listener: (removedCheckIds: readonly string[]) => void,
): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

/** The canonical id an owner-local (or already canonical) repair reference names. */
export function canonicalRepairActionId(owner: HealthOwner, actionId: string): string {
  return actionId.startsWith(`${owner.id}.`) ? actionId : `${owner.id}.${actionId}`
}

/**
 * The canonical action a declared repair family (or an emitted repair
 * resolution) resolves to: a shared engine action verbatim, or an action
 * this owner registered. Null = dangling.
 */
export function resolveDeclaredRepairAction(owner: HealthOwner, actionId: string): string | null {
  if (SHARED_ENGINE_ACTIONS.includes(actionId)) return actionId
  const canonical = canonicalRepairActionId(owner, actionId)
  const action = repairActions.get(canonical)
  return action && action.owner.kind === owner.kind && action.owner.id === owner.id ? canonical : null
}

/**
 * Catalog validation names the DECLARATION that is wrong (self-healing 1.5):
 * the owner's activation fails with "incident <id>", never a zod path.
 * Shape issues (a human family without `needs`, a duplicate id) and dangling
 * repair actions are both refused here, before anything is registered.
 */
function validateIncidentCatalog(checkId: string, owner: HealthOwner, incidents: unknown): void {
  if (incidents === undefined) throw new Error(`Health check "${checkId}" declares no incident families — every check registers its finite \`incidents\` catalog (an empty list when it never raises one).`)
  if (!Array.isArray(incidents)) throw new Error(`Health check "${checkId}" declares incidents that are not a list.`)
  const seen = new Set<string>()
  incidents.forEach((entry, index) => {
    const id = entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' ? `"${(entry as { id: string }).id}"` : `#${index}`
    const parsed = healthIncidentDeclarationSchema.safeParse(entry)
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'declaration'}: ${issue.message}`).join('; ')
      throw new Error(`Health check "${checkId}" declares an invalid incident ${id}: ${issues}`)
    }
    const declaration: HealthIncidentDeclaration = parsed.data
    if (seen.has(declaration.id)) throw new Error(`Health check "${checkId}" declares incident "${declaration.id}" twice.`)
    seen.add(declaration.id)
    if (declaration.resolution.type === 'repair' && resolveDeclaredRepairAction(owner, declaration.resolution.actionId) === null) {
      throw new Error(
        `Health check "${checkId}" declares incident "${declaration.id}" with repair action "${declaration.resolution.actionId}", `
        + `which is neither registered for ${owner.id} nor a shared engine action (${SHARED_ENGINE_ACTIONS.join(', ')}). Register the action first.`,
      )
    }
  })
}

export function registerHealthCheck(def: HealthCheckDef): void {
  if (checks.has(def.id)) throw new Error(`Health check "${def.id}" is already registered`)
  validateIncidentCatalog(def.id, def.owner, def.incidents)
  // Validate only the producer-authored fields. Owner/id stamping is core data.
  const parsed = parseHealthCheckRegistration({
    id: def.localId,
    name: def.name,
    description: def.description,
    group: def.group,
    maxAgeMs: def.maxAgeMs,
    timeoutMs: def.timeoutMs,
    incidents: def.incidents,
    run: def.run,
  })
  checks.set(def.id, { ...parsed, id: def.id, localId: def.localId, owner: { ...def.owner } })
  notifyChanged()
}

export function registerOwnedHealthCheck(
  checkOwner: HealthOwner,
  input: HealthCheckRegistrationInput,
): string {
  const localId = typeof (input as { id?: unknown }).id === 'string' ? (input as { id: string }).id : '?'
  validateIncidentCatalog(`${checkOwner.id}.${localId}`, checkOwner, (input as { incidents?: unknown }).incidents)
  const parsed = parseHealthCheckRegistration(input)
  const id = `${checkOwner.id}.${parsed.id}`
  registerHealthCheck({ ...parsed, id, localId: parsed.id, owner: { ...checkOwner } })
  return id
}

export function getHealthCheck(id: string): HealthCheckDef | undefined {
  return checks.get(id)
}

export function listHealthChecks(): HealthCheckDef[] {
  return [...checks.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function unregisterHealthCheck(id: string): void {
  if (!checks.delete(id)) return
  notifyChanged([id])
}

export function registerHealthRepairAction(def: HealthRepairActionDef): void {
  if (repairActions.has(def.id)) throw new Error(`Health repair action "${def.id}" is already registered`)
  const parsed = parseHealthRepairActionDefinition({
    id: def.localId,
    name: def.name,
    effects: def.effects,
    ...(def.mutation ? { mutation: def.mutation } : {}),
    plan: def.plan,
    operationPlan: def.operationPlan,
    ...(def.resources ? { resources: def.resources } : {}),
    apply: def.apply,
  })
  repairActions.set(def.id, { ...parsed, id: def.id, localId: def.localId, owner: { ...def.owner } })
  notifyChanged()
}

/**
 * Declared repair resources are authorized against the registering owner
 * (#895 D10/D19): core code, adapters and core plugins may name the core
 * resources; every plugin may name its own `<pluginId>:<name>` resources;
 * anything else is refused at registration.
 */
function authorizeRepairResources(actionOwner: HealthOwner, actionId: string, resources: readonly string[], isCorePlugin: boolean): void {
  const allowed = (resource: string) => {
    if ((CORE_RESOURCES as readonly string[]).includes(resource)) return actionOwner.kind !== 'plugin' || isCorePlugin
    return actionOwner.kind === 'plugin' && resource.startsWith(`${actionOwner.id}:`) && resource.length > actionOwner.id.length + 1
  }
  const denied = resources.find((r) => !allowed(r))
  if (denied) throw new Error(`Health repair action "${actionOwner.id}.${actionId}" may not declare resource "${denied}" — core resources are reserved for core code and core plugins; plugins use "${actionOwner.id}:<name>"`)
}

export function registerOwnedHealthRepairAction(
  actionOwner: HealthOwner,
  input: HealthRepairActionDefinition,
  opts: { isCorePlugin?: boolean } = {},
): string {
  const parsed = parseHealthRepairActionDefinition(input)
  authorizeRepairResources(actionOwner, parsed.id, parsed.resources ?? [], opts.isCorePlugin ?? false)
  const id = `${actionOwner.id}.${parsed.id}`
  registerHealthRepairAction({ ...parsed, id, localId: parsed.id, owner: { ...actionOwner } })
  return id
}

export function getHealthRepairAction(id: string): HealthRepairActionDef | undefined {
  return repairActions.get(id)
}

export function listHealthRepairActions(): HealthRepairActionDef[] {
  return [...repairActions.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export function unregisterHealthRepairAction(id: string): void {
  if (repairActions.delete(id)) notifyChanged()
}

export function registerPluginHealthCheck(
  pluginId: string,
  input: HealthCheckRegistrationInput,
  label = pluginId,
): string {
  return registerOwnedHealthCheck(owner('plugin', pluginId, label), input)
}

export function registerPluginHealthRepairAction(
  pluginId: string,
  input: HealthRepairActionDefinition,
  label = pluginId,
  opts: { isCorePlugin?: boolean } = {},
): string {
  return registerOwnedHealthRepairAction(owner('plugin', pluginId, label), input, opts)
}

export function registerAdapterHealthCheck(
  adapterId: string,
  label: string,
  input: HealthCheckRegistrationInput,
): string {
  return registerOwnedHealthCheck(owner('adapter', adapterId, label), input)
}

export function registerAdapterHealthRepairAction(
  adapterId: string,
  label: string,
  input: HealthRepairActionDefinition,
): string {
  return registerOwnedHealthRepairAction(owner('adapter', adapterId, label), input)
}

export function registerCoreHealthCheck(
  input: HealthCheckRegistrationInput,
  coreId = 'core',
  label = 'Bakin',
): string {
  return registerOwnedHealthCheck(owner('core', coreId, label), input)
}

/** A repair action owned by core itself (`core.<id>`), beside the core checks. */
export function registerCoreHealthRepairAction(
  input: HealthRepairActionDefinition,
  coreId = 'core',
  label = 'Bakin',
): string {
  return registerOwnedHealthRepairAction(owner('core', coreId, label), input)
}

export function unregisterOwnerHealth(ownerKind: HealthOwner['kind'], ownerId: string): void {
  const removed: string[] = []
  for (const [id, def] of checks) {
    if (def.owner.kind === ownerKind && def.owner.id === ownerId) {
      checks.delete(id)
      removed.push(id)
    }
  }
  for (const [id, def] of repairActions) {
    if (def.owner.kind === ownerKind && def.owner.id === ownerId) repairActions.delete(id)
  }
  if (removed.length > 0) notifyChanged(removed)
  else notifyChanged()
}

export function unregisterPluginHealthChecks(pluginId: string): void {
  unregisterOwnerHealth('plugin', pluginId)
}
