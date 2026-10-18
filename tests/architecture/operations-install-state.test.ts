/**
 * PR4 G3 (#895): the legacy install job system and the throw-on-busy lock API
 * are gone, and every install-state writer runs under an owner.
 *
 * - The deleted symbols never come back (code or comments).
 * - No converted route grows an `?async` branch again.
 * - Every non-test file that calls an install-state writer owns the resource
 *   (an operation, a local operation, or `holdNow`) or is an engine module
 *   that ASSERTS ownership — so a new caller can never skip it silently.
 * - The converted routes start operations; the bounded synchronous writers
 *   take install-state without waiting.
 *
 * Pure scanner: reads source as text, imports no app modules.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SCAN_ROOTS = ['packages', 'plugins', 'src', 'cli', 'scripts']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor'])

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full
  }
}

const allSources = (): Array<{ file: string; text: string }> => {
  const out: Array<{ file: string; text: string }> = []
  for (const root of SCAN_ROOTS) {
    for (const full of sourceFiles(join(ROOT, root))) out.push({ file: relative(ROOT, full), text: readFileSync(full, 'utf-8') })
  }
  return out
}

/** Code only — comment lines dropped. */
const code = (text: string): string => text.split('\n').filter((line) => {
  const t = line.trim()
  return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))
}).join('\n')

// ── Deleted symbols ─────────────────────────────────────────────────────────

const DELETED = [
  /\bInstallProgressFn\b/,
  /\bpackages\.install_/,
  /\bstartInstallJob\b/,
  /\bgetInstallJob\b/,
  /\bacquireInstallLock\b/,
  /\bwithInstallLock\b/,
  /\bassertInstallLockHeld\b/,
  /\bInstallLockBusyError\b/,
  /\bisInstallLockBusy\b/,
  /install-core\/install-lock/,
  /agent-packages\/install-progress/,
  /api\/install-jobs/,
]

export function deletedSymbolHits(file: string, text: string): string[] {
  return DELETED.filter((re) => re.test(text)).map((re) => `${file}: ${re.source}`)
}

// ── Async query branches ────────────────────────────────────────────────────

