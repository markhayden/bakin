/**
 * Content directory resolution for Beacon.
 *
 * This is the SINGLE SOURCE OF TRUTH for where Beacon content lives.
 * All code that needs content paths should import from here.
 *
 * Resolution order:
 * 1. BEACON_HOME env var (if set)
 * 2. ~/.beacon/ (preferred default, if it exists)
 * 3. ./content/ (backward compat fallback)
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const BEACON_HOME_DEFAULT = join(homedir(), '.beacon')

let resolvedContentDir: string | null = null

/**
 * Resolve the content directory path.
 */
export function getContentDir(): string {
  if (resolvedContentDir) return resolvedContentDir

  // 1. BEACON_HOME env var
  if (process.env.BEACON_HOME) {
    resolvedContentDir = process.env.BEACON_HOME
    return resolvedContentDir
  }

  // 2. CONTENT_DIR env var (existing compat)
  if (process.env.CONTENT_DIR) {
    resolvedContentDir = process.env.CONTENT_DIR
    return resolvedContentDir
  }

  // 3. ~/.beacon/ if it exists
  if (existsSync(BEACON_HOME_DEFAULT)) {
    resolvedContentDir = BEACON_HOME_DEFAULT
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
 * Whether the content dir has been migrated to ~/.beacon/.
 */
export function isUsingBeaconHome(): boolean {
  const dir = getContentDir()
  return dir === BEACON_HOME_DEFAULT || dir === process.env.BEACON_HOME
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
export interface BeaconPaths {
  home: string
  taskboard: string
  memoryLog: string
  calendar: string
  audit: string
  assets: string
  personas: string
  team: string
  heartbeats: string
  inbox: string
  posts: string
  projects: string
  docs: string
  workflows: string
  settings: string
}

export function getBeaconPaths(): BeaconPaths {
  const home = getContentDir()
  return {
    home,
    taskboard: join(home, 'TASKBOARD.md'),
    memoryLog: join(home, 'MEMORY-LOG.md'),
    calendar: join(home, 'calendar.json'),
    audit: join(home, 'audit.jsonl'),
    assets: join(home, 'assets'),
    personas: join(home, 'team', 'personas'),
    team: join(home, 'team'),
    heartbeats: join(home, 'heartbeats'),
    inbox: join(home, 'inbox'),
    posts: join(home, 'posts'),
    projects: join(home, 'projects'),
    docs: join(home, 'docs'),
    workflows: join(home, 'workflows'),
    settings: join(home, '.beacon', 'settings.json'),
  }
}

/**
 * Initialize the ~/.beacon/ directory structure.
 * Called by `beacon init` CLI command or on first run.
 */
export function initBeaconHome(targetDir?: string): { created: string[]; seeded: string[] } {
  const home = targetDir || BEACON_HOME_DEFAULT
  const created: string[] = []
  const seeded: string[] = []

  // Create full directory structure matching what content/ contains
  const dirs = [
    home,
    join(home, '.beacon'),
    join(home, 'assets'),
    join(home, 'docs'),
    join(home, 'heartbeats'),
    join(home, 'inbox'),
    join(home, 'plugins'),
    join(home, 'posts'),
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
  const settingsPath = join(home, '.beacon', 'settings.json')
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, JSON.stringify({}, null, 2), 'utf-8')
    created.push(settingsPath)
  }

  return { created, seeded }
}
