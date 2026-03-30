/**
 * mcporter integration for Bakin.
 *
 * Manages mcporter installation and per-agent MCP server config entries.
 * Each agent gets a `bakin-<agent>` entry in ~/.mcporter/mcporter.json
 * pointing to http://localhost:<port>/mcp?agent=<agent>.
 *
 * This allows agents to call Bakin MCP tools via:
 *   mcporter call bakin-pixel.bakin_log_progress taskId=abc message="hello"
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { createLogger } from './logger'
import { getSettings } from './settings'

const log = createLogger('mcporter')

const MCPORTER_HOME = join(process.env.HOME || '~', '.mcporter')
const MCPORTER_CONFIG = join(MCPORTER_HOME, 'mcporter.json')

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export function isMcporterInstalled(): boolean {
  try {
    // Must be in PATH — npx fallback is not enough since agents run bare `mcporter` commands
    execSync('which mcporter', { encoding: 'utf-8', stdio: 'pipe' })
    execSync('mcporter --version', { encoding: 'utf-8', stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function installMcporter(): boolean {
  log.info('Installing mcporter globally...')
  try {
    execSync('npm install -g mcporter', { encoding: 'utf-8', stdio: 'pipe' })
    log.info('mcporter installed successfully')
    return true
  } catch (err) {
    log.error('Failed to install mcporter', err)
    return false
  }
}

/**
 * Ensure mcporter is installed. Returns true if available.
 */
export function ensureInstalled(): boolean {
  if (isMcporterInstalled()) return true
  return installMcporter()
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface McporterServerEntry {
  url?: string
  description?: string
}

interface McporterConfig {
  mcpServers?: Record<string, McporterServerEntry>
}

function readConfig(): McporterConfig {
  if (!existsSync(MCPORTER_CONFIG)) return {}
  try {
    return JSON.parse(readFileSync(MCPORTER_CONFIG, 'utf-8'))
  } catch {
    return {}
  }
}

function writeConfig(config: McporterConfig): void {
  if (!existsSync(MCPORTER_HOME)) {
    mkdirSync(MCPORTER_HOME, { recursive: true })
  }
  writeFileSync(MCPORTER_CONFIG, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Get the expected mcporter server name for an agent.
 */
export function serverName(agent: string): string {
  return `bakin-${agent}`
}

/**
 * Get the expected MCP URL for an agent.
 */
export function mcpUrl(agent: string, port: number): string {
  return `http://localhost:${port}/mcp?agent=${agent}`
}

/**
 * Write per-agent Bakin MCP entries to ~/.mcporter/mcporter.json.
 * Idempotent — only writes if entries are missing or outdated.
 * Returns list of changes made.
 */
export function syncConfig(port: number): string[] {
  const settings = getSettings()
  const agents = settings.agents
  const config = readConfig()
  const changes: string[] = []

  if (!config.mcpServers) config.mcpServers = {}

  for (const agent of agents) {
    const name = serverName(agent)
    const url = mcpUrl(agent, port)
    const existing = config.mcpServers[name]

    if (!existing || existing.url !== url) {
      config.mcpServers[name] = {
        url,
        description: `Bakin MCP for ${agent}`,
      }
      changes.push(existing ? `updated ${name}` : `added ${name}`)
    }
  }

  // Remove stale entries for agents no longer in settings
  for (const key of Object.keys(config.mcpServers)) {
    if (key.startsWith('bakin-')) {
      const agentName = key.slice('bakin-'.length)
      if (!agents.includes(agentName)) {
        delete config.mcpServers[key]
        changes.push(`removed ${key} (agent no longer in settings)`)
      }
    }
  }

  if (changes.length > 0) {
    writeConfig(config)
    log.info('mcporter config updated', { changes })
  }

  return changes
}

/**
 * Verify mcporter config is correct. Returns diagnostic info.
 */
export function verifyConfig(port: number): {
  installed: boolean
  configExists: boolean
  agentEntries: Array<{ agent: string; name: string; url: string; correct: boolean }>
  staleEntries: string[]
} {
  const settings = getSettings()
  const agents = settings.agents
  const config = readConfig()
  const servers = config.mcpServers || {}

  const agentEntries = agents.map(agent => {
    const name = serverName(agent)
    const expectedUrl = mcpUrl(agent, port)
    const entry = servers[name]
    return {
      agent,
      name,
      url: entry?.url || '',
      correct: entry?.url === expectedUrl,
    }
  })

  const staleEntries = Object.keys(servers)
    .filter(k => k.startsWith('bakin-') && !agents.includes(k.slice('bakin-'.length)))

  return {
    installed: isMcporterInstalled(),
    configExists: existsSync(MCPORTER_CONFIG),
    agentEntries,
    staleEntries,
  }
}

// ---------------------------------------------------------------------------
// Setup (called from server startup and bakin start)
// ---------------------------------------------------------------------------

/**
 * Full setup: ensure installed + sync config.
 * Returns true if everything is ready.
 */
export function setup(port: number): boolean {
  if (!ensureInstalled()) {
    log.error('mcporter setup failed — could not install')
    return false
  }

  const changes = syncConfig(port)
  if (changes.length > 0) {
    log.info('mcporter config synced', { changes })
  } else {
    log.info('mcporter config already up to date')
  }

  return true
}
