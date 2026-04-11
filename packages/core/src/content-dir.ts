/**
 * Content directory resolution for Bakin.
 *
 * This is the SINGLE SOURCE OF TRUTH for where Bakin content lives.
 * All code that needs content paths should import from here.
 *
 * Resolution order:
 * 1. BAKIN_HOME env var (if set)
 * 2. ~/.bakin/ (preferred default, if it exists)
 * 3. ./content/ (backward compat fallback)
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { APP_SLUG } from './constants'

const BAKIN_HOME_DEFAULT = join(homedir(), `.${APP_SLUG}`)

let resolvedContentDir: string | null = null

/**
 * Resolve the content directory path.
 */
export function getContentDir(): string {
  if (resolvedContentDir) return resolvedContentDir

  // 1. BAKIN_HOME env var
  if (process.env.BAKIN_HOME) {
    resolvedContentDir = process.env.BAKIN_HOME
    return resolvedContentDir
  }

  // 2. CONTENT_DIR env var (existing compat)
  if (process.env.CONTENT_DIR) {
    resolvedContentDir = process.env.CONTENT_DIR
    return resolvedContentDir
  }

  // 3. ~/.bakin/ if it exists
  if (existsSync(BAKIN_HOME_DEFAULT)) {
    resolvedContentDir = BAKIN_HOME_DEFAULT
    return resolvedContentDir
  }

  // 4. ./content/ fallback
  const localContent = join(process.cwd(), 'content')
  if (existsSync(localContent)) {
    resolvedContentDir = localContent
    return resolvedContentDir
  }

  // Default: ./content/ even if it doesn't exist yet
  resolvedContentDir = localContent
  return resolvedContentDir
}

/**
 * Whether the content dir has been migrated to ~/.bakin/.
 */
export function isUsingBakinHome(): boolean {
  const dir = getContentDir()
  return dir === BAKIN_HOME_DEFAULT || dir === process.env.BAKIN_HOME
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
  messaging: string
  audit: string
  assets: string
  'assets.text': string
  'assets.images': string
  'assets.video': string
  'assets.audio': string
  'assets.plans': string
  'assets.data': string
  'assets.other': string
  agents: string
  personas: string
  team: string
  heartbeats: string
  inbox: string
  projects: string
  workflows: string
  settings: string
}

export function getBakinPaths(): BakinPaths {
  const home = getContentDir()
  const assets = join(home, 'assets')
  return {
    home,
    memoryLog: join(home, 'MEMORY-LOG.md'),
    messaging: join(home, 'messaging.json'),
    audit: join(home, 'audit.jsonl'),
    assets,
    'assets.text': join(assets, 'text'),
    'assets.images': join(assets, 'images'),
    'assets.video': join(assets, 'video'),
    'assets.audio': join(assets, 'audio'),
    'assets.plans': join(assets, 'plans'),
    'assets.data': join(assets, 'data'),
    'assets.other': join(assets, 'other'),
    agents: join(home, 'agents'),
    personas: join(home, 'team', 'personas'),
    team: join(home, 'team'),
    heartbeats: join(home, 'heartbeats'),
    inbox: join(home, 'inbox'),
    projects: join(home, 'projects'),
    workflows: join(home, 'workflows'),
    settings: join(home, 'settings.json'),
  }
}

/**
 * Initialize the ~/.bakin/ directory structure.
 * Called by `bakin init` CLI command or on first run.
 */
export function initBakinHome(targetDir?: string): { created: string[]; seeded: string[] } {
  const home = targetDir || BAKIN_HOME_DEFAULT
  const created: string[] = []
  const seeded: string[] = []

  // Create full directory structure matching what content/ contains
  const assetTypes = ['text', 'images', 'video', 'audio', 'plans', 'data', 'other']
  const assetDirs = assetTypes.flatMap(t => [
    join(home, 'assets', t),
    join(home, 'assets', t, '_unlinked'),
    join(home, 'assets', t, 'library'),
  ])

  const dirs = [
    home,
    join(home, 'assets'),
    join(home, 'assets', '.trash'),
    ...assetDirs,
    join(home, 'agents'),
    join(home, 'heartbeats'),
    join(home, 'inbox'),
    join(home, 'plugins'),
    join(home, 'projects'),
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

