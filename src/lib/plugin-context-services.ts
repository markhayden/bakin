import { existsSync } from 'fs'
import { join } from 'path'
import type {
  AssetFileRef,
  AssetMeta,
  AssetSaveInput,
  AssetSaveResult,
  AssetsAPI,
  PluginTask,
  PluginTaskColumn,
  PluginTaskCreateInput,
  PluginTaskService,
  PluginTaskUpdateInput,
} from '@bakin/core/plugin-types'
import type { AgentRuntimeAdapter, ContentDeliveryArgs } from '@bakin/core/adapters/runtime'
import type { BakinTask, BakinTaskPatch, BakinTaskStore } from '@bakin/core/tasks/store'
import { getContentDir } from '../core/content-dir'

function isDoneColumn(column: string): boolean {
  return column === 'done' || column === 'archived'
}

function toPluginTask(task: BakinTask): PluginTask {
  return {
    id: task.id,
    title: task.title,
    agent: task.agent,
    createdBy: task.createdBy,
    checked: isDoneColumn(task.column),
    column: task.column as PluginTaskColumn,
    date: task.date,
    blockedReason: task.blockedReason,
    description: task.description,
    log: task.log.map(({ timestamp, author, message, data }) => ({ timestamp, author, message, data })),
    dependsOn: task.dependsOn,
    parentId: task.parentId,
    workflowId: task.workflowId,
    scheduleJobId: task.scheduleJobId,
    projectId: task.projectId,
    availableAt: task.availableAt,
    dueAt: task.dueAt,
    source: task.source,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function taskPatchFromPublic(patch: PluginTaskUpdateInput): BakinTaskPatch {
  const next: BakinTaskPatch = {}
  if ('title' in patch) next.title = patch.title
  if ('description' in patch) next.description = patch.description
  if ('agent' in patch) next.agent = patch.agent
  if ('createdBy' in patch) next.createdBy = patch.createdBy
  if ('column' in patch && patch.column) next.column = patch.column
  if ('checked' in patch && patch.checked !== undefined) next.column = patch.checked ? 'done' : 'todo'
  if ('date' in patch) next.date = patch.date
  if ('blockedReason' in patch) next.blockedReason = patch.blockedReason
  if ('workflowId' in patch) next.workflowId = patch.workflowId
  if ('scheduleJobId' in patch) next.scheduleJobId = patch.scheduleJobId
  if ('projectId' in patch) next.projectId = patch.projectId
  if ('parentId' in patch) next.parentId = patch.parentId
  if ('availableAt' in patch) next.availableAt = patch.availableAt || undefined
  if ('dueAt' in patch) next.dueAt = patch.dueAt || undefined
  if ('source' in patch) next.source = patch.source || undefined
  return next
}

export function createPluginTaskService(store: BakinTaskStore): PluginTaskService {
  async function requireTask(id: string): Promise<BakinTask> {
    const task = await store.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task
  }

  return {
    async create(input: PluginTaskCreateInput): Promise<PluginTask> {
      const { createTaskWithEffects } = await import('../core/task-service')
      const created = await createTaskWithEffects({
        id: input.id,
        title: input.title,
        column: input.column,
        assignee: input.agent,
        description: input.description,
        workflowId: input.workflowId,
        skipWorkflowReason: input.skipWorkflowReason,
        createdBy: input.createdBy,
        parentId: input.parentId ?? undefined,
        projectId: input.projectId,
        availableAt: input.availableAt,
        dueAt: input.dueAt,
        source: input.source,
        date: input.date,
        channel: 'rest',
      })
      const task = await requireTask(created.id)
      return toPluginTask(task)
    },

    async update(id: string, patch: PluginTaskUpdateInput): Promise<PluginTask> {
      const task = await requireTask(id)
      return toPluginTask(await store.update(task.id, taskPatchFromPublic(patch)))
    },

    async move(id: string, column: PluginTaskColumn, order?: number): Promise<PluginTask> {
      const task = await requireTask(id)
      return toPluginTask(await store.move(task.id, column, order))
    },

    async remove(id: string): Promise<void> {
      const { deleteTask } = await import('../core/task-store')
      await deleteTask(id)
    },

    async get(id: string): Promise<PluginTask | null> {
      const task = await store.get(id)
      return task ? toPluginTask(task) : null
    },

    async list(filter = {}): Promise<PluginTask[]> {
      const tasks = await store.list({
        column: filter.column,
        agent: filter.agent,
        projectId: filter.projectId,
      })
      return tasks.map(toPluginTask)
    },

    async appendLog(id: string, entry): Promise<void> {
      const task = await requireTask(id)
      await store.appendLog(task.id, entry)
    },
  }
}

function toAssetMeta(asset: {
  path: string
  filename: string
  type: string
  mimeType: string
  size: number
  mtimeMs?: number
  metadata: AssetMeta['metadata']
}): AssetMeta {
  return {
    path: asset.path,
    filename: asset.filename,
    type: asset.type as AssetMeta['type'],
    mimeType: asset.mimeType,
    size: asset.size,
    mtimeMs: asset.mtimeMs,
    metadata: asset.metadata,
  }
}

export function createPluginAssetsAPI(): AssetsAPI {
  return {
    async save(input: AssetSaveInput): Promise<AssetSaveResult> {
      const [{ saveAsset }, { upsertAsset }] = await Promise.all([
        import('../../plugins/assets/lib/save-asset'),
        import('../../plugins/assets/lib/asset-index'),
      ])
      const result = await saveAsset(input)
      if (result.ok && typeof result.path === 'string') upsertAsset(result.path)
      return result
    },

    async getByFilename(filename: string): Promise<AssetMeta | null> {
      const [{ getAsset }, { pathForFilename }] = await Promise.all([
        import('../../plugins/assets/lib/asset-index'),
        import('../../plugins/assets/lib/path-for-filename'),
      ])
      const path = pathForFilename(filename)
      const asset = path ? getAsset(path) : null
      return asset ? toAssetMeta(asset) : null
    },

    async list(filter = {}): Promise<AssetMeta[]> {
      const { listAssets } = await import('../../plugins/assets/lib/asset-index')
      return listAssets({
        type: filter.type,
        taskId: filter.taskId ?? undefined,
      }).map(toAssetMeta)
    },

    async exists(filename: string): Promise<boolean> {
      return (await this.getByFilename(filename)) !== null
    },

    async fileRef(filename: string): Promise<AssetFileRef> {
      const asset = await this.getByFilename(filename)
      if (!asset) throw new Error(`Asset not found: ${filename}`)
      return { kind: 'asset', filename: asset.filename, mimeType: asset.mimeType }
    },
  }
}

async function resolveAssetFile(ref: AssetFileRef): Promise<{ name: string; path: string; contentType?: string }> {
  const { pathForFilename, isSafeCanonicalFilename } = await import('../../plugins/assets/lib/path-for-filename')
  if (!isSafeCanonicalFilename(ref.filename)) throw new Error(`Invalid asset filename: ${ref.filename}`)
  const rel = pathForFilename(ref.filename)
  if (!rel) throw new Error(`Invalid asset filename: ${ref.filename}`)
  const abs = join(getContentDir(), rel)
  if (!existsSync(abs)) throw new Error(`Asset file not found: ${ref.filename}`)
  return { name: ref.filename, path: abs, contentType: ref.mimeType }
}

function isAssetFileRef(file: AssetFileRef | { name: string; path: string; contentType?: string }): file is AssetFileRef {
  return 'kind' in file && file.kind === 'asset'
}

async function resolveContentDeliveryArgs(
  args: ContentDeliveryArgs & { content: ContentDeliveryArgs['content'] & { files?: Array<AssetFileRef | { name: string; path: string; contentType?: string }> } },
): Promise<ContentDeliveryArgs> {
  const files = args.content.files
    ? await Promise.all(args.content.files.map(file => isAssetFileRef(file) ? resolveAssetFile(file) : file))
    : undefined
  return {
    ...args,
    content: {
      ...args.content,
      ...(files ? { files } : {}),
    },
  }
}

/**
 * User-installed plugins receive the SDK-shaped runtime facade. Built-in core
 * plugins still receive the full adapter while the extraction work is in
 * flight, but this prevents official/external plugins from reaching raw
 * runtime config, workspace mutation, or provider-specific escape hatches.
 */
export function createPluginRuntimeFacade(runtime: AgentRuntimeAdapter): AgentRuntimeAdapter {
  return {
    name: runtime.name,
    version: runtime.version,
    requiredCoreVersion: runtime.requiredCoreVersion,
    initialize: runtime.initialize.bind(runtime),
    shutdown: runtime.shutdown.bind(runtime),
    ping: runtime.ping.bind(runtime),
    restart: runtime.restart.bind(runtime),
    getHealthChecks: runtime.getHealthChecks.bind(runtime),
    agents: {
      list: runtime.agents.list.bind(runtime.agents),
      get: runtime.agents.get.bind(runtime.agents),
      create: async () => { throw new Error('Runtime agent creation is not exposed to plugins') },
      update: async () => { throw new Error('Runtime agent mutation is not exposed to plugins') },
      remove: async () => { throw new Error('Runtime agent mutation is not exposed to plugins') },
      listWorkspaceFiles: async () => { throw new Error('Runtime workspace files are not exposed to plugins') },
      readWorkspaceFile: async () => { throw new Error('Runtime workspace files are not exposed to plugins') },
      writeWorkspaceFile: async () => { throw new Error('Runtime workspace files are not exposed to plugins') },
      removeWorkspaceFile: async () => { throw new Error('Runtime workspace files are not exposed to plugins') },
      updatePermissions: async () => { throw new Error('Runtime permissions are not exposed to plugins') },
      updateAllowlist: async () => { throw new Error('Runtime allowlists are not exposed to plugins') },
      heartbeat: runtime.agents.heartbeat.bind(runtime.agents),
    },
    messaging: {
      send: runtime.messaging.send.bind(runtime.messaging),
      stream: runtime.messaging.stream.bind(runtime.messaging),
    },
    tools: {
      invoke: async () => { throw new Error('Runtime tool invocation is not exposed to plugins') },
      list: async () => [],
    },
    channels: {
      list: runtime.channels.list.bind(runtime.channels),
      sendNotification: runtime.channels.sendNotification.bind(runtime.channels),
      sendMessage: runtime.channels.sendMessage.bind(runtime.channels),
      deliverContent: async (args) => runtime.channels.deliverContent(await resolveContentDeliveryArgs(args)),
      createApproval: runtime.channels.createApproval.bind(runtime.channels),
      editApproval: runtime.channels.editApproval.bind(runtime.channels),
      cancelApproval: runtime.channels.cancelApproval.bind(runtime.channels),
      resolveApproval: runtime.channels.resolveApproval.bind(runtime.channels),
      subscribeApprovalResponses: runtime.channels.subscribeApprovalResponses.bind(runtime.channels),
      onMessage: runtime.channels.onMessage.bind(runtime.channels),
      onInteraction: runtime.channels.onInteraction.bind(runtime.channels),
    },
    skills: {
      list: runtime.skills.list.bind(runtime.skills),
      get: runtime.skills.get.bind(runtime.skills),
      write: async () => { throw new Error('Runtime skill mutation is not exposed to plugins') },
      remove: async () => { throw new Error('Runtime skill mutation is not exposed to plugins') },
    },
    sessions: {
      list: runtime.sessions.list.bind(runtime.sessions),
      get: runtime.sessions.get.bind(runtime.sessions),
    },
    memory: {
      listTiers: runtime.memory.listTiers.bind(runtime.memory),
      listEntries: runtime.memory.listEntries.bind(runtime.memory),
      getEntry: runtime.memory.getEntry.bind(runtime.memory),
      statEntry: runtime.memory.statEntry.bind(runtime.memory),
      readEntryRange: runtime.memory.readEntryRange.bind(runtime.memory),
      resolvePath: runtime.memory.resolvePath.bind(runtime.memory),
      watchPaths: runtime.memory.watchPaths.bind(runtime.memory),
      search: runtime.memory.search.bind(runtime.memory),
    },
    models: {
      listAvailable: runtime.models.listAvailable.bind(runtime.models),
    },
    tasks: {
      dispatch: runtime.tasks.dispatch.bind(runtime.tasks),
      getExecutionStatus: runtime.tasks.getExecutionStatus.bind(runtime.tasks),
      listExecutions: runtime.tasks.listExecutions.bind(runtime.tasks),
      cancelExecution: runtime.tasks.cancelExecution.bind(runtime.tasks),
      subscribeExecutionUpdates: runtime.tasks.subscribeExecutionUpdates.bind(runtime.tasks),
    },
    cron: {
      list: runtime.cron.list.bind(runtime.cron),
      get: runtime.cron.get.bind(runtime.cron),
      create: runtime.cron.create.bind(runtime.cron),
      update: runtime.cron.update.bind(runtime.cron),
      remove: runtime.cron.remove.bind(runtime.cron),
      runNow: runtime.cron.runNow.bind(runtime.cron),
      listRuns: runtime.cron.listRuns.bind(runtime.cron),
      getRaw: runtime.cron.getRaw.bind(runtime.cron),
      restoreRaw: runtime.cron.restoreRaw.bind(runtime.cron),
    },
    config: {
      get: async () => { throw new Error('Runtime config is not exposed to plugins') },
      update: async () => { throw new Error('Runtime config is not exposed to plugins') },
      replace: async () => { throw new Error('Runtime config is not exposed to plugins') },
      raw: async () => { throw new Error('Runtime config is not exposed to plugins') },
    },
  }
}
