/**
 * PR5 (#895 D15, D23): search maintenance runs as operations and every
 * background search mutator goes through the search-engine resource.
 *
 * - The reindex job registry, its status route and the any-pass coalescer
 *   never come back.
 * - The request router has no `?async` branch.
 * - The rebuild pass asserts its caller owns search-engine.
 * - The migration pump, boot resumption and the wedge watchdog take the
 *   engine through the non-blocking background pass.
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

const read = (file: string) => readFileSync(join(ROOT, file), 'utf-8')

/** Code only — comment lines dropped. */
const code = (text: string): string => text.split('\n').filter((line) => {
  const t = line.trim()
  return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//'))
}).join('\n')

const DELETED = [
  /\bstartReindexJob\b/,
  /\bgetReindexJobStatus\b/,
  /\bReindexJobStatus\b/,
  /\brebuildInFlight\b/,
  /api\/reindex\/status/,
  /core\/search-reset\b/,
]

export function deletedSymbolHits(file: string, text: string): string[] {
  return DELETED.filter((re) => re.test(text)).map((re) => `${file}: ${re.source}`)
}

const ASYNC_BRANCH = /searchParams\.get\(\s*['"]async['"]\s*\)|[?&]async=1/

const REGISTRY_CORE = 'src/core/search-registry-core.ts'
const SEARCH_STARTUP = 'src/core/search-startup.ts'

describe('the reindex job registry and coalescer are gone', () => {
  it('no source names a deleted symbol, module or route', () => {
    const hits: string[] = []
    for (const root of SCAN_ROOTS) {
      for (const full of sourceFiles(join(ROOT, root))) hits.push(...deletedSymbolHits(relative(ROOT, full), readFileSync(full, 'utf-8')))
    }
    expect(hits).toEqual([])
    expect(existsSync(join(ROOT, 'src/core/search-reset.ts'))).toBe(false)
  })

  it('has teeth', () => {
    expect(deletedSymbolHits('x.ts', `const job = startReindexJob(table)`)).toHaveLength(1)
    expect(deletedSymbolHits('x.ts', `await apiGet('/api/reindex/status')`)).toHaveLength(1)
    expect(deletedSymbolHits('x.ts', `registry.start(reindexOperation({ origin: 'web' }))`)).toEqual([])
  })
})

describe('search maintenance answers as operations', () => {
  it('the request router has no ?async branch', () => {
    expect(ASYNC_BRANCH.test(code(read('src/core/server/request-handler.ts')))).toBe(false)
  })

  it('the reindex and reset routes start operations, and the CLI follows them', () => {
    const route = read('packages/host/src/api/search/maintenance.ts')
    expect(route).toContain('startOperationResponse(reindexOperation(')
    expect(route).toContain('startOperationResponse(searchResetOperation(')
    const cli = code(read('src/cli/commands/search.ts'))
    expect(cli).toContain('startAndFollow(')
    expect(cli).not.toMatch(/setTimeout\(resolve, 2_000\)/)
  })

  it('the agent exec tool starts a reindex operation instead of calling the rebuild pass', () => {
    const tool = code(read('src/core/exec-tools/tools/search-tools.ts'))
    expect(tool).toContain("reindexOperation({ table: tableParam, origin: 'system' })")
    expect(tool).not.toMatch(/rebuildRegisteredTables\(/)
  })
})

describe('every search mutator owns search-engine', () => {
  it('the rebuild pass asserts its caller owns the engine', () => {
    expect(read(REGISTRY_CORE)).toMatch(/assertResourceHeld\('search-engine', 'rebuildRegisteredTables'\)/)
  })

  it('the pump timer, boot resumption and the wedge watchdog go through the background pass', () => {
    const core = code(read(REGISTRY_CORE))
    expect(core).toMatch(/holdNow\(\['search-engine'\], BACKGROUND_MIGRATION/)
    expect(core).toMatch(/pumpTimer = setInterval\(\(\) => \{\s*void migrationPumpTick\(\)/)
    expect(core).toMatch(/export async function resumeTableMigrations\(\): Promise<void> \{\s*const ran = await backgroundPass\(/)
    // A deferred boot resumption is retried by the pump, never dropped.
    expect(core).toMatch(/if \(!ran\) bootResumePending = true/)
    expect(core).toMatch(/await backgroundPass\('wedge watchdog restart'/)
    // Startup resumes through the gated entry, never the raw resume.
    expect(code(read(SEARCH_STARTUP))).not.toMatch(/resumeVersionedMigrations|resumeMigrations\(/)
  })
})
