/**
 * Golden-path gate: scaffold → install (copy + REAL buildUserPlugin) →
 * registry activation → route responds → exec tool callable.
 *
 * This is the drift alarm between `bakin plugins scaffold` and the
 * in-binary builder/loader: it asserts on actual activation and request
 * dispatch, not file existence. If the scaffold's layout, manifest
 * contributes, tool naming, or the builder's entry expectations ever
 * disagree again (the pre-T12 `src/` vs root break), this test fails.
 *
 * Install path mirrors packages/host/src/api/plugins/install/commit.ts:
 * cpSync(source → <bakin-home>/plugins/<id>) then buildUserPlugin(target),
 * then pluginRegistry.initialize() imports dist/index.js like a server boot.
 *
 * NETWORK-FREE test plumbing: the scaffold declares real registry deps
 * (`zod`, SDK "latest" on dev builds). Before building we rewrite the
 * scaffolded package.json to point `zod` at this repo's own node_modules
 * via `file:` and drop devDependencies (they exist for standalone
 * typechecking, which tests/core/plugin-scaffold.test.ts covers). The
 * server bundle inlines @makinbakin/sdk from repo source (whiskit
 * resolveSdkEntrypoints), so no npm access is ever needed.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, cpSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-golden-path-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const REPO_ROOT = resolve(import.meta.dir, '../..')
const PLUGIN_ID = 'gp-demo'
const BAD_RANGE_ID = 'gp-badrange'

const bakinPaths = () => ({
  root: testDir,
  db: join(testDir, 'bakin.db'),
  plugins: join(testDir, 'plugins'),
  pluginData: join(testDir, 'plugin-data'),
  pluginSettings: join(testDir, 'plugin-settings'),
})

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
const coreContentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: bakinPaths,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
})
mock.module('../../packages/core/src/content-dir', coreContentDirMock)
mock.module('@bakin/core/content-dir', coreContentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))
mock.module('../../src/core/api-docs', () => ({
  registerRouteDoc: mock(),
  removeRouteDocsByPlugin: () => 0,
}))
mock.module('../../src/core/migrations', () => ({
  runMigrations: mock().mockResolvedValue(0),
}))
mock.module('../../src/core/watcher', () => ({
  registerSyncHook: mock(() => () => {}),
  registerUnlinkHook: mock(() => () => {}),
  shouldIgnoreContentWatcherPath: () => false,
  start: mock(),
  stop: mock(),
}))

describe('plugin golden path (scaffold → install → activate → use)', () => {
  let pluginRegistry: any
  let getExecTool: any
  let getToolContext: any
  let handlePluginRoute: (req: Request, url: URL) => Promise<Response>

  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true })

    const { createMockRuntimeAdapter } = await import('@bakin/core/adapters/runtime/testing')
    const { createMockSearchAdapter } = await import('@bakin/core/adapters/search/testing')
    const { createMockBakinTaskStore } = await import('@bakin/core/tasks/testing')
    const runtime = createMockRuntimeAdapter()
    const search = createMockSearchAdapter()
    ;(globalThis as any).__bakinAppServices = {
      runtime,
      search,
      tasks: createMockBakinTaskStore(),
    }

    // --- scaffold (the real function, into a scratch cwd) ---
    const scratch = join(testDir, 'scratch')
    mkdirSync(scratch, { recursive: true })
    const { createPluginScaffold } = await import('../../src/core/plugin-scaffold')
    const prevCwd = process.cwd()
    process.chdir(scratch)
    let scaffolded
    try {
      scaffolded = createPluginScaffold(PLUGIN_ID)
    } finally {
      process.chdir(prevCwd)
    }
    if (!scaffolded.ok) throw new Error(`scaffold failed: ${scaffolded.error}`)

    // --- install: copy into <home>/plugins/<id> exactly like commit.ts ---
    const targetDir = join(testDir, 'plugins', PLUGIN_ID)
    mkdirSync(join(testDir, 'plugins'), { recursive: true })
    cpSync(scaffolded.root!, targetDir, { recursive: true, dereference: false })

    // Network-free plumbing (see module doc): zod via file: to the repo's
    // copy; devDependencies dropped (standalone-typecheck-only).
    const pkgPath = join(targetDir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    expect(Object.keys(pkg.dependencies ?? {})).toContain('zod') // scaffold contract
    pkg.dependencies = { zod: `file:${join(REPO_ROOT, 'node_modules', 'zod')}` }
    delete pkg.devDependencies
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))

    // --- REAL builder: this is the half of the drift gate that broke pre-T12 ---
    const { buildUserPlugin } = await import('../../packages/host/src/plugin-host/user-plugin-builder')
    await buildUserPlugin(targetDir)

    // --- T15 negative: a sibling plugin with a malformed bakin range must be
    // refused at activation (malformed ranges reject even on dev hosts, so
    // this works with the repo's 0.0.0-dev APP_VERSION). No dist needed —
    // the compat gate fires before the dist check.
    const badDir = join(testDir, 'plugins', BAD_RANGE_ID)
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'bakin-plugin.json'), JSON.stringify({
      id: BAD_RANGE_ID,
      name: 'Bad Range',
      version: '1.0.0',
      bakin: 'banana',
      description: 'T15 activation-refusal fixture',
    }))

    // --- registry boot, like server.ts after buildAllUserPlugins ---
    const reg = await import('../../src/core/plugin-registry')
    pluginRegistry = reg.pluginRegistry
    pluginRegistry._resetForTests()
    reg.registerCorePlugins({})
    const storage = { read: mock(), write: mock(), append: mock(), exists: mock(), readAll: mock() }
    const events = { emit: mock(), on: mock(), once: mock() }
    await pluginRegistry.initialize({ plugins: [] }, storage, events)

    const execTools = await import('../../src/core/exec-tools/registry')
    getExecTool = execTools.getExecTool
    getToolContext = execTools.getToolContext

    const catchAll = await import('../../packages/host/src/api/plugins/[pluginId]/[[...path]]')
    handlePluginRoute = catchAll.get
  }, 120_000)

  afterAll(() => {
    pluginRegistry?._resetForTests?.()
    delete (globalThis as any).__bakinAppServices
    rmSync(testDir, { recursive: true, force: true })
  })

  it('builds dist from the scaffolded source', () => {
    const dist = join(testDir, 'plugins', PLUGIN_ID, 'dist')
    expect(existsSync(join(dist, 'index.js'))).toBe(true)
    expect(existsSync(join(dist, 'client.js'))).toBe(true)
  })

  it('activates cleanly against manifest enforcement', () => {
    expect(pluginRegistry.getPluginIds()).toContain(PLUGIN_ID)
    const entry = pluginRegistry
      .getRegistrySnapshot()
      .find((e: any) => e.id === PLUGIN_ID)
    expect(entry).toMatchObject({ status: 'active' })
  })

  it('refuses activation of a plugin with a malformed bakin range (T15)', () => {
    expect(pluginRegistry.getPluginIds()).not.toContain(BAD_RANGE_ID)
    const entry = pluginRegistry
      .getRegistrySnapshot()
      .find((e: any) => e.id === BAD_RANGE_ID)
    expect(entry).toMatchObject({ status: 'failed', errorCode: 'incompatible_host' })
    expect(String(entry.errorMessage)).toContain('banana')
  })

  it('serves the scaffolded route through the real dispatch path', async () => {
    const url = new URL(`http://localhost/api/plugins/${PLUGIN_ID}/hello`)
    const res = await handlePluginRoute(new Request(url), url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe(`Hello from the ${PLUGIN_ID} plugin!`)
  })

  it('sync-manifest on the scaffold is in sync with enforcement (T16)', async () => {
    const { syncPluginManifest } = await import('../../src/core/plugin-sync-manifest')
    const targetDir = join(testDir, 'plugins', PLUGIN_ID)

    // The scaffold's hand-written contributes must already match its code —
    // --check reports no drift (exit-0 semantics).
    const check = await syncPluginManifest(targetDir, { check: true, skipBuild: true })
    expect(check.ok).toBe(true)
    expect(check.changed).toBe(false)

    // And a full regeneration from a stripped manifest reproduces a manifest
    // that passes the same activation enforcement the registry applies.
    const manifestPath = join(targetDir, 'bakin-plugin.json')
    const original = readFileSync(manifestPath, 'utf-8')
    try {
      const stripped = JSON.parse(original)
      delete stripped.contributes.apiRoutes
      delete stripped.contributes.execTools
      writeFileSync(manifestPath, JSON.stringify(stripped, null, 2))

      const sync = await syncPluginManifest(targetDir, { skipBuild: true })
      expect(sync.ok).toBe(true)
      expect(sync.written).toBe(true)

      const regenerated = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const { parsePluginManifest } = await import('../../packages/core/src/plugins/manifest')
      const parsed = parsePluginManifest(regenerated)
      const declaredRoutes = parsed.contributes?.apiRoutes ?? []
      expect(declaredRoutes.some((r: any) => r.method === 'GET' && r.path === '/hello')).toBe(true)
      const declaredTools = parsed.contributes?.execTools ?? []
      expect(declaredTools.some((t: any) => t.name === `bakin_exec_${PLUGIN_ID}_greet`)).toBe(true)
    } finally {
      writeFileSync(manifestPath, original)
    }
  })

  it('exec tool is registered, callable, and its write is visible to the route', async () => {
    const toolName = `bakin_exec_${PLUGIN_ID}_greet`
    const tool = getExecTool(toolName)
    expect(tool).toBeDefined()

    const toolCtx = getToolContext(toolName)
    expect(toolCtx).toBeDefined()
    const result = await tool.handler({ name: 'Ada' }, 'test-agent', toolCtx)
    expect(result).toMatchObject({ ok: true, message: 'Hello from Ada!' })

    // Full loop: the route reads the greeting the tool persisted.
    const url = new URL(`http://localhost/api/plugins/${PLUGIN_ID}/hello`)
    const res = await handlePluginRoute(new Request(url), url)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Hello from Ada!')
  })
})
