import { describe, it, expect, beforeEach, afterEach, mock, spyOn, type Mock } from 'bun:test'
import { AsyncResource } from 'async_hooks'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockSearchAdapter } from '@bakin/core/adapters/search/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

// ---------------------------------------------------------------------------
// PluginRegistryImpl
// (the HookRegistry unit tests split to hook-registry.test.ts in FW7)
//
// The registry uses dynamic import() inside loadPlugin, which makes it hard
// to test via initialize(). Instead, we test the public API by:
// 1. Mocking external deps so the module can be imported
// 2. Using vi.resetModules() to get fresh singletons per test
// 3. Calling initialize() with real temp-dir plugins (CommonJS .js files)
// ---------------------------------------------------------------------------

// These vi.mock calls are hoisted — they use paths relative to THIS file,
// matching how vitest resolves them (same as the source's imports via aliases).
const loggerInfo = mock()
const loggerWarn = mock()
const loggerError = mock()
const loggerDebug = mock()
mock.module('@/core/logger', () => ({
  createLogger: () => ({
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: loggerDebug,
  }),
}))

mock.module('@/core/api-docs', () => ({
  registerRouteDoc: mock(),
  removeRouteDocsByPlugin: mock(),
}))

mock.module('@/core/audit', () => ({
  appendAudit: mock(),
}))

