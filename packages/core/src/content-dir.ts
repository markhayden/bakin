/**
 * Content directory resolution for Bakin.
 *
 * This is the SINGLE SOURCE OF TRUTH for where Bakin content lives.
 * All code that needs content paths should import from here.
 *
 * Resolution order:
 * 1. BAKIN_HOME env var (if set)
 * 2. ~/.bakin/
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { APP_SLUG } from './constants'

// Computed lazily (not at module load) so tests that `vi.mock('os', …)` to
// redirect homedir() still work — vi.mock hoists the factory above module-
// level code, and evaluating it at import time would TDZ-error on the
// per-file testHome consts the factory captures.
function bakinHomeDefault(): string {
  return join(homedir(), `.${APP_SLUG}`)
}

let resolvedContentDir: string | null = null

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true' || !!process.env.VITEST
}

// Refuse to resolve to the developer's REAL ~/.bakin/ during a test run. A
// misconfigured test (missing vi.mock, stale cache, forgotten BAKIN_HOME
// override) has repeatedly leaked test data into the production instance.
// When this guard fires, the fix is to mock src/core/content-dir or set
// BAKIN_HOME to a temp directory — never to remove the guard.
//
// The comparison uses process.env.HOME directly instead of os.homedir() so
// tests that vi.mock('os') to redirect homedir() still benefit from the
// guard — the mock changes the module's view, but the real shell $HOME is
// the thing we're actually protecting.
function realBakinHome(): string {
  const realHome = process.env.HOME || process.env.USERPROFILE || ''
  if (!realHome) return ''
  return join(realHome, `.${APP_SLUG}`)
}

function assertSafeForTest(path: string): void {
  if (!isTestEnv()) return
  const real = realBakinHome()
  if (real && path === real) {
    throw new Error(
      `[bakin] getContentDir() resolved to the real Bakin home (${real}) `
      + `during a test run. This would write test data to your production instance. `
      + `Fix: mock src/core/content-dir in this test, or set BAKIN_HOME to a temp `
      + `directory before importing any Bakin module. See CLAUDE.md § Testing Rules.`
    )
  }
}

/**
 * Resolve the content directory path.
 */
export function getContentDir(): string {
  if (resolvedContentDir) return resolvedContentDir

  const resolved = resolveContentDirInner()
  assertSafeForTest(resolved)
  resolvedContentDir = resolved
  return resolvedContentDir
}

function resolveContentDirInner(): string {
  // 1. BAKIN_HOME env var
  if (process.env.BAKIN_HOME) return process.env.BAKIN_HOME

  // 2. ~/.bakin/
  return bakinHomeDefault()
}

/**
 * Whether the content dir is inside the supported Bakin home contract.
 */
export function isUsingBakinHome(): boolean {
  const dir = getContentDir()
  return dir === bakinHomeDefault() || dir === process.env.BAKIN_HOME
}

/**
 * Reset the resolved content dir (for testing).
 */
export function resetContentDir(): void {
  resolvedContentDir = null
}

/**
 * Well-known content paths. Agents and CLI use these instead of constructing paths.
 */
export interface BakinPaths {
  home: string
  memoryLog: string
  audit: string
  assets: string
  'assets.store': string
  'assets.inbox': string
  'assets.trash': string
  agents: string
  personas: string
  team: string
  heartbeats: string
  inbox: string
  tasks: string
  workflows: string
  settings: string
  logs: string
  db: string
}

export function getBakinPaths(): BakinPaths {
  const home = getContentDir()
  const assets = join(home, 'assets')
  return {
    home,
    memoryLog: join(home, 'MEMORY-LOG.md'),
    audit: join(home, 'audit.jsonl'),
    assets,
    'assets.store': join(assets, 'store'),
    'assets.inbox': join(assets, 'inbox'),
    'assets.trash': join(assets, '.trash'),
    agents: join(home, 'agents'),
    personas: join(home, 'team', 'personas'),
    team: join(home, 'team'),
    heartbeats: join(home, 'heartbeats'),
    inbox: join(home, 'inbox'),
    tasks: join(home, 'tasks'),
    workflows: join(home, 'workflows'),
    settings: join(home, 'settings.json'),
    logs: join(home, 'logs'),
    db: join(home, 'bakin.db'),
  }
}

/**
 * Initialize the ~/.bakin/ directory structure.
 * Called by `bakin mkdir` CLI command or on first run.
 */
export function initBakinHome(targetDir?: string): { created: string[]; seeded: string[] } {
  const home = targetDir || bakinHomeDefault()
  const created: string[] = []
  const seeded: string[] = []

  // Under filename-as-identity, asset storage is flat under
  // assets/store/{YYYY-MM}/ — month shards are created on-demand by
  // saveAsset, so initBakinHome only seeds the parent roots and the
  // inbox + trash siblings.
  const dirs = [
    home,
    join(home, 'assets'),
    join(home, 'assets', 'store'),
    join(home, 'assets', 'inbox'),
    join(home, 'assets', '.trash'),
    join(home, 'agents'),
    join(home, 'heartbeats'),
    join(home, 'inbox'),
    join(home, 'plugins'),
    join(home, 'tasks'),
    join(home, 'team'),
    join(home, 'team', 'personas'),
    join(home, 'workflows'),
    join(home, 'workflows', 'definitions'),
    join(home, 'workflows', 'skills'),
    join(home, 'workflows', 'instances'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      created.push(dir)
    }
  }

  // Seed skill files from workflow plugin defaults
  const projectRoot = join(process.cwd())
  const defaultSkillsDir = join(projectRoot, 'plugins', 'workflows', 'defaults', 'skills')
  if (existsSync(defaultSkillsDir)) {
    const targetSkillsDir = join(home, 'workflows', 'skills')
    for (const file of readdirSync(defaultSkillsDir)) {
      const target = join(targetSkillsDir, file)
      if (!existsSync(target)) {
        copyFileSync(join(defaultSkillsDir, file), target)
        seeded.push(file)
      }
    }
  }

  // Seed workflow definitions from defaults
  const defaultDefsDir = join(projectRoot, 'plugins', 'workflows', 'defaults', 'definitions')
  if (existsSync(defaultDefsDir)) {
    const targetDefsDir = join(home, 'workflows', 'definitions')
    for (const file of readdirSync(defaultDefsDir)) {
      const target = join(targetDefsDir, file)
      if (!existsSync(target)) {
        copyFileSync(join(defaultDefsDir, file), target)
        seeded.push(file)
      }
    }
  }

  // Create default settings.json if missing
  const settingsPath = join(home, 'settings.json')
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, JSON.stringify({}, null, 2), 'utf-8')
    created.push(settingsPath)
  }

  return { created, seeded }
}
