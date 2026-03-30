/**
 * Plugin data migration framework for Bakin.
 * Tracks plugin versions and runs migrations when plugins are updated.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { createLogger } from './logger'

const log = createLogger('migrations')

interface PluginVersions {
  [pluginId: string]: string
}

interface Migration {
  version: string
  description: string
  up: (contentDir: string) => void | Promise<void>
}

function getVersionsFile(contentDir: string): string {
  return join(contentDir, '.bakin', 'plugin-versions.json')
}

function loadVersions(contentDir: string): PluginVersions {
  const file = getVersionsFile(contentDir)
  try {
    if (existsSync(file)) {
      return JSON.parse(readFileSync(file, 'utf-8'))
    }
  } catch (err) {
    log.warn('Failed to read plugin versions', err)
  }
  return {}
}

function saveVersions(contentDir: string, versions: PluginVersions): void {
  const dir = join(contentDir, '.bakin')
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs')
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(getVersionsFile(contentDir), JSON.stringify(versions, null, 2), 'utf-8')
}

/**
 * Compare two semver version strings.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number)
  const partsB = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const va = partsA[i] || 0
    const vb = partsB[i] || 0
    if (va < vb) return -1
    if (va > vb) return 1
  }
  return 0
}

/**
 * Load migrations from a plugin's migrations directory.
 * Migration files should be named like: 1.1.0.ts or 1.1.0.js
 * and export { version, description, up }.
 */
async function loadMigrations(migrationsDir: string): Promise<Migration[]> {
  if (!existsSync(migrationsDir)) return []

  const files = readdirSync(migrationsDir)
    .filter(f => /^\d+\.\d+\.\d+\.(ts|js)$/.test(f))
    .sort((a, b) => {
      const va = a.replace(/\.(ts|js)$/, '')
      const vb = b.replace(/\.(ts|js)$/, '')
      return compareVersions(va, vb)
    })

  const migrations: Migration[] = []
  for (const file of files) {
    try {
      const mod = await import(join(migrationsDir, file))
      const migration = mod.default || mod
      if (migration.version && migration.up) {
        migrations.push(migration)
      }
    } catch (err) {
      log.warn(`Failed to load migration ${file}`, err)
    }
  }
  return migrations
}

/**
 * Run pending migrations for a plugin.
 * Only runs migrations with versions newer than the stored version.
 */
export async function runMigrations(
  pluginId: string,
  currentVersion: string,
  migrationsDir: string,
  contentDir: string
): Promise<number> {
  const versions = loadVersions(contentDir)
  const storedVersion = versions[pluginId]

  // First time — no migrations needed, just record version
  if (!storedVersion) {
    versions[pluginId] = currentVersion
    saveVersions(contentDir, versions)
    return 0
  }

  // No version change
  if (compareVersions(storedVersion, currentVersion) >= 0) {
    return 0
  }

  const migrations = await loadMigrations(migrationsDir)
  const pending = migrations.filter(m => compareVersions(m.version, storedVersion) > 0)

  if (pending.length === 0) {
    versions[pluginId] = currentVersion
    saveVersions(contentDir, versions)
    return 0
  }

  let ran = 0
  for (const migration of pending) {
    try {
      log.info(`Running migration ${pluginId}@${migration.version}: ${migration.description}`)
      await migration.up(contentDir)
      versions[pluginId] = migration.version
      saveVersions(contentDir, versions)
      ran++
    } catch (err) {
      log.error(`Migration failed: ${pluginId}@${migration.version}`, err)
      throw err // Stop on failure — don't skip migrations
    }
  }

  // Update to current version after all migrations
  versions[pluginId] = currentVersion
  saveVersions(contentDir, versions)

  log.info(`Migrations complete for ${pluginId}`, { ran, from: storedVersion, to: currentVersion })
  return ran
}

/**
 * Get the stored version for a plugin.
 */
export function getStoredVersion(pluginId: string, contentDir: string): string | null {
  const versions = loadVersions(contentDir)
  return versions[pluginId] || null
}

export { compareVersions }
