/**
 * mcporter integration for Bakin.
 *
 * Manages mcporter installation and per-agent MCP server config entries.
 * Each agent gets a `bakin-<agent>` entry in ~/.mcporter/mcporter.json
 * pointing to http://localhost:<port>/mcp?agent=<agent>.
 *
 * This allows agents to call Bakin MCP tools via:
 *   mcporter call bakin-pixel.bakin_exec_tasks_log_progress taskId=abc message="hello"
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { createLogger } from './logger'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import { createAppServices, maybeGetAppServices } from './app-services'

const log = createLogger('mcporter')

// Resolved lazily so tests can override HOME between runs.
function mcporterHome(): string {
  return join(process.env.HOME || '~', '.mcporter')
}
function mcporterConfig(): string {
  return join(mcporterHome(), 'mcporter.json')
}

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
  if (!existsSync(mcporterConfig())) return {}
  try {
    return JSON.parse(readFileSync(mcporterConfig(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeConfig(config: McporterConfig): void {
  if (!existsSync(mcporterHome())) {
    mkdirSync(mcporterHome(), { recursive: true })
  }
  writeFileSync(mcporterConfig(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

async function getRuntimeForMcporter(): Promise<AgentRuntimeAdapter> {
  const existing = maybeGetAppServices()?.runtime
  if (existing) return existing
  return (await createAppServices()).runtime
}

async function listRuntimeAgentIds(): Promise<string[]> {
  const runtime = await getRuntimeForMcporter()
  return (await runtime.agents.list()).map((agent) => agent.id).filter(Boolean)
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
export async function syncConfig(port: number): Promise<string[]> {
  const agents = await listRuntimeAgentIds()
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
export async function verifyConfig(port: number): Promise<{
  installed: boolean
  configExists: boolean
  agentEntries: Array<{ agent: string; name: string; url: string; correct: boolean }>
  staleEntries: string[]
}> {
  const agents = await listRuntimeAgentIds()
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
    configExists: existsSync(mcporterConfig()),
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
export async function setup(port: number): Promise<boolean> {
  if (!ensureInstalled()) {
    log.error('mcporter setup failed — could not install')
    return false
  }

  const changes = await syncConfig(port)
  if (changes.length > 0) {
    log.info('mcporter config synced', { changes })
  } else {
    log.info('mcporter config already up to date')
  }

  return true
}