// One shared getContentDir mock so the @/ facade AND the packages/core
// resolver (used by the settings-store) return the same dir.
const sharedGetContentDir = mock()
mock.module('@/core/content-dir', () => ({
  getContentDir: sharedGetContentDir,
  getBakinPaths: mock(() => ({})),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
const coreContentDirMock = () => ({
  getContentDir: sharedGetContentDir,
  getBakinPaths: mock(() => ({})),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})
mock.module('../../packages/core/src/content-dir', coreContentDirMock)
mock.module('@bakin/core/content-dir', coreContentDirMock)

mock.module('@/core/migrations', () => ({
  runMigrations: mock().mockResolvedValue(0),
}))

const mockedExecTools = new Map<string, any>()
const mockedAddExecTool = mock((tool: any) => {
  if (mockedExecTools.has(tool.name)) {
    throw new Error(`Exec tool "${tool.name}" is already registered`)
  }
  mockedExecTools.set(tool.name, tool)
})
const mockedRemoveExecToolsByPlugin = mock((pluginId: string) => {
  const prefix = `bakin_exec_${pluginId}_`
  const source = `plugin:${pluginId}`
  let removed = 0
  for (const [name, tool] of [...mockedExecTools.entries()]) {
    if (name.startsWith(prefix) || tool.source === source) {
      mockedExecTools.delete(name)
      removed++
    }
  }
  return removed
})

mock.module('@/core/exec-tools/registry', () => ({
  addExecTool: mockedAddExecTool,
  getExecTool: (name: string) => mockedExecTools.get(name),
  getAllExecTools: () => [...mockedExecTools.values()],
  removeExecToolsByPlugin: mockedRemoveExecToolsByPlugin,
}))

describe('PluginRegistryImpl', () => {
  let tempDir: string
  let pluginRegistry: any
  let getHookRegistry: any
  let getPluginSkills: any
  let registerCorePlugins: any
  let mockGetContentDir: any
  let mockAppendAudit: any
  let mockAddExecTool: any
  let mockRegisterRouteDoc: any
  let previousBakinHome: string | undefined
  let previousStartupDiagnostics: string | undefined

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-reg-'))
    // Point user plugins to a non-existent dir (no user plugins by default)
    previousBakinHome = process.env.BAKIN_HOME
    previousStartupDiagnostics = process.env.BAKIN_STARTUP_DIAGNOSTICS
    process.env.BAKIN_HOME = join(tempDir, 'bakin-home')
    // Clear globalThis singletons for fresh instances
    delete (globalThis as any).__bakinPluginRegistry
    delete (globalThis as any).__bakinHookRegistry
    mockedExecTools.clear()
    loggerInfo.mockClear()
    loggerWarn.mockClear()
    loggerError.mockClear()
    loggerDebug.mockClear()
    const runtime = createMockRuntimeAdapter()
    const search = createMockSearchAdapter()
    ;(globalThis as any).__bakinAppServices = {
      runtime,
      search,
      tasks: createMockBakinTaskStore(),
    }

    // Reset modules to get a fresh registry singleton
    vi.resetModules()

    // Dynamic import to get fresh module with fresh singleton
    const contentDir = await import('@/core/content-dir')
    mockGetContentDir = vi.mocked(contentDir.getContentDir)
    mockGetContentDir.mockReturnValue(tempDir)

    const audit = await import('@/core/audit')
    mockAppendAudit = vi.mocked(audit.appendAudit)

    const scriptReg = await import('@/core/exec-tools/registry')
    mockAddExecTool = vi.mocked(scriptReg.addExecTool)

    const apiDocs = await import('@/core/api-docs')
    mockRegisterRouteDoc = vi.mocked(apiDocs.registerRouteDoc)

    const mod = await import('@/core/plugin-registry')
    pluginRegistry = mod.pluginRegistry
    getHookRegistry = (await import('@bakin/core/hooks/hook-registry-singleton')).getHookRegistry
    getPluginSkills = mod.getPluginSkills
    registerCorePlugins = mod.registerCorePlugins
    // bun:test has no vi.resetModules; reset the singleton via its own API
    pluginRegistry._resetForTests()
    // Also clear the hook registry — it's a separate globalThis singleton
    const hookReg = getHookRegistry?.()
    hookReg?.clearAll?.()
  })

  afterEach(() => {
    if (previousBakinHome === undefined) {
      delete process.env.BAKIN_HOME
    } else {
      process.env.BAKIN_HOME = previousBakinHome
    }
    if (previousStartupDiagnostics === undefined) {
      delete process.env.BAKIN_STARTUP_DIAGNOSTICS
    } else {
      process.env.BAKIN_STARTUP_DIAGNOSTICS = previousStartupDiagnostics
    }
    mockGetContentDir?.mockImplementation(() => process.env.BAKIN_HOME || '/tmp/test')
    registerCorePlugins?.({})
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
      routes?: string
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
      bakin: '*',
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
        routes: ${opts.routes || 'undefined'},
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
      onReady?: string
      settingsSchema?: string
      manifest?: Record<string, unknown>
      root?: string
      /** JS source for a declarative `routes` array on the plugin object. */
      routes?: string
    } = {},
  ): string {
    const pluginDir = join(opts.root ?? join(tempDir, 'plugins'), id)
    mkdirSync(pluginDir, { recursive: true })
    const manifest = {
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      version: '1.0.0',
      bakin: '*',
      description: `User plugin ${id}`,
            dependencies: opts.deps ?? [],
      permissions: [],
      ...opts.manifest,
    }
    writeFileSync(join(pluginDir, 'bakin-plugin.json'), JSON.stringify(manifest))
    const distDir = join(pluginDir, 'dist')
    mkdirSync(distDir, { recursive: true })
    writeFileSync(
      join(distDir, 'index.js'),
      `const plugin = {
        id: '${id}',
        name: '${id.charAt(0).toUpperCase() + id.slice(1)}',
        version: '1.0.0',
        settingsSchema: ${opts.settingsSchema || 'undefined'},
        routes: ${opts.routes || 'undefined'},
        activate: function(ctx) { ${opts.activate || ''} },
        onReady: ${opts.onReady || 'undefined'},
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

    it('declarative routes are findable and registered with registerRouteDoc', async () => {
      const pathA = writeFakePlugin('alpha', {
        routes: `[{ path: '/items', method: 'GET', handler: function() { return new Response('ok') } }]`,
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

    it('a declarative route with an unknown body contentType fails activation loudly', async () => {
      const pathA = writeFakePlugin('alpha', {
        routes: `[{ path: '/items', method: 'POST', body: { contentType: 'json' }, handler: function() { return new Response('ok') } }]`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }] },
        mockStorage(),
        mockEvents(),
      )

      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'alpha')
      expect(failed?.status).toBe('failed')
      expect(failed?.errorMessage).toContain("unknown body contentType 'json'")
      expect(failed?.errorMessage).toContain('POST /items')
      expect(pluginRegistry.findRoute('alpha', '/items', 'POST')).toBeNull()
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

    it('registerSkill duplicate name THROWS naming the collision + owning plugin (R18)', async () => {
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

      // First registration wins; the duplicate FAILS bravo's activation.
      const skills = getPluginSkills()
      expect(skills.get('my-skill')!.instructions).toBe('from alpha')
      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'bravo')
      expect(failed?.status).toBe('failed')
      expect(failed?.errorMessage).toContain('my-skill')
      expect(failed?.errorMessage).toContain('plugin:alpha')
    })

    it('a failed activation sweeps EVERYTHING the plugin registered before the throw', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerSkill({ name: 'sweep-skill', instructions: 'from alpha' })`,
      })
      // bravo registers an exec tool + a hook + a workflow BEFORE colliding
      // on the skill name — none of those may survive its failed activation.
      const pathB = writeFakePlugin('bravo', {
        activate: `
          ctx.registerExecTool({ name: 'bakin_exec_bravo_thing', description: 'x', parameters: {}, handler: async () => ({ ok: true }) })
          ctx.hooks.register('bravo.leaky', function () { return 1 })
          ctx.registerWorkflow({ id: 'bravo-flow', name: 'Bravo Flow', steps: [] })
          ctx.registerSkill({ name: 'sweep-skill', instructions: 'from bravo' })
        `,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'bravo')
      expect(failed?.status).toBe('failed')
      // Exec tool swept (the mocked registry removes by source tag).
      expect(mockedExecTools.has('bakin_exec_bravo_thing')).toBe(false)
      // Hook swept.
      expect(getHookRegistry().has('bravo.leaky')).toBe(false)
      // Workflow id reclaimable: registering it from another plugin must not throw.
      const { registerPluginDefinition } = await import('@bakin/core/workflows/source-registry')
      expect(() => registerPluginDefinition('charlie', 'bravo-flow', { id: 'bravo-flow', name: 'Claimed', steps: [] } as any)).not.toThrow()
    })

    it('deactivatePlugin frees the plugin\'s workflow ids for later claimants', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerWorkflow({ id: 'shared-flow', name: 'Alpha Flow', steps: [] })`,
      })
      await pluginRegistry.initialize({ plugins: [{ path: pathA }] }, mockStorage(), mockEvents())

      const { registerPluginDefinition, getSource } = await import('@bakin/core/workflows/source-registry')
      expect(getSource('shared-flow')).toBe('plugin')
      // Cross-plugin claim while alpha is live still throws (R18).
      expect(() => registerPluginDefinition('bravo', 'shared-flow', { id: 'shared-flow', name: 'Stolen', steps: [] } as any)).toThrow()

      await pluginRegistry.deactivatePlugin('alpha', { callShutdown: false })
      // Stale id must not be activation-fatal for the next claimant.
      expect(() => registerPluginDefinition('bravo', 'shared-flow', { id: 'shared-flow', name: 'Claimed', steps: [] } as any)).not.toThrow()
    })

    it('registerWorkflow cross-plugin id collision THROWS and fails activation (R18)', async () => {
      // Same-plugin re-registration is an UPDATE by contract (hot-reload of
      // defaults re-registers); only a cross-plugin id collision throws.
      const pathA = writeFakePlugin('alpha', {
        activate: `ctx.registerWorkflow({ id: 'dup-flow', name: 'Dup Flow', steps: [] })`,
      })
      const pathB = writeFakePlugin('bravo', {
        activate: `ctx.registerWorkflow({ id: 'dup-flow', name: 'Stolen Flow', steps: [] })`,
      })
      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )
      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'bravo')
      expect(failed?.status).toBe('failed')
      expect(failed?.errorMessage).toContain('dup-flow')
      expect(failed?.errorMessage).toContain('alpha')
    })

    it('registerNodeType duplicate kind THROWS and fails activation (R18)', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `
          ctx.registerNodeType({ kind: 'dup-node', label: 'Dup', execute() {} })
          ctx.registerNodeType({ kind: 'dup-node', label: 'Dup 2', execute() {} })
        `,
      })
      await pluginRegistry.initialize({ plugins: [{ path: pathA }] }, mockStorage(), mockEvents())
      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'alpha')
      expect(failed?.status).toBe('failed')
      expect(failed?.errorMessage).toContain('dup-node')
    })

    it('registerNotificationChannel duplicate id THROWS and fails activation (R18)', async () => {
      const pathA = writeFakePlugin('alpha', {
        activate: `
          ctx.registerNotificationChannel({ id: 'dup-chan', label: 'Dup', send() {} })
          ctx.registerNotificationChannel({ id: 'dup-chan', label: 'Dup 2', send() {} })
        `,
      })
      await pluginRegistry.initialize({ plugins: [{ path: pathA }] }, mockStorage(), mockEvents())
      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'alpha')
      expect(failed?.status).toBe('failed')
      expect(failed?.errorMessage).toContain('dup-chan')
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
    it('captures user plugin console output into plugin-scoped logs', async () => {
      writeUserPlugin('projects', {
        activate: `
          console.log('[projects] Project index rebuilt', { entries: 0 })
          console.warn('[projects] Index warning', { code: 'stale' })
          ctx.log.info('ctx logger activated', { count: 2 })
        `,
        onReady: `function() { console.log('[projects] Ready projects', { draft: 1 }) }`,
      })
      const consoleLog = spyOn(console, 'log').mockImplementation(() => {})
      const consoleWarn = spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())
        await pluginRegistry.onAllReady()
      } finally {
        consoleLog.mockRestore()
        consoleWarn.mockRestore()
      }

      expect(consoleLog).not.toHaveBeenCalled()
      expect(consoleWarn).not.toHaveBeenCalled()

      const infoCalls = loggerInfo.mock.calls as unknown as Array<[string, Record<string, unknown>?]>
      const warnCalls = loggerWarn.mock.calls as unknown as Array<[string, Record<string, unknown>?]>
      expect(infoCalls).toContainEqual([
        'Project index rebuilt { entries: 0 }',
        { source: 'plugin', pluginId: 'projects', console: true },
      ])
      expect(infoCalls).toContainEqual([
        'Ready projects { draft: 1 }',
        { source: 'plugin', pluginId: 'projects', console: true },
      ])
      expect(infoCalls).toContainEqual([
        'ctx logger activated',
        { count: 2, source: 'plugin', pluginId: 'projects' },
      ])
      expect(warnCalls).toContainEqual([
        'Index warning { code: \'stale\' }',
        { source: 'plugin', pluginId: 'projects', console: true },
      ])
    })

    it('does not capture unrelated console output during async user plugin activation', async () => {
      let markStarted!: () => void
      const started = new Promise<void>((resolve) => { markStarted = resolve })
      ;(globalThis as any).__asyncUserMarkStarted = markStarted

      writeUserPlugin('async-user', {
        activate: `
          console.log('[async-user] activation started')
          global.__asyncUserMarkStarted()
          return new Promise(resolve => { global.__asyncUserRelease = resolve })
        `,
      })

      const outsideMessage = 'outside lifecycle'
      const outsideResource = new AsyncResource('outside-console')
      const consoleLog = spyOn(console, 'log').mockImplementation(() => {})

      try {
        const initializePromise = pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())
        await started
        outsideResource.runInAsyncScope(() => console.log(outsideMessage))
        const release = (globalThis as any).__asyncUserRelease
        expect(typeof release).toBe('function')
        release()
        await initializePromise
        expect(consoleLog).toHaveBeenCalledWith(outsideMessage)
      } finally {
        outsideResource.emitDestroy()
        consoleLog.mockRestore()
      }

      const infoCalls = loggerInfo.mock.calls as unknown as Array<[string, Record<string, unknown>?]>
      expect(infoCalls).toContainEqual([
        'activation started',
        { source: 'plugin', pluginId: 'async-user', console: true },
      ])
      expect(infoCalls.some(([message]) => message === outsideMessage)).toBe(false)
    })

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

    it('loads user plugins from dist even when the source entry is not runnable', async () => {
      const pluginDir = writeUserPlugin('dist-only-user', {
        manifest: { },
        activate: `ctx.log.info('loaded dist entry')`,
      })
      writeFileSync(
        join(pluginDir, 'index.ts'),
        `throw new Error('source entry should not be imported')`,
      )

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.getPluginIds()).toContain('dist-only-user')
      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'dist-only-user')
      expect(active).toMatchObject({ status: 'active' })
    })

    it('uses the installed lockfile version for active user plugin snapshots', async () => {
      const pluginDir = writeUserPlugin('versioned-user')
      const contentDir = await import('../../packages/core/src/content-dir')
      contentDir.resetContentDir()
      const { getPluginLockfilePath } = await import('../../packages/core/src/plugins/lockfile')
      const lockPath = getPluginLockfilePath()
      mkdirSync(dirname(lockPath), { recursive: true })
      writeFileSync(lockPath, JSON.stringify({
        version: 1,
        plugins: {
          'versioned-user': {
            source: pluginDir,
            type: 'local',
            ref: '',
            commitSha: '',
            installedAt: '2026-05-25T02:57:29.278Z',
            version: '2.5.0',
            permissions: [],
            manifestSha: 'sha256:test',
          },
        },
      }))

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'versioned-user')
      expect(active).toMatchObject({
        status: 'active',
        source: 'user',
        version: '2.5.0',
      })
    })

    it('reports a clear failure when a user plugin is not built', async () => {
      const pluginDir = writeUserPlugin('unbuilt-user')
      rmSync(join(pluginDir, 'dist'), { recursive: true, force: true })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.getPluginIds()).not.toContain('unbuilt-user')
      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'unbuilt-user')
      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'activation_failed',
      })
      expect(failed?.errorMessage).toContain('Expected')
      expect(failed?.errorMessage).toContain('dist/index.js')
    })

    it('reports missing dependencies without exposing plugin routes', async () => {
      writeUserPlugin('needs-missing', {
        deps: ['not-installed'],
        routes: `[{ path: '/data', method: 'GET', handler: function() { return new Response('bad') } }]`,
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

    it('wraps plugin contexts with runtime permission warnings', async () => {
      const path = writeFakePlugin('needs-storage', {
        activate: `ctx.storage.write('state.txt', 'no permission')`,
      })

      await pluginRegistry.initialize({ plugins: [{ path }] }, mockStorage(), mockEvents())

      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'needs-storage')
      expect(active).toMatchObject({ status: 'active' })
      expect(mockAppendAudit).toHaveBeenCalledWith(
        expect.any(String),
        'plugin.permission_missing',
        'system',
        expect.objectContaining({
          pluginId: 'needs-storage',
          method: 'ctx.storage.write',
          requiredPermission: 'storage.write',
          mode: 'warn',
        }),
        'system',
      )
    })

    it('uses embedded static manifests for core plugin permissions when source manifests are absent', async () => {
      registerCorePlugins({
        'embedded/core-storage': {
          plugin: {
            id: 'core-storage',
            name: 'Core Storage',
            version: '1.0.0',
            activate(ctx: any) {
              ctx.storage.read('state.txt')
            },
          },
          manifest: {
            id: 'core-storage',
            name: 'Core Storage',
            version: '1.0.0',
            bakin: '*',
            description: 'Core plugin loaded from an embedded registration',
                        permissions: ['storage.read'],
          },
        },
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: 'embedded/core-storage' }] },
        mockStorage(),
        mockEvents(),
      )

      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'core-storage')
      expect(active).toMatchObject({ status: 'active', source: 'built-in' })

      const permissionMissing = mockAppendAudit.mock.calls.find((call: any[]) =>
        call[1] === 'plugin.permission_missing' &&
        call[3]?.pluginId === 'core-storage'
      )
      expect(permissionMissing).toBeUndefined()

      const activation = mockAppendAudit.mock.calls.find((call: any[]) =>
        call[1] === 'plugin.activate' &&
        call[3]?.pluginId === 'core-storage'
      )
      expect(activation?.[3]?.permissions).toEqual(['storage.read'])
    })

    it('emits startup timing diagnostics for plugin activation and onReady', async () => {
      process.env.BAKIN_STARTUP_DIAGNOSTICS = '1'
      const path = writeFakePlugin('timed-core', {
        onReady: `function() { global.__timedReady = true }`,
      })

      await pluginRegistry.initialize({ plugins: [{ path }] }, mockStorage(), mockEvents())
      await pluginRegistry.onAllReady()

      const debugCalls = loggerDebug.mock.calls as unknown as Array<[string, Record<string, unknown>?]>
      expect(debugCalls).toContainEqual([
        'startup span',
        expect.objectContaining({
          category: 'startup',
          phase: 'plugin',
          span: 'plugin.activate',
          status: 'ok',
          pluginId: 'timed-core',
          pluginSource: 'core',
        }),
      ])
      expect(debugCalls).toContainEqual([
        'startup span',
        expect.objectContaining({
          category: 'startup',
          phase: 'plugin',
          span: 'plugin.onReady',
          status: 'ok',
          pluginId: 'timed-core',
          pluginSource: 'core',
        }),
      ])
      expect(debugCalls).toContainEqual([
        'startup span',
        expect.objectContaining({
          category: 'startup',
          phase: 'plugins',
          span: 'pluginRegistry.initialize',
          status: 'ok',
          count: 1,
        }),
      ])
    })

    it('fails user plugins that register undeclared API routes', async () => {
      writeUserPlugin('undeclared-route', {
        routes: `[{ path: '/data', method: 'GET', handler: function() { return new Response('bad') } }]`,
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

    it('fails user plugins with undeclared DECLARATIVE routes (T16 symmetric enforcement)', async () => {
      writeUserPlugin('undeclared-declarative', {
        routes: `[{ path: '/data', method: 'GET', handler: function() { return new Response('bad') } }]`,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'undeclared-declarative')
      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'activation_failed',
      })
      expect(failed.errorMessage).toContain('undeclared API route')
      expect(failed.errorMessage).toContain('contributes.apiRoutes')
      expect(pluginRegistry.findRoute('undeclared-declarative', '/data', 'GET')).toBeNull()
    })

    it('accepts lowercase code-side methods against uppercased manifest declarations', async () => {
      // Plain-JS authors register method:'get'; the manifest parser uppercases.
      // The enforcer compares case-insensitively so sync-manifest and
      // activation agree (PR #635 review fix).
      writeUserPlugin('lowercase-method', {
        manifest: {
          contributes: {
            apiRoutes: [{ method: 'GET', path: '/data', summary: 'Read data' }],
          },
        },
        routes: `[{ path: '/data', method: 'get', handler: function() { return new Response('ok') } }]`,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'lowercase-method')
      expect(active).toMatchObject({ status: 'active' })
    })

    it('allows user plugins with declared declarative routes', async () => {
      writeUserPlugin('declared-declarative', {
        manifest: {
          contributes: {
            apiRoutes: [{ method: 'GET', path: '/data', summary: 'Read data' }],
          },
        },
        routes: `[{ path: '/data', method: 'GET', handler: function() { return new Response('ok') } }]`,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.findRoute('declared-declarative', '/data', 'GET')).not.toBeNull()
      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'declared-declarative')
      expect(active).toMatchObject({ status: 'active' })
    })

    it('allows user plugins to register declared API routes and exec tools', async () => {
      writeUserPlugin('declared-surfaces', {
        manifest: {
          contributes: {
            apiRoutes: [
              { method: 'GET', path: '/data', summary: 'Read data' },
            ],
            execTools: [
              { name: 'bakin_exec_declared-surfaces_data', summary: 'Declared tool' },
            ],
          },
        },
        routes: `[{ path: '/data', method: 'GET', handler: function() { return new Response('ok') } }]`,
        activate: `
          ctx.registerExecTool({ name: 'bakin_exec_declared-surfaces_data', description: 'test', parameters: {}, handler: async () => ({ ok: true }) })
        `,
      })

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      expect(pluginRegistry.findRoute('declared-surfaces', '/data', 'GET')).not.toBeNull()
      expect(mockAddExecTool).toHaveBeenCalledWith(expect.objectContaining({
        source: 'plugin:declared-surfaces',
        name: 'bakin_exec_declared-surfaces_data',
      }))
      const active = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'declared-surfaces')
      expect(active).toMatchObject({ status: 'active' })
    })

    it('fails user plugins that declare exec tools outside their namespace', async () => {
      writeUserPlugin('tool-owner', {
        manifest: {
          contributes: {
            execTools: [
              { name: 'bakin_exec_tasks_create', summary: 'Looks like a core tool' },
            ],
          },
        },
        activate: `
          ctx.registerExecTool({ name: 'bakin_exec_tasks_create', description: 'bad', parameters: {}, handler: async () => ({ ok: true }) })
        `,
      })
      mockAddExecTool.mockClear()

      await pluginRegistry.initialize({ plugins: [] }, mockStorage(), mockEvents())

      const failed = pluginRegistry.getRegistrySnapshot().find((entry: any) => entry.id === 'tool-owner')
      expect(failed).toMatchObject({
        status: 'failed',
        errorCode: 'activation_failed',
      })
      expect(failed.errorMessage).toContain('must start with "bakin_exec_tool-owner_"')
      expect(mockAddExecTool).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // B3: Lookups
  // -------------------------------------------------------------------------

  describe('lookups', () => {
    async function initWithTwoPlugins() {
      const pathA = writeFakePlugin('alpha', {
        navItems: `[{ id: 'a', label: 'Alpha', icon: 'star', href: '/a', order: 20 }]`,
        routes: `[{ path: '/data', method: 'GET', handler: function() { return new Response('ok') } }]`,
        activate: `
          ctx.registerSlot({ slot: 'dashboard', component: function() {}, order: 10 })
        `,
      })
      const pathB = writeFakePlugin('bravo', {
        navItems: `[{ id: 'b', label: 'Bravo', icon: 'zap', href: '/b', order: 5 }]`,
        routes: `[{ path: '/items', method: 'POST', handler: function() { return new Response('ok') } }]`,
        activate: `
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

    it('getSettingsSchemas returns only plugins with schemas, tagged by source', async () => {
      const pathA = writeFakePlugin('alpha', {
        settingsSchema: `{ fields: [{ key: 'theme', type: 'string', label: 'Theme' }] }`,
      })
      const pathB = writeFakePlugin('bravo') // no schema — should be filtered out
      writeUserPlugin('charlie', {
        settingsSchema: `{ fields: [{ key: 'color', type: 'string', label: 'Color' }] }`,
      })

      await pluginRegistry.initialize(
        { plugins: [{ path: pathA }, { path: pathB }] },
        mockStorage(),
        mockEvents(),
      )

      const schemas = pluginRegistry.getSettingsSchemas()
      expect(schemas).toHaveLength(2)
      const alpha = schemas.find((s: { id: string }) => s.id === 'alpha')
      const charlie = schemas.find((s: { id: string }) => s.id === 'charlie')
      expect(alpha).toMatchObject({ id: 'alpha', name: 'Alpha', source: 'built-in' })
      expect(alpha.schema.fields).toHaveLength(1)
      expect(charlie).toMatchObject({ id: 'charlie', name: 'Charlie', source: 'user' })
    })
  })
})
