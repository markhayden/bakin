import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { PluginContext } from '@bakin/core/plugin-types'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockSearchAdapter } from '@bakin/core/adapters/search/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'
import { PermissionDenied } from '../../packages/core/src/plugins/permissions'
import { addExecTool, getToolContext, removeExecToolsByPlugin } from '@/core/exec-tools/registry'
import { resetContentDir } from '../../src/core/content-dir'
import {
  resetPluginPermissionReportsForTests,
  wrapPluginContextPermissions,
} from '../../src/lib/plugin-permissions'

function makeContext() {
  const storage = {
    read: mock(() => null),
    write: mock(),
    append: mock(),
    exists: mock(() => false),
    readAll: mock(() => ({})),
  }
  const events = {
    emit: mock(),
    on: mock(() => mock()),
    once: mock(() => mock()),
  }
  const runtime = {
    cron: {
      create: mock(async () => ({ id: 'job-1' })),
    },
    images: {
      providers: mock(async () => []),
      generate: mock(async () => ({ images: [] })),
      edit: mock(async () => ({ images: [] })),
    },
  }
  const search = {
    index: mock(async () => {}),
    query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' } })),
  }
  const tasks = {
    create: mock(async () => ({ id: 'task-1' })),
    get: mock(async () => null),
  }
  const activity = {
    log: mock(),
    audit: mock(),
  }
  const assets = {
    createAsset: mock(async () => ({ assetId: '20260401-image-a1b2c3d4', version: 1 })),
  }

  const ctx = {
    pluginId: 'fixture',
    storage,
    events,
    runtime,
    search,
    tasks,
    assets,
    activity,
    registerNav: mock(),
    registerRoute: mock(),
    registerSlot: mock(),
    registerExecTool: mock(),
    registerSkill: mock(),
    registerWorkflow: mock(),
    registerNodeType: mock(),
    registerNotificationChannel: mock(),
    registerHealthCheck: mock(),
    watchFiles: mock(),
    getSettings: mock(() => ({})),
    updateSettings: mock(),
    hooks: {
      register: mock(),
      call: mock(),
      callAll: mock(),
      has: mock(),
      invoke: mock(),
    },
  } as unknown as PluginContext

  return { ctx, storage, events, runtime, search, tasks, assets, activity }
}