const ASYNC_BRANCH = /searchParams\.get\(\s*['"]async['"]\s*\)|[?&]async=1/

// ── Install-state writers ───────────────────────────────────────────────────

/** Functions that write install-state (bins, projections, plugin dirs, ledgers, managed blocks). */
const WRITERS = [
  'installPackage', 'removePackageById', 'updatePackageById', 'upgradePlugin', 'commitInstall',
  'syncAgent', 'syncAllAgents', 'syncPack', 'repairPackLocally', 'migrateToManagedBlocks', 'setLessonEnabled',
  'confirmSkillInstall', 'replacePluginDir', 'installPluginBins', 'installManifestBins', 'installManifestRequirements',
  'restoreUninstallSnapshot', 'linkPlugin', 'unlinkPlugin', 'applyMapping', 'applyPluginAssets', 'installPluginAssets',
]

/** How a caller owns install-state: an operation, a local operation, a bounded non-blocking hold, or a repair declaring it. */
const OWNER_MARKER = /startOperationResponse[<(]|operations\.start[<(]|runOwning[<(]|runLocal[<(]|holdNow[<(]|resources:\s*\[\s*'install-state'/

/** Browser code: same-named client callbacks (e.g. a hook's `upgradePlugin`) are HTTP clients, not writers. */
const CLIENT = /^(plugins\/[^/]+\/(hooks|components)\/|packages\/(sdk|ui)\/|packages\/host\/src\/(routes|components|hooks|plugin-host)\/)|\.tsx$/

/**
 * Engine modules: they define or compose writers and ASSERT ownership
 * themselves (assertResourceHeld) — their callers own install-state. A new
 * entry needs the assertion; the test checks it.
 */
const ENGINE = new Map<string, string>([
  ['src/core/agent-packages/installer.ts', 'installPackage asserts; projects + installs requirements'],
  ['src/core/agent-packages/updater.ts', 'updatePackageById asserts'],
  ['src/core/agent-packages/uninstaller.ts', 'removePackageById asserts'],
  ['src/core/agent-packages/sync.ts', 'syncAgent / syncPack / local projection assert'],
  ['src/core/agent-packages/migration.ts', 'migrateToManagedBlocks asserts; syncs inside its owner'],
  ['src/core/agent-packages/bin-installer.ts', 'installManifestBins / installPluginBins assert'],
  ['src/core/plugins/replace-transaction.ts', 'replacePluginDir asserts'],
  ['src/core/plugins/upgrade.ts', 'upgradePlugin asserts for commits'],
])

/** Engine modules that compose asserting writers without asserting themselves (the asserting callee covers them). */
const COMPOSERS = new Set([
  'src/core/agent-packages/requirements-installer.ts',
  'src/core/agent-packages/skill-trust.ts',
  'src/core/plugins/upgrade-github.ts',
  'src/core/plugins/upgrade-artifact.ts',
  'src/core/plugins/upgrade-gate.ts',
  'src/core/plugins/link.ts',
  'src/core/onboarding/plugin-assets.ts',
  'packages/host/src/api/plugins/install/commit.ts',
  'src/core/runtime-switch.ts',
])

/** A call: not a member access, not a definition (`function name(`). */
const CALL = new RegExp(`(?<![\\w.]|function\\s)(${WRITERS.join('|')})\\(`, 'g')

/** Writer calls in `text` that no owner covers (pure — the teeth test feeds it fixtures). */
export function unownedWriterCalls(file: string, text: string): string[] {
  if (ENGINE.has(file) || COMPOSERS.has(file) || CLIENT.test(file)) return []
  const body = code(text)
  const calls = new Set([...body.matchAll(CALL)].map((m) => m[1]!))
  if (calls.size === 0 || OWNER_MARKER.test(body)) return []
  return [...calls].map((name) => `${file}: calls ${name}() with no owner of install-state`)
}

// ── Converted routes ────────────────────────────────────────────────────────

/** Routes that answer 202 and run as operations (PR3–PR4 so far). */
const CONVERTED_ROUTES = [
  'packages/host/src/api/packages/install.ts',
  'packages/host/src/api/packages/dynamic.ts',
  'packages/host/src/api/agent-packages/install.ts',
  'packages/host/src/api/agent-packages/dynamic.ts',
  'packages/host/src/api/plugins/install.ts',
  'packages/host/src/api/plugins/upgrade.ts',
  'packages/host/src/api/plugins/remove.ts',
  'packages/host/src/api/plugins/restore.ts',
  'packages/host/src/api/plugins/link.ts',
  'packages/host/src/api/skills.ts',
  'plugins/team/lib/routes/teams.ts',
]

/** Bounded synchronous writers: take install-state without waiting (409 install_busy). */
const NON_BLOCKING_WRITERS = [
  'src/core/agent-packages/lesson-toggle.ts',
  'packages/host/src/api/plugins/unlink.ts',
  'packages/host/src/api/skills.ts',
]

describe('the legacy install job system and lock API are gone', () => {
  it('no source names a deleted symbol, module or route', () => {
    expect(allSources().flatMap(({ file, text }) => deletedSymbolHits(file, text))).toEqual([])
  })

  it('the deleted modules are gone', () => {
    expect(existsSync(join(ROOT, 'src/core/install-core/install-lock.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/core/agent-packages/install-progress.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'packages/host/src/api/install-jobs.ts'))).toBe(false)
  })

  it('has teeth', () => {
    expect(deletedSymbolHits('x.ts', `import { withInstallLock } from '@/core/install-core/install-lock'`)).toHaveLength(2)
    expect(deletedSymbolHits('x.ts', `broadcast({ event: 'packages.install_progress' })`)).toHaveLength(1)
    expect(deletedSymbolHits('x.ts', `holdNow(['install-state'], identity, fn)`)).toEqual([])
  })
})

describe('no ?async branch in the API layer', () => {
  it('packages/host/src/api has none', () => {
    const hits = allSources()
      .filter(({ file }) => file.startsWith('packages/host/src/api/'))
      .filter(({ text }) => ASYNC_BRANCH.test(code(text)))
      .map(({ file }) => file)
    expect(hits).toEqual([])
  })

  it('has teeth', () => {
    expect(ASYNC_BRANCH.test(`if (url.searchParams.get('async') === '1') {`)).toBe(true)
    expect(ASYNC_BRANCH.test(`fetch('/api/packages/install?async=1')`)).toBe(true)
  })
})

describe('every install-state writer runs under an owner', () => {
  it('every caller of a writer owns install-state or is an asserting engine module', () => {
    expect(allSources().flatMap(({ file, text }) => unownedWriterCalls(file, text))).toEqual([])
  })

  it('every listed engine and composer module exists, and every engine module asserts ownership', () => {
    const missing = [...ENGINE.keys(), ...COMPOSERS].filter((file) => !existsSync(join(ROOT, file)))
    expect(missing).toEqual([])
    const unasserted = [...ENGINE.keys()].filter((file) => !/assertResourceHeld\(\s*'install-state'/.test(readFileSync(join(ROOT, file), 'utf-8')))
    expect(unasserted).toEqual([])
  })

  it('has teeth: a bare call is flagged; an owned one, a comment and a definition are not', () => {
    expect(unownedWriterCalls('src/new-flow.ts', `export async function go() { await installPackage({ source }) }`))
      .toEqual(['src/new-flow.ts: calls installPackage() with no owner of install-state'])
    expect(unownedWriterCalls('src/new-flow.ts', `await runOwning(input, () => syncAllAgents({ fetch: false }))`)).toEqual([])
    expect(unownedWriterCalls('src/new-flow.ts', `return startOperationResponse({ run: (op) => removePackageById({ packageId, op }) })`)).toEqual([])
    expect(unownedWriterCalls('src/new-flow.ts', `// installPackage() is called by the route`)).toEqual([])
    expect(unownedWriterCalls('src/new-flow.ts', `export async function linkPlugin(path: string) {}`)).toEqual([])
    expect(unownedWriterCalls('src/core/agent-packages/installer.ts', `await installPackage({ source })`)).toEqual([])
  })
})

describe('converted and synchronous routes', () => {
  it.each(CONVERTED_ROUTES)('%s starts operations', (file) => {
    expect(/startOperationResponse[<(]|operations\.start[<(]/.test(readFileSync(join(ROOT, file), 'utf-8'))).toBe(true)
  })

  it.each(NON_BLOCKING_WRITERS)('%s takes install-state without waiting', (file) => {
    expect(/holdNow\(\s*\[\s*'install-state'\s*\]/.test(readFileSync(join(ROOT, file), 'utf-8'))).toBe(true)
  })
})
