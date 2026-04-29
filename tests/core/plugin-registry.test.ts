import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { HookRegistry } from '../../packages/core/src/hooks/hook-registry'
import { createHealthService } from '@bakin/core/app-services'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockSearchAdapter } from '@bakin/core/adapters/search/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

// ---------------------------------------------------------------------------
// Section A: HookRegistry (standalone — no mocks needed)
// ---------------------------------------------------------------------------

describe('HookRegistry', () => {
  let registry: HookRegistry

  beforeEach(() => {
    registry = new HookRegistry()
  })

  it('register() makes has() return true', () => {
    registry.register('test.hook', () => {})
    expect(registry.has('test.hook')).toBe(true)
  })

  it('has() returns false for unregistered hooks', () => {
    expect(registry.has('nonexistent')).toBe(false)
  })

  it('unsubscribe removes handler and has() returns false', () => {
    const unsub = registry.register('test.hook', () => {})
    unsub()
    expect(registry.has('test.hook')).toBe(false)
  })

  it('call() returns original data when no handlers registered', async () => {
    const result = await registry.call('empty', { value: 42 })
    expect(result).toEqual({ value: 42 })
  })

  it('call() chains multiple handlers in waterfall', async () => {
    registry.register('math', (n: number) => n + 1)
    registry.register('math', (n: number) => n * 2)
    const result = await registry.call('math', 5)
    expect(result).toBe(12) // (5 + 1) * 2
  })

  it('call() skips handler result when it returns null or undefined', async () => {
    registry.register('skip', () => null)
    registry.register('skip', (n: number) => n + 10)
    const result = await registry.call('skip', 5)
    expect(result).toBe(15) // null skipped, 5 + 10
  })

  it('callAll() invokes all handlers and ignores return values', async () => {
    const spy1 = mock()
    const spy2 = mock()
    registry.register('notify', spy1)
    registry.register('notify', spy2)
    await registry.callAll('notify', { event: 'ping' })
    expect(spy1).toHaveBeenCalledWith({ event: 'ping' })
    expect(spy2).toHaveBeenCalledWith({ event: 'ping' })
  })

  it('invoke() calls only the first registered handler', async () => {
    const spy1 = mock().mockReturnValue('first')
    const spy2 = mock().mockReturnValue('second')
    registry.register('rpc', spy1)
    registry.register('rpc', spy2)
    const result = await registry.invoke<string>('rpc', 'input')
    expect(result).toBe('first')
    expect(spy1).toHaveBeenCalledWith('input')
    expect(spy2).not.toHaveBeenCalled()
  })

  it('invoke() returns undefined when no handlers exist', async () => {
    const result = await registry.invoke('missing', 'data')
    expect(result).toBeUndefined()
  })

  it('getRegisteredHooks() lists all registered hook names', () => {
    registry.register('alpha', () => {})
    registry.register('beta', () => {})
    const hooks = registry.getRegisteredHooks()
    expect(hooks).toContain('alpha')
    expect(hooks).toContain('beta')
    expect(hooks).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Section B: PluginRegistryImpl
//
// The registry uses dynamic import() inside loadPlugin, which makes it hard
// to test via initialize(). Instead, we test the public API by:
// 1. Mocking external deps so the module can be imported
// 2. Using vi.resetModules() to get fresh singletons per test
// 3. Calling initialize() with real temp-dir plugins (CommonJS .js files)
// ---------------------------------------------------------------------------

// These vi.mock calls are hoisted — they use paths relative to THIS file,
// matching how vitest resolves them (same as the source's imports via aliases).
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('@/core/api-docs', () => ({
  registerRouteDoc: mock(),
}))

mock.module('@/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: mock(),
  getBakinPaths: mock(() => ({})),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('@/core/migrations', () => ({
  runMigrations: mock().mockResolvedValue(0),
}))

mock.module('../../scripts/lib/registry', () => ({
  addExecTool: mock(),
  removeExecToolsByPlugin: mock(() => 0),
}))

describe('PluginRegistryImpl', () => {
  let tempDir: string
  let pluginRegistry: any
  let getHookRegistry: any
  let getPluginSkills: any
  let mockGetContentDir: any
  let mockAppendAudit: any
  let mockAddExecTool: any
  let mockRegisterRouteDoc: any

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-reg-'))
    // Point user plugins to a non-existent dir (no user plugins by default)
    process.env.BAKIN_HOME = join(tempDir, 'bakin-home')
    // Clear globalThis singletons for fresh instances
    delete (globalThis as any).__bakinPluginRegistry
    delete (globalThis as any).__bakinHookRegistry
    const runtime = createMockRuntimeAdapter()
    const search = createMockSearchAdapter()
    ;(globalThis as any).__bakinAppServices = {
      runtime,
      search,
      tasks: createMockBakinTaskStore(),
      health: createHealthService([runtime, search]),
    }

    // Reset modules to get a fresh registry singleton
    vi.resetModules()

    // Dynamic import to get fresh module with fresh singleton
    const contentDir = await import('@/core/content-dir')
    mockGetContentDir = vi.mocked(contentDir.getContentDir)
    mockGetContentDir.mockReturnValue(tempDir)

    const audit = await import('@/core/audit')
    mockAppendAudit = vi.mocked(audit.appendAudit)

    const scriptReg = await import('../../scripts/lib/registry')
    mockAddExecTool = vi.mocked(scriptReg.addExecTool)

    const apiDocs = await import('@/core/api-docs')
    mockRegisterRouteDoc = vi.mocked(apiDocs.registerRouteDoc)

    const mod = await import('@/lib/plugin-registry')
    pluginRegistry = mod.pluginRegistry
    getHookRegistry = mod.getHookRegistry
    getPluginSkills = mod.getPluginSkills
    // bun:test has no vi.resetModules; reset the singleton via its own API
    pluginRegistry._resetForTests()
    // Also clear the hook registry — it's a separate globalThis singleton
    const hookReg = getHookRegistry?.()
    hookReg?.clearAll?.()
  })

  afterEach(() => {
    delete process.env.BAKIN_HOME
    // Clean up any globalThis test vars
    for (const key of Object.keys(globalThis)) {
      if (key.startsWith('__') && key !== '__bakinPluginRegistry' && key !== '__bakinHookRegistry') {
        delete (globalThis as any)[key]
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  // Helpers

  function mockStorage() {
    return { read: mock(), write: mock(), append: mock(), exists: mock(), readAll: mock() }
  }

  function mockEvents() {
    return { emit: mock(), on: mock(), once: mock() }
  }

  /**
   * Write a fake plugin as a CommonJS .js file in tempDir.
   * The import path in loadPlugin is `../../${pluginPath}`, so we use
   * absolute paths and the plugin writes its own index.js.
   *
   * NOTE: fake plugins live under tempDir/fake-plugins/ (NOT tempDir/plugins/)
   * because the content dir is also tempDir — if we put them in plugins/,
   * loadUserPlugins would find them and try to re-load them as user plugins.
   */
  function writeFakePlugin(
    id: string,
    opts: {
      deps?: string[]
      activate?: string
      navItems?: string
      settingsSchema?: string
      onReady?: string
      onShutdown?: string
      onSettingsChange?: string
    } = {},
  ): string {
    const pluginDir = join(tempDir, 'fake-plugins', id)
    mkdirSync(pluginDir, { recursive: true })

    const manifest = {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      version: '1.0.0',
      description: `Test plugin ${id}`,
      dependencies: opts.deps || [],
    }
    writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify(manifest))

    writeFileSync(
      join(pluginDir, 'index.js'),
      `const plugin = {
        id: '${id}',
        name: '${id.charAt(0).toUpperCase() + id.slice(1)}',
        version: '1.0.0',
        navItems: ${opts.navItems || '[]'},
        settingsSchema: ${opts.settingsSchema || 'undefined'},
        onReady: ${opts.onReady || 'undefined'},
        onShutdown: ${opts.onShutdown || 'undefined'},
        onSettingsChange: ${opts.onSettingsChange || 'undefined'},
        activate: function(ctx) { ${opts.activate || ''} },
      }
      module.exports = plugin
      module.exports.default = plugin`,
    )

    return pluginDir
  }

  function writeUserPlugin(
    id: string,
    opts: {
      deps?: string[]
      activate?: string
      manifest?: Record<string, unknown>
      root?: string
    } = {},
  ): string {
    const pluginDir = join(opts.root ?? join(tempDir, 'plugins'), id)
    mkdirSync(pluginDir, { recursive: true })
    const manifest = {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      version: '1.0.0',
      bakin: '>=1.0.0',
      description: `User plugin ${id}`,
      entry: { server: 'index.js' },
      dependencies: opts.deps ?? [],
      permissions: [],
      ...opts.manifest,
    }
    writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify(manifest))
    writeFileSync(
      join(pluginDir, 'index.js'),
      `const plugin = {
        id: '${id}',
        name: '${id.charAt(0).toUpperCase() + id.slice(1)}',
        version: '1.0.0',
        activate: function(ctx) { ${opts.activate || ''} },
      }
      module.exports = plugin
      module.exports.default = plugin`,
    )
    return pluginDir
  }

  // -------------------------------------------------------------------------
  // B1: topologicalSort (tested indirectly via initialize)
  // -------------------------------------------------------------------------

  describe('topologicalSort', () => {
    it('preserves config order when no dependencies', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `global.__order = global.__order || []; global.__order.push('alpha')`,
      })
      const pathB = writeFakePlugin('bravo', {
        activate: `global.__order = global.__order || []; global.__order.push('bravo')`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      expect((globalThis as any).__order).toEqual(['alpha', 'bravo'])
    })

    it('resolves linear dependency chain', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `global.__order = global.__order || []; global.__order.push('alpha')`,
      })
      const pathB = writeFakePlugin('bravo', {
        deps: ['alpha'],
        activate: `global.__order = global.__order || []; global.__order.push('bravo')`,
      })
      const pathC = writeFakePlugin('charlie', {
        deps: ['bravo'],
        activate: `global.__order = global.__order || []; global.__order.push('charlie')`,
      })

      await pluginRegistry.initialize(
        // Provide in reverse order to prove sorting works
        { plugins: [{ path: pathC }, { path: pathB }, { path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      expect((globalThis as any).__order).toEqual(['alpha', 'bravo', 'charlie'])
    })

    it('skips disabled plugins', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `global.__order = global.__order || []; global.__order.push('alpha')`,
      })
      const pathB = writeFakePlugin('bravo', {
        activate: `global.__order = global.__order || []; global.__order.push('bravo')`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA, enabled: true }, { path: pathB, enabled: false }] },
        mockStorage(),
        mockEvents(),
      )

      expect((globalThis as any).__order).toEqual(['alpha'])
    })

    it('initialize is idempotent — second call is a no-op', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `global.__initCount = (global.__initCount || 0) + 1`,
      })

      const config = { plugins: [{ path: pathA }] }
      await pluginRegistry.initialize(config, mockStorage(), mockEvents())
      await pluginRegistry.initialize(config, mockStorage(), mockEvents())

      expect((globalThis as any).__initCount).toBe(1)
    })
  })

  // -------------------------------------------------------------------------
  // B2: buildContext & registration
  // -------------------------------------------------------------------------

  describe('buildContext & registration', () => {
    it('registerNav adds items retrievable via getNavItems', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerNav([{ id: 'test', label: 'Test', icon: 'zap', href: '/test', order: 5 }])`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      const items = pluginRegistry.getNavItems()
      expect(items).toHaveLength(1)
      expect(items[0]).toMatchObject({ id: 'test', label: 'Test', order: 5 })
    })

    it('registerRoute makes route findable and calls registerRouteDoc', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerRoute({ path: '/items', method: 'GET', handler: function() { return new Response('ok') } })`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      const route = pluginRegistry.findRoute('alpha', '/items', 'GET')
      expect(route).not.toBeNull()
      expect(route!.path).toBe('/items')
      expect(mockRegisterRouteDoc).toHaveBeenCalled()
    })

    it('registerExecTool sets source and calls addExecTool', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerExecTool({ name: 'bakin_exec_alpha_test', description: 'test', parameters: {}, handler: async () => ({ ok: true }) })`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      expect(mockAddExecTool).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'plugin:alpha', name: 'bakin_exec_alpha_test' }),
      )
    })

    it('registerSkill first-wins — second registration with same name is ignored', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerSkill({ name: 'my-skill', instructions: 'from alpha' })`,
      })
      const pathB = writeFakePlugin('bravo', {
        activate: `ctx.registerSkill({ name: 'my-skill', instructions: 'from bravo' })`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      const skills = getPluginSkills()
      expect(skills.get('my-skill')!.instructions).toBe('from alpha')
    })

    it('hooks.register/has/invoke delegate to shared HookRegistry', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.hooks.register('alpha.greet', function(data) { return 'hello ' + data })`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      const hookReg = getHookRegistry()
      expect(hookReg.has('alpha.greet')).toBe(true)
      const result = await hookReg.invoke('alpha.greet', 'world')
      expect(result).toBe('hello world')
    })

    it('getSettings returns {} when no settings file exists', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `global.__capturedSettings = ctx.getSettings()`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      expect((globalThis as any).__capturedSettings).toEqual({})
    })

    it('getSettings reads from plugin-settings/{id}.json', async () => {
      const settingsDir = join(tempDir, 'plugin-settings')
      mkdirSync(settingsDir, { recursive: true })
      writeFileSync(join(settingsDir, 'alpha.json'), JSON.stringify({ theme: 'dark' }))

      const pathA = writeFakePlugin('alpha', {
        activate: `global.__capturedSettings = ctx.getSettings()`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      expect((globalThis as any).__capturedSettings).toEqual({ theme: 'dark' })
    })

    it('updateSettings merges patch and writes to disk', async () => {
      const settingsDir = join(tempDir, 'plugin-settings')
      mkdirSync(settingsDir, { recursive: true })
      writeFileSync(join(settingsDir, 'alpha.json'), JSON.stringify({ a: 1, b: 2 }))

      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.updateSettings({ b: 99, c: 3 })`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      const onDisk = JSON.parse(readFileSync(join(settingsDir, 'alpha.json'), 'utf-8'))
      expect(onDisk).toEqual({ a: 1, b: 99, c: 3 })
    })

    it('activity.audit calls appendAudit', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.activity.audit('task.created', 'agent-1', { taskId: 'T1' })`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      expect(mockAppendAudit).toHaveBeenCalledWith(
        tempDir,
        'alpha.task.created',
        'agent-1',
        { taskId: 'T1' },
      )
    })
  })

  describe('user plugin failure states', () => {
    it('loads user plugins installed as symlinks', async () => {
      const sourceDir = writeUserPlugin('linked-user', {
        root: join(tempDir, 'dev-sources'),
      })
      const pluginsDir = join(tempDir, 'plugins')
      mkdirSync(pluginsDir, { recursive: true })
      symlinkSync(sourceDir, join(pluginsDir, 'linked-user'), 'dir')

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.getPluginIds()).toContain('linked-user')
      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'linked-user')
      expect(active).toMatchObject({ status: 'active' })
    })

    it('reports missing dependencies without exposing plugin routes', async () => {
      writeUserPlugin('needs-missing', {
        deps: ['not-installed'],
        activate: `ctx.registerRoute({ path: '/data', method: 'GET', handler: function() { return new Response('bad') } })`,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.getPluginIds()).not.toContain('needs-missing')
      expect(pluginRegistry.findRoute('needs-missing', '/data', 'GET')).toBeNull()
      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'needs-missing')
      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'missing_dependency',
        missingDependencies: ['not-installed'],
      })
    })

    it('reports dependency cycles as failed plugins', async () => {
      writeUserPlugin('cycle-a', { deps: ['cycle-b'] })
      writeUserPlugin('cycle-b', { deps: ['cycle-a'] })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const snapshot = pluginRegistry.getRegistrySnapshot()
      expect(snapshot.find((entry: any) => entry.id === 'cycle-a')).toMatchObject({
        status: 'failed',
        errorCode: 'dependency_cycle',
      })
      expect(snapshot.find((entry: any) => entry.id === 'cycle-b')).toMatchObject({
        status: 'failed',
        errorCode: 'dependency_cycle',
      })
    })

    it('reports activation errors as failed plugins', async () => {
      writeUserPlugin('throws', {
        activate: `throw new Error('boom')`,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'throws')
      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'activation_failed',
      })
      expect(failed.errorMessage).toContain('boom')
    })

    it('fails user plugins that register undeclared API routes', async () => {
      writeUserPlugin('undeclared-route', {
        activate: `ctx.registerRoute({ path: '/data', method: 'GET', handler: function() { return new Response('bad') } })`,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'undeclared-route')
      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'activation_failed',
      })
      expect(failed.errorMessage).toContain('undeclared API route')
      expect(pluginRegistry.findRoute('undeclared-route', '/data', 'GET')).toBeNull()
    })

    it('allows user plugins to register declared API routes and exec tools', async () => {
      writeUserPlugin('declared-surfaces', {
        manifest: {
          contributes: {
            apiRoutes: [
              { method: 'GET', path: '/data', summary: 'Read data' },
            ],
            execTools: [
              { name: 'declared.tool', summary: 'Declared tool' },
            ],
          },
        },
        activate: `
          ctx.registerRoute({ path: '/data', method: 'GET', handler: function() { return new Response('ok') } })
          ctx.registerExecTool({ name: 'declared.tool', description: 'test', parameters: {}, handler: async () => ({ ok: true }) })
        `,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.findRoute('declared-surfaces', '/data', 'GET')).not.toBeNull()
      expect(mockAddExecTool).toHaveBeenCalledWith(expect.objectContaining({
        source: 'plugin:declared-surfaces',
        name: 'declared.tool',
      }))
      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'declared-surfaces')
      expect(active).toMatchObject({ status: 'active' })
    })
  })

  // -------------------------------------------------------------------------
  // B3: Lookups
  // -------------------------------------------------------------------------

  describe('lookups', () => {
    async function initWithTwoPlugins() {
      const pathA = writeFakePlugin('alpha', {
        navItems: `[{ id: 'a', label: 'Alpha', icon: 'star', href: '/a', order: 20 }]`,
        activate: `
          ctx.registerRoute({ path: '/data', method: 'GET', handler: function() { return new Response('ok') } })
          ctx.registerSlot({ slot: 'dashboard', component: function() {}, order: 10 })
        `,
      })
      const pathB = writeFakePlugin('bravo', {
        navItems: `[{ id: 'b', label: 'Bravo', icon: 'zap', href: '/b', order: 5 }]`,
        activate: `
          ctx.registerRoute({ path: '/items', method: 'POST', handler: function() { return new Response('ok') } })
          ctx.registerSlot({ slot: 'dashboard', component: function() {}, order: 1 })
          ctx.registerSlot({ slot: 'sidebar', component: function() {}, order: 1 })
        `,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )
    }

    it('getNavItems aggregates from multiple plugins and sorts by order', async () => {
      await initWithTwoPlugins()
      const items = pluginRegistry.getNavItems()
      expect(items).toHaveLength(2)
      expect(items[0].id).toBe('b') // order 5
      expect(items[1].id).toBe('a') // order 20
    })

    it('findRoute matches pluginId + path + method', async () => {
      await initWithTwoPlugins()
      const route = pluginRegistry.findRoute('bravo', '/items', 'POST')
      expect(route).not.toBeNull()
      expect(route!.method).toBe('POST')
    })

    it('findRoute returns null for unknown plugin', async () => {
      await initWithTwoPlugins()
      expect(pluginRegistry.findRoute('nonexistent', '/data', 'GET')).toBeNull()
    })

    it('findRoute returns null for wrong method', async () => {
      await initWithTwoPlugins()
      expect(pluginRegistry.findRoute('alpha', '/data', 'DELETE')).toBeNull()
    })

    it('getSlotComponents filters by slot name and sorts by order', async () => {
      await initWithTwoPlugins()
      const slots = pluginRegistry.getSlotComponents('dashboard')
      expect(slots).toHaveLength(2)
      expect(slots[0].order).toBe(1)  // bravo
      expect(slots[1].order).toBe(10) // alpha
    })

    it('getPluginIds returns all loaded plugin IDs', async () => {
      await initWithTwoPlugins()
      const ids = pluginRegistry.getPluginIds()
      expect(ids).toContain('alpha')
      expect(ids).toContain('bravo')
      expect(ids).toHaveLength(2)
    })

    it('getRegistrySnapshot returns correct shape', async () => {
      await initWithTwoPlugins()
      const snapshot = pluginRegistry.getRegistrySnapshot()
      expect(snapshot).toHaveLength(2)
      const alpha = snapshot.find((s: any) => s.id === 'alpha')!
      expect(alpha).toMatchObject({
        id: 'alpha',
        name: 'Alpha',
        version: '1.0.0',
        source: 'built-in',
        routes: 1,
      })
    })
  })

  // -------------------------------------------------------------------------
  // B4: Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('onAllReady calls onReady on all plugins', async () => {
      const pathA = writeFakePlugin('alpha', {
        onReady: `function() { global.__readyOrder = global.__readyOrder || []; global.__readyOrder.push('alpha') }`,
      })
      const pathB = writeFakePlugin('bravo', {
        onReady: `function() { global.__readyOrder = global.__readyOrder || []; global.__readyOrder.push('bravo') }`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      await pluginRegistry.onAllReady()
      expect((globalThis as any).__readyOrder).toEqual(['alpha', 'bravo'])
    })

    it('onAllReady catches errors without propagating', async () => {
      const pathA = writeFakePlugin('alpha', {
        onReady: `function() { throw new Error('boom') }`,
      })
      const pathB = writeFakePlugin('bravo', {
        onReady: `function() { global.__bravoReady = true }`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      await pluginRegistry.onAllReady()
      expect((globalThis as any).__bravoReady).toBe(true)
    })

    it('shutdownAll calls onShutdown in reverse activation order', async () => {
      const pathA = writeFakePlugin('alpha', {
        onShutdown: `function() { global.__shutdownOrder = global.__shutdownOrder || []; global.__shutdownOrder.push('alpha') }`,
      })
      const pathB = writeFakePlugin('bravo', {
        onShutdown: `function() { global.__shutdownOrder = global.__shutdownOrder || []; global.__shutdownOrder.push('bravo') }`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      await pluginRegistry.shutdownAll()
      expect((globalThis as any).__shutdownOrder).toEqual(['bravo', 'alpha'])
    })

    it('shutdownAll catches errors without propagating', async () => {
      const pathA = writeFakePlugin('alpha', {
        onShutdown: `function() { global.__alphaShutdown = true }`,
      })
      const pathB = writeFakePlugin('bravo', {
        onShutdown: `function() { throw new Error('shutdown boom') }`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      await pluginRegistry.shutdownAll()
      expect((globalThis as any).__alphaShutdown).toBe(true)
    })

    it('notifySettingsChange calls plugin onSettingsChange callback', async () => {
      const pathA = writeFakePlugin('alpha', {
        onSettingsChange: `function(s) { global.__settingsChanged = s }`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      await pluginRegistry.notifySettingsChange('alpha', { theme: 'dark' })
      expect((globalThis as any).__settingsChanged).toEqual({ theme: 'dark' })
    })

    it('notifySettingsChange is a no-op for unknown plugin', async () => {
      // Should not throw even with no plugins loaded
      await pluginRegistry.notifySettingsChange('nonexistent', { foo: 'bar' })
    })

    it('getSettingsSchemas returns only plugins with schemas', async () => {
      const pathA = writeFakePlugin('alpha', {
        settingsSchema: `{ fields: [{ key: 'theme', type: 'string', label: 'Theme' }] }`,
      })
      const pathB = writeFakePlugin('bravo') // no schema

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      const schemas = pluginRegistry.getSettingsSchemas()
      expect(schemas).toHaveLength(1)
      expect(schemas[0]).toMatchObject({ id: 'alpha', name: 'Alpha' })
      expect(schemas[0].schema.fields).toHaveLength(1)
    })
  })
})
