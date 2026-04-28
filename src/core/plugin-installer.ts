/**
 * Plugin installer for Bakin (ClawHub — local first).
 * Handles installing, validating, and removing plugins.
 */
import { existsSync, readFileSync, writeFileSync, cpSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { createLogger } from './logger'
import type { PluginManifest } from '@bakin/core/plugin-types'

const log = createLogger('plugin-installer')

interface InstallResult {
  ok: boolean
  pluginId?: string
  error?: string
}

/**
 * Validate a plugin manifest file.
 */
function validateManifest(manifestPath: string): { valid: boolean; manifest?: PluginManifest; error?: string } {
  if (!existsSync(manifestPath)) {
    return { valid: false, error: 'No bakin-plugin.json found' }
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
    const required: (keyof PluginManifest)[] = ['id', 'name', 'version', 'entry']
    for (const field of required) {
      if (!manifest[field]) {
        return { valid: false, error: `Missing required field: ${String(field)}` }
      }
    }
    if (!manifest.entry.server) {
      return { valid: false, error: 'Missing entry.server in manifest' }
    }
    return { valid: true, manifest }
  } catch (err) {
    return { valid: false, error: `Invalid manifest JSON: ${err}` }
  }
}

/**
 * Install a plugin from a local path.
 * Copies the plugin directory to plugins/ and adds it to mc.config.ts.
 */
export async function installFromPath(sourcePath: string, projectRoot: string): Promise<InstallResult> {
  const manifestPath = join(sourcePath, 'bakin-plugin.json')
  const { valid, manifest, error } = validateManifest(manifestPath)

  if (!valid || !manifest) {
    return { ok: false, error: error || 'Invalid manifest' }
  }

  const targetDir = join(projectRoot, 'plugins', manifest.id)

  // Check for existing plugin
  if (existsSync(targetDir)) {
    return { ok: false, error: `Plugin "${manifest.id}" already installed at ${targetDir}` }
  }

  // Copy plugin directory
  try {
    cpSync(sourcePath, targetDir, { recursive: true })
  } catch (err) {
    return { ok: false, error: `Failed to copy plugin: ${err}` }
  }

  // Verify the entry file exists
  const entryPath = join(targetDir, manifest.entry.server)
  if (!existsSync(entryPath)) {
    rmSync(targetDir, { recursive: true, force: true })
    return { ok: false, error: `Entry file not found: ${manifest.entry.server}` }
  }

  // Add to mc.config.ts
  const configPath = join(projectRoot, 'mc.config.ts')
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf-8')
      // Insert a new plugin entry before the closing bracket of the plugins array
      const pluginEntry = `    { path: 'plugins/${manifest.id}' },`
      const updatedConfig = configContent.replace(
        /(\s*\]\s*,?\s*(?:theme|storage|}))/,
        `\n${pluginEntry}$1`
      )
      if (updatedConfig !== configContent) {
        writeFileSync(configPath, updatedConfig, 'utf-8')
      }
    } catch (err) {
      log.warn('Failed to update mc.config.ts — plugin installed but not registered', err)
    }
  }

  log.info(`Plugin installed: ${manifest.name} v${manifest.version}`, { id: manifest.id })
  return { ok: true, pluginId: manifest.id }
}

/**
 * Install a plugin from a GitHub repository.
 * Clones the repo to a temp dir, validates, then installs.
 */
export async function installFromGithub(repo: string, projectRoot: string): Promise<InstallResult> {
  const { execSync } = await import('child_process')
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')

  const tempDir = mkdtempSync(join(tmpdir(), 'bakin-plugin-'))

  try {
    // Normalize repo format: "user/repo" -> "https://github.com/user/repo.git"
    const gitUrl = repo.startsWith('http')
      ? repo
      : `https://github.com/${repo.replace(/^github:/, '')}.git`

    execSync(`git clone --depth 1 ${gitUrl} ${tempDir}`, { stdio: 'pipe' })

    return await installFromPath(tempDir, projectRoot)
  } catch (err) {
    return { ok: false, error: `Git clone failed: ${err}` }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
  }
}

/**
 * Remove an installed plugin.
 */
export function removePlugin(pluginId: string, projectRoot: string): InstallResult {
  const targetDir = join(projectRoot, 'plugins', pluginId)

  if (!existsSync(targetDir)) {
    return { ok: false, error: `Plugin "${pluginId}" not found` }
  }

  try {
    rmSync(targetDir, { recursive: true, force: true })
  } catch (err) {
    return { ok: false, error: `Failed to remove plugin: ${err}` }
  }

  // Remove from mc.config.ts
  const configPath = join(projectRoot, 'mc.config.ts')
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf-8')
      const updatedConfig = configContent.replace(
        new RegExp(`\\s*\\{\\s*path:\\s*'plugins/${pluginId}'.*?\\},?\\n?`, 'g'),
        ''
      )
      if (updatedConfig !== configContent) {
        writeFileSync(configPath, updatedConfig, 'utf-8')
      }
    } catch (err) {
      log.warn('Failed to update mc.config.ts', err)
    }
  }

  log.info(`Plugin removed: ${pluginId}`)
  return { ok: true, pluginId }
}

/**
 * List installed plugins with their manifest info.
 */
export function listInstalled(projectRoot: string): PluginManifest[] {
  const pluginsDir = join(projectRoot, 'plugins')
  if (!existsSync(pluginsDir)) return []

  const { readdirSync } = require('fs')
  const dirs = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((d: { isDirectory(): boolean }) => d.isDirectory())

  const manifests: PluginManifest[] = []
  for (const dir of dirs) {
    const manifestPath = join(pluginsDir, dir.name, 'bakin-plugin.json')
    if (existsSync(manifestPath)) {
      try {
        manifests.push(JSON.parse(readFileSync(manifestPath, 'utf-8')))
      } catch {
        // skip invalid manifests
      }
    }
  }
  return manifests
}
