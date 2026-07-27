import type { PluginContext } from '@bakin/core/plugin-types'
import type { Permission } from '../../packages/core/src/plugins/permissions'
import { PermissionDenied } from '../../packages/core/src/plugins/permissions'
import type { PluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { readPluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { getSettings } from '../core/settings'
import { getContentDir } from '../core/content-dir'
import { appendAudit } from '../core/audit'
import { createLogger } from '../core/logger'

export type PluginRuntimeCapabilityMode = 'off' | 'warn' | 'enforce'
export type PluginPermissionSource = 'core' | 'user'
type PermissionedPluginContext = Pick<
  PluginContext,
  'storage' | 'events' | 'runtime' | 'tasks' | 'assets' | 'activity' | 'search'
>

interface PermissionedContextOptions {
  pluginId: string
  source: PluginPermissionSource
  manifestPermissions?: readonly string[]
  mode?: PluginRuntimeCapabilityMode
  lockfile?: PluginLockfile
}

interface PermissionCheckInput {
  pluginId: string
  method: string
  permission: Permission
  mode: PluginRuntimeCapabilityMode
  grantedPermissions: ReadonlySet<string>
}

const log = createLogger('plugin-permissions')
const reportedMissingPermissions = new Set<string>()
const reportedGrantFallbacks = new Set<string>()

const METHOD_PERMISSIONS: Record<string, Permission> = {
  'storage.read': 'storage.read',
  'storage.exists': 'storage.read',
  'storage.readAll': 'storage.read',
  'storage.list': 'storage.read',
  'storage.stat': 'storage.read',
  'storage.readJson': 'storage.read',
  'storage.searchPath': 'storage.read',
  'storage.write': 'storage.write',
  'storage.append': 'storage.write',
  'storage.remove': 'storage.write',
  'storage.rename': 'storage.write',
  'storage.writeJson': 'storage.write',

  'events.emit': 'events.emit',
  'activity.log': 'events.emit',
  'activity.audit': 'events.emit',

  'tasks.get': 'tasks.read',
  'tasks.list': 'tasks.read',
  'tasks.create': 'tasks.write',
  'tasks.update': 'tasks.write',
  'tasks.move': 'tasks.write',
  'tasks.remove': 'tasks.write',
  'tasks.appendLog': 'tasks.write',

  'assets.resolveVersionFile': 'assets.read',
  'assets.getAsset': 'assets.read',
  'assets.createAsset': 'assets.write',
  'assets.addVersion': 'assets.write',
  'assets.addExport': 'assets.write',

  'search.registerContentType': 'search.write',
  'search.registerFileBackedContentType': 'search.write',
  'search.index': 'search.write',
  'search.remove': 'search.write',
  'search.transform': 'search.write',
  'search.query': 'search.read',
  'search.health': 'search.read',
  'search.maintenance.available': 'search.read',
  'search.maintenance.scan': 'search.read',
  'search.maintenance.batchRemove': 'search.write',
}

const RUNTIME_DOMAIN_PERMISSIONS: Record<string, Permission> = {
  agents: 'runtime.agents',
  messaging: 'runtime.messaging',
  channels: 'runtime.channels',
  cron: 'runtime.cron',
  skills: 'runtime.skills',
  models: 'runtime.models',
  images: 'runtime.images',
  sessions: 'runtime.read',
  memory: 'runtime.read',
  config: 'runtime.read',
}

for (const method of ['initialize', 'shutdown', 'ping', 'restart']) {
  METHOD_PERMISSIONS[`runtime.${method}`] = 'runtime.read'
}

for (const [domain, permission] of Object.entries(RUNTIME_DOMAIN_PERMISSIONS)) {
  for (const method of ['list', 'get', 'create', 'update', 'remove', 'listWorkspaceFiles', 'readWorkspaceFile', 'writeWorkspaceFile', 'removeWorkspaceFile', 'updateAllowlist', 'send', 'stream', 'sendNotification', 'sendMessage', 'deliverContent', 'createApproval', 'editApproval', 'cancelApproval', 'resolveApproval', 'subscribeApprovalResponses', 'subscribeInboundMessages', 'sendTyping', 'createThread', 'editMessage', 'write', 'listTiers', 'listEntries', 'getEntry', 'statEntry', 'readEntryRange', 'resolvePath', 'watchPaths', 'search', 'listAvailable', 'providers', 'generate', 'edit', 'runNow', 'listRuns', 'getRaw', 'restoreRaw', 'replace', 'raw']) {
    METHOD_PERMISSIONS[`runtime.${domain}.${method}`] = permission
  }
}

function getMode(override?: PluginRuntimeCapabilityMode): PluginRuntimeCapabilityMode {
  if (override) return override
  const mode = getSettings().plugins?.runtimeCapabilityMode
  if (mode === 'off' || mode === 'warn' || mode === 'enforce') return mode
  return 'warn'
}

function warnGrantFallback(pluginId: string, message: string): void {
  if (reportedGrantFallbacks.has(pluginId)) return
  reportedGrantFallbacks.add(pluginId)
  log.warn(message, { pluginId })
}

function resolveGrantedPermissions(opts: PermissionedContextOptions): ReadonlySet<string> {
  const manifestPermissions = opts.manifestPermissions ?? []
  if (opts.source === 'core') return new Set(manifestPermissions)

  try {
    const lock = opts.lockfile ?? readPluginLockfile()
    const entry = lock.plugins[opts.pluginId]
    if (entry) return new Set(entry.permissions)
    warnGrantFallback(
      opts.pluginId,
      `User plugin "${opts.pluginId}" has no lockfile entry; falling back to manifest permissions for runtime capability checks.`,
    )
  } catch (err) {
    warnGrantFallback(
      opts.pluginId,
      `Failed to read plugin lockfile for "${opts.pluginId}"; falling back to manifest permissions for runtime capability checks.`,
    )
    log.warn('Plugin lockfile read failed during permission resolution', err, { pluginId: opts.pluginId })
  }

  return new Set(manifestPermissions)
}

function reportMissingPermission(input: PermissionCheckInput): void {
  const key = `${input.pluginId}:${input.permission}:${input.method}`
  if (reportedMissingPermissions.has(key)) return
  reportedMissingPermissions.add(key)

  const data = {
    pluginId: input.pluginId,
    method: input.method,
    requiredPermission: input.permission,
    mode: input.mode,
  }
  log.warn(
    `Plugin "${input.pluginId}" used ${input.method} without declaring "${input.permission}"`,
    data,
  )
  appendAudit(getContentDir(), 'plugin.permission_missing', 'system', data, 'system')
}

function checkPermission(input: PermissionCheckInput): void {
  if (input.mode === 'off') return
  if (input.grantedPermissions.has(input.permission)) return

  reportMissingPermission(input)
  if (input.mode === 'enforce') {
    throw new PermissionDenied({
      pluginId: input.pluginId,
      permission: input.permission,
      method: input.method,
    })
  }
}

function wrapObject<T extends object>(
  target: T,
  prefix: string,
  opts: { pluginId: string; mode: PluginRuntimeCapabilityMode; grantedPermissions: ReadonlySet<string> },
  cache: WeakMap<object, object>,
): T {
  const cached = cache.get(target)
  if (cached) return cached as T

  const proxy = new Proxy(target, {
    get(currentTarget, prop, receiver) {
      const value = Reflect.get(currentTarget, prop, receiver)
      if (typeof prop !== 'string') return value
      const method = `${prefix}.${prop}`

      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const permission = METHOD_PERMISSIONS[method]
          if (permission) {
            checkPermission({
              pluginId: opts.pluginId,
              method: `ctx.${method}`,
              permission,
              mode: opts.mode,
              grantedPermissions: opts.grantedPermissions,
            })
          }
          return value.apply(currentTarget, args)
        }
      }

      if (value && typeof value === 'object') {
        return wrapObject(value, method, opts, cache)
      }

      return value
    },
  })
  cache.set(target, proxy)
  return proxy
}

export function wrapPluginContextPermissions<T extends PermissionedPluginContext>(
  ctx: T,
  opts: PermissionedContextOptions,
): T {
  const mode = getMode(opts.mode)
  if (mode === 'off') return ctx

  const grantedPermissions = resolveGrantedPermissions(opts)
  const cache = new WeakMap<object, object>()

  return {
    ...ctx,
    storage: wrapObject(ctx.storage, 'storage', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
    events: wrapObject(ctx.events, 'events', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
    runtime: wrapObject(ctx.runtime, 'runtime', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
    tasks: wrapObject(ctx.tasks, 'tasks', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
    assets: wrapObject(ctx.assets, 'assets', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
    activity: wrapObject(ctx.activity, 'activity', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
    search: wrapObject(ctx.search, 'search', { pluginId: opts.pluginId, mode, grantedPermissions }, cache),
  } as T
}

export function resetPluginPermissionReportsForTests(): void {
  reportedMissingPermissions.clear()
  reportedGrantFallbacks.clear()
}
