/**
 * Content directory resolution for Beacon.
 *
 * Resolution order:
 * 1. BEACON_HOME env var (if set)
 * 2. ~/.beacon/ (new default, if it exists)
 * 3. ./content/ (backward compat fallback if ~/.beacon/ doesn't exist and ./content/ does)
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
 * Reset the resolved content dir (for testing).
 */
export function resetContentDir(): void {
  resolvedContentDir = null
}

/**
 * Initialize the ~/.beacon/ directory structure.
 * Called by `beacon init` CLI command or on first run.
 */
export function initBeaconHome(targetDir?: string): { created: string[]; seeded: string[] } {
  const home = targetDir || BEACON_HOME_DEFAULT
  const created: string[] = []
  const seeded: string[] = []

  // Create directory structure
  const dirs = [
    home,
    join(home, 'plugins'),
    join(home, 'workflows'),
    join(home, 'workflows', 'definitions'),
    join(home, 'workflows', 'skills'),
    join(home, 'workflows', 'instances'),
    join(home, 'team'),
    join(home, 'heartbeats'),
    join(home, 'inbox'),
    join(home, 'docs'),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      created.push(dir)
    }
  }

  // Seed skill files from defaults
  const defaultSkillsDir = join(__dirname, 'defaults', 'skills')
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
  const defaultDefsDir = join(__dirname, 'defaults', 'definitions')
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
