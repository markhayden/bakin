/** Owner-aware canonical Health registration stores. */
import type {
  HealthCheckDef,
  HealthCheckRegistrationInput,
  HealthOwner,
  HealthRepairActionDef,
  HealthRepairActionDefinition,
} from '../../packages/core/src/plugin-types'
import { CORE_RESOURCES } from '@bakin/core/operations'
import {
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

export function registerHealthCheck(def: HealthCheckDef): void {
  if (checks.has(def.id)) throw new Error(`Health check "${def.id}" is already registered`)
  // Validate only the producer-authored fields. Owner/id stamping is core data.
  const parsed = parseHealthCheckRegistration({
    id: def.localId,
    name: def.name,
    description: def.description,
    group: def.group,
    maxAgeMs: def.maxAgeMs,
    timeoutMs: def.timeoutMs,
    run: def.run,
  })
  checks.set(def.id, { ...parsed, id: def.id, localId: def.localId, owner: { ...def.owner } })
  notifyChanged()
}

export function registerOwnedHealthCheck(
  checkOwner: HealthOwner,
  input: HealthCheckRegistrationInput,
): string {
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