describe('plugin runtime permission wrapper', () => {
  let testDir: string
  const previousHome = process.env.BAKIN_HOME

  beforeEach(() => {
    testDir = join(tmpdir(), `bakin-plugin-perms-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    process.env.BAKIN_HOME = testDir
    resetContentDir()
    resetPluginPermissionReportsForTests()
  })

  afterEach(() => {
    process.env.BAKIN_HOME = previousHome
    resetContentDir()
    removeExecToolsByPlugin('fixture')
    delete (globalThis as { __bakinAppServices?: unknown }).__bakinAppServices
    rmSync(testDir, { recursive: true, force: true })
    mock.restore()
  })

  it('warn mode allows missing permissions and audits once per plugin/method/permission', () => {
    const { ctx, storage } = makeContext()
    const wrapped = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: [],
      mode: 'warn',
    })

    wrapped.storage.write('state.json', '{}')
    wrapped.storage.write('state.json', '{}')

    expect(storage.write).toHaveBeenCalledTimes(2)
    const auditPath = join(testDir, 'audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    const entries = readFileSync(auditPath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line))
    expect(entries).toHaveLength(1)
    expect(entries[0].event).toBe('plugin.permission_missing')
    expect(entries[0].data.method).toBe('ctx.storage.write')
    expect(entries[0].data.requiredPermission).toBe('storage.write')
  })

  it('enforce mode throws PermissionDenied for missing permissions', () => {
    const { ctx, storage } = makeContext()
    const wrapped = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: [],
      mode: 'enforce',
    })

    expect(() => wrapped.storage.write('state.json', '{}')).toThrow(PermissionDenied)
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('off mode leaves calls untouched', () => {
    const { ctx, storage } = makeContext()
    const wrapped = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: [],
      mode: 'off',
    })

    wrapped.storage.write('state.json', '{}')

    expect(storage.write).toHaveBeenCalledTimes(1)
    expect(existsSync(join(testDir, 'audit.jsonl'))).toBe(false)
  })

  it('uses lockfile-granted permissions for user plugins instead of trusting the manifest', () => {
    const { ctx, storage } = makeContext()
    const wrapped = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'user',
      manifestPermissions: ['storage.write'],
      lockfile: {
        version: 1,
        plugins: {
          fixture: {
            source: '/tmp/fixture',
            type: 'local',
            ref: '',
            commitSha: '',
            installedAt: new Date().toISOString(),
            version: '1.0.0',
            permissions: [],
            manifestSha: 'sha',
          },
        },
      },
      mode: 'enforce',
    })

    expect(() => wrapped.storage.write('state.json', '{}')).toThrow(PermissionDenied)
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('allows calls when the resolved grant contains the required permission', async () => {
    const { ctx, runtime, search, tasks } = makeContext()
    const wrapped = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: ['runtime.cron', 'search.write', 'tasks.write'],
      mode: 'enforce',
    })

    await wrapped.runtime.cron!.create({ id: 'job-1', schedule: '* * * * *', command: 'echo ok' } as never)
    await wrapped.search.index('key', {})
    await wrapped.tasks.create({ title: 'Task' })

    expect(runtime.cron!.create).toHaveBeenCalledTimes(1)
    expect(search.index).toHaveBeenCalledTimes(1)
    expect(tasks.create).toHaveBeenCalledTimes(1)
  })

  it('gates asset writes under assets.write', async () => {
    const { ctx, assets } = makeContext()
    const denied = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: ['assets.read'],
      mode: 'enforce',
    })

    expect(() => denied.assets.createAsset({
      sourceFilePath: '/tmp/image.png',
      taskId: 'task-1',
      type: 'images',
      agent: 'pixel',
    })).toThrow(PermissionDenied)
    expect(assets.createAsset).not.toHaveBeenCalled()

    const allowed = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: ['assets.write'],
      mode: 'enforce',
    })

    await allowed.assets.createAsset({
      sourceFilePath: '/tmp/image.png',
      taskId: 'task-1',
      type: 'images',
      agent: 'pixel',
    })
    expect(assets.createAsset).toHaveBeenCalledTimes(1)
  })

  it('gates runtime image generation under runtime.images', async () => {
    const { ctx, runtime } = makeContext()
    const denied = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: ['runtime.models'],
      mode: 'enforce',
    })

    expect(() => denied.runtime.images!.providers()).toThrow(PermissionDenied)
    expect(runtime.images.providers).not.toHaveBeenCalled()

    const allowed = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: ['runtime.images'],
      mode: 'enforce',
    })

    await allowed.runtime.images!.providers()
    expect(runtime.images.providers).toHaveBeenCalledTimes(1)
  })

  it('does not gate event subscriptions under events.emit', () => {
    const { ctx, events } = makeContext()
    const wrapped = wrapPluginContextPermissions(ctx, {
      pluginId: 'fixture',
      source: 'core',
      manifestPermissions: [],
      mode: 'enforce',
    })

    wrapped.events.on('file.*', () => {})
    expect(events.on).toHaveBeenCalledTimes(1)
    expect(() => wrapped.events.emit('custom.event')).toThrow(PermissionDenied)
  })

  it('wraps runtime-built exec tool contexts', () => {
    const runtime = createMockRuntimeAdapter()
    const search = createMockSearchAdapter()
    ;(globalThis as { __bakinAppServices?: unknown }).__bakinAppServices = {
      runtime,
      search,
      tasks: createMockBakinTaskStore(),
    }
    addExecTool({
      name: 'bakin_exec_fixture_probe',
      description: 'Probe permission wrapping',
      parameters: {},
      source: 'plugin:fixture',
      handler: async () => ({ ok: true }),
    })

    const ctx = getToolContext('bakin_exec_fixture_probe')
    expect(ctx).toBeDefined()

    ctx!.storage.write('state.json', '{}')

    const entries = readFileSync(join(testDir, 'audit.jsonl'), 'utf-8').trim().split('\n').map((line) => JSON.parse(line))
    expect(entries[0].event).toBe('plugin.permission_missing')
    expect(entries[0].data.method).toBe('ctx.storage.write')
    expect(entries[0].data.requiredPermission).toBe('storage.write')
  })
})
