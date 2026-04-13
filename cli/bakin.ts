#!/usr/bin/env npx tsx
/**
 * Bakin CLI — command-line interface for Bakin orchestration platform.
 * All commands are thin wrappers around the Bakin HTTP API.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import {
  cmdScheduleList, cmdScheduleAdd, cmdSchedulePause,
  cmdScheduleResume, cmdScheduleRemove, cmdScheduleRun, cmdScheduleRuns,
} from '../src/cli/schedule'

const BASE_URL = process.env.BAKIN_URL || 'http://localhost:3737'

// Resolve the orchestrator agent name from openclaw config.
// Convention: 'main' in openclaw.json maps to the orchestrator display name.
// Matches the resolution logic in src/core/models.ts — checks identity.name
// first, falls back to the AGENT_META mapping ('main' → 'main-operator').
function getCliAgent(): string {
  try {
    const configPath = getOpenClawPath('openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    const mainAgent = (config.agents?.list as Array<{ id: string; identity?: { name?: string } }>)
      ?.find(a => a.id === 'main')
    // identity.name takes precedence; otherwise use the standard main→main-operator mapping
    if (mainAgent?.identity?.name) return mainAgent.identity.name.toLowerCase()
    // Same default as models.ts AGENT_META for 'main'
    return 'main-operator'
  } catch {
    return 'main-operator'
  }
}

const CLI_AGENT = getCliAgent()

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function api(path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json()
}

async function apiGet(path: string): Promise<unknown> {
  return api(path)
}

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  return api(path, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function apiDelete(path: string): Promise<unknown> {
  return api(path, { method: 'DELETE' })
}

function print(data: unknown): void {
  if (typeof data === 'string') {
    console.log(data)
  } else {
    console.log(JSON.stringify(data, null, 2))
  }
}

function printTable(rows: Record<string, unknown>[], columns?: string[]): void {
  if (rows.length === 0) {
    console.log('(none)')
    return
  }
  const cols = columns || Object.keys(rows[0])
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)))

  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ')
  const sep = cols.map((_, i) => '-'.repeat(widths[i])).join('  ')
  console.log(header)
  console.log(sep)
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '))
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function cmdStatus(): Promise<void> {
  const dispatch = await apiGet('/api/dispatch') as Record<string, unknown>
  const settings = await apiGet('/api/settings') as Record<string, unknown>

  console.log('=== Bakin Status ===')
  console.log(`Dispatch interval: ${dispatch.intervalMin}min`)
  console.log(`Last run: ${dispatch.lastRun || 'never'}`)
  console.log(`Next run: ${dispatch.nextRun} (${dispatch.secondsUntilNext}s)`)
  console.log(`Tasks dispatched: ${dispatch.dispatchedCount}`)
  console.log(`Agents: ${(settings.agents as string[]).join(', ')}`)
}

async function cmdDispatch(): Promise<void> {
  const result = await apiPost('/api/dispatch')
  print(result)
}

async function cmdTasksList(column?: string): Promise<void> {
  // Read tasks from the API
  const result = await apiGet('/api/plugins/tasks/') as { columns: Record<string, Array<Record<string, unknown>>> }
  const columns = result.columns || {}

  if (column) {
    const col = columns[column]
    if (!col) {
      console.error(`Unknown column: ${column}. Available: ${Object.keys(columns).join(', ')}`)
      process.exit(1)
    }
    printTable(col as Record<string, unknown>[], ['id', 'title', 'agent'])
  } else {
    for (const [name, tasks] of Object.entries(columns)) {
      if ((tasks as unknown[]).length === 0) continue
      console.log(`\n=== ${name} ===`)
      printTable(tasks as Record<string, unknown>[], ['id', 'title', 'agent'])
    }
  }
}

async function cmdTasksCreate(title: string, assignee?: string, workflowId?: string, skipWorkflowReason?: string): Promise<void> {
  const body: Record<string, string> = { title }
  if (assignee) body.assignee = assignee
  if (workflowId) body.workflowId = workflowId
  if (skipWorkflowReason) body.skipWorkflowReason = skipWorkflowReason
  const result = await apiPost('/api/plugins/tasks/', body) as { ok?: boolean; id?: string; workflowId?: string; suggestedWorkflow?: string; error?: string }

  if (result.error) {
    console.error(`Error: ${result.error}`)
    process.exit(1)
  }

  // Warn if a workflow was suggested but not used and no reason given
  if (result.suggestedWorkflow && !workflowId && !skipWorkflowReason) {
    console.warn(`\n⚠  Workflow "${result.suggestedWorkflow}" matches this task but was not started.`)
    console.warn(`   Re-run with --workflow=${result.suggestedWorkflow} to use it,`)
    console.warn(`   or --no-workflow="<reason>" to skip with an audit trail.\n`)
  }

  print(result)
}

async function cmdTasksMove(id: string, to: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to, agent: CLI_AGENT })
  print(result)
}

async function cmdAgentsList(): Promise<void> {
  const result = await apiGet('/api/plugins/team/') as {
    agents: Array<{ id: string; name: string; status: string; model: string }>
  }
  for (const agent of result.agents) {
    const statusIcon = agent.status === 'working' ? '●' : agent.status === 'online' ? '○' : '·'
    console.log(`  ${statusIcon} ${agent.id}: ${agent.name} [${agent.status}] (${agent.model})`)
  }
}

async function cmdAgentsSend(agentId: string, message: string): Promise<void> {
  const result = await apiPost(`/api/agents/${agentId}/message`, { message })
  print(result)
}

async function cmdAgentsStatus(agentId: string): Promise<void> {
  const result = await apiGet(`/api/plugins/team/${agentId}`)
  print(result)
}

async function cmdAgentsTasks(agentId: string): Promise<void> {
  const result = await apiGet(`/api/agents/${agentId}/tasks`) as { tasks: Array<Record<string, unknown>> }
  printTable(result.tasks, ['id', 'title', 'column'])
}

async function cmdSettingsGet(key?: string): Promise<void> {
  const settings = await apiGet('/api/settings') as Record<string, unknown>
  if (key) {
    const parts = key.split('.')
    let val: unknown = settings
    for (const part of parts) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[part]
      else val = undefined
    }
    print(val)
  } else {
    print(settings)
  }
}

async function cmdSettingsSet(key: string, value: string): Promise<void> {
  const parts = key.split('.')
  let obj: Record<string, unknown> = {}
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }

  // Try to parse as JSON, fall back to string
  try {
    current[parts[parts.length - 1]] = JSON.parse(value)
  } catch {
    current[parts[parts.length - 1]] = value
  }

  const result = await apiPost('/api/settings', obj)
  print(result)
}

async function cmdPluginsList(): Promise<void> {
  const docs = await apiGet('/api/docs') as { routes: Array<Record<string, unknown>> }
  const plugins = new Set<string>()
  for (const route of docs.routes) {
    if (route.pluginId !== 'core') plugins.add(route.pluginId as string)
  }
  console.log('Installed plugins:')
  for (const p of plugins) {
    const routeCount = docs.routes.filter(r => r.pluginId === p).length
    console.log(`  ${p} (${routeCount} routes)`)
  }
}

async function cmdPluginsInstall(source: string): Promise<void> {
  if (source.startsWith('github:') || source.includes('/') && !source.startsWith('.') && !source.startsWith('/')) {
    const result = await apiPost('/api/plugins/install', { source, type: 'github' })
    print(result)
  } else {
    const result = await apiPost('/api/plugins/install', { source, type: 'local' })
    print(result)
  }
}

async function cmdPluginsRemove(pluginId: string): Promise<void> {
  const result = await apiPost('/api/plugins/remove', { pluginId })
  print(result)
}

async function cmdDocs(): Promise<void> {
  const docs = await apiGet('/api/docs') as { routes: Array<Record<string, unknown>> }
  for (const route of docs.routes) {
    const desc = route.description ? ` — ${route.description}` : ''
    console.log(`${route.method} ${route.fullPath}${desc}`)
  }
}

// ---------------------------------------------------------------------------
// Setup commands (run shell commands, not API wrappers)
// ---------------------------------------------------------------------------

async function cmdSetupAntfly(): Promise<void> {
  const { execSync } = await import('child_process')
  const { existsSync } = await import('fs')

  // Step 1: Check if binary exists
  const binaryPaths = [
    '/opt/homebrew/bin/antfly',
    '/usr/local/bin/antfly',
    `${process.env.HOME}/.antfly/bin/antfly`,
  ]
  const installed = binaryPaths.some(p => existsSync(p))

  if (installed) {
    console.log('[OK] Antfly binary already installed')
  } else {
    console.log('[..] Installing AntflyDB via Homebrew...')
    try {
      execSync('brew install --cask antflydb/antfly/antfly', { stdio: 'inherit' })
      console.log('[OK] Antfly installed')
    } catch (err) {
      console.error('[FAIL] Homebrew install failed. Install manually:')
      console.error('  brew install --cask antflydb/antfly/antfly')
      process.exit(1)
    }
  }

  // Step 2: Enable in settings
  console.log('[..] Enabling Antfly in Bakin settings...')
  try {
    await apiPost('/api/settings', { antfly: { enabled: true, url: 'http://localhost:8080/api/v1' } })
    console.log('[OK] Antfly enabled')
  } catch {
    console.log('[WARN] Could not reach Bakin API — is the server running?')
    console.log('  Start Bakin first: npm run dev')
    console.log('  Then re-run: bakin setup antfly')
    process.exit(1)
  }

  // Step 3: Reindex
  console.log('[..] Reindexing content (this may take a moment on first run)...')
  try {
    // Give Antfly time to start and create tables
    await new Promise(r => setTimeout(r, 5000))
    const result = await apiPost('/api/reindex', {}) as { indexed?: number }
    console.log(`[OK] Indexed ${result?.indexed || 0} documents`)
  } catch (err) {
    console.log('[WARN] Reindex failed — Antfly may still be starting. Try: bakin reindex')
  }

  console.log('')
  console.log('Antfly setup complete! Bakin will auto-start Antfly on boot.')
  console.log('  Search:     bakin search "your query"')
  console.log('  Dashboard:  http://localhost:11433')
  console.log('  Reindex:    bakin reindex')
}

async function cmdSearch(query: string, options: { table?: string; limit?: number; agent?: string; facets?: string } = {}): Promise<void> {
  let url = `/api/search?q=${encodeURIComponent(query)}`
  if (options.table) url += `&table=${encodeURIComponent(options.table)}`
  if (options.limit) url += `&limit=${options.limit}`
  if (options.facets) url += `&facets=${encodeURIComponent(options.facets)}`
  const result = await apiGet(url) as {
    results?: Array<{ key: string; score?: number; _table?: string; document?: Record<string, unknown> }>
    aggregations?: Record<string, Array<{ value: string; count: number }>>
    meta?: { query: string; total: number; took_ms: number; source: string }
  }

  if (result.meta) {
    console.log(`Search: "${result.meta.query}" — ${result.meta.total} results in ${result.meta.took_ms}ms (${result.meta.source})`)
  }

  if (result.results?.length) {
    for (const r of result.results) {
      const table = r._table ? ` [${r._table.replace('bakin_', '')}]` : ''
      const title = r.document?.title || r.document?.name || r.key
      console.log(`  ${title}${table} (score: ${r.score?.toFixed(3) ?? '?'})`)
    }
  } else {
    console.log('  No results found.')
  }

  if (result.aggregations && Object.keys(result.aggregations).length) {
    console.log('')
    for (const [facet, values] of Object.entries(result.aggregations)) {
      console.log(`  ${facet}: ${values.map(v => `${v.value}(${v.count})`).join(', ')}`)
    }
  }
}

async function cmdSearchStats(): Promise<void> {
  const result = await apiGet('/api/antfly/health') as {
    enabled: boolean
    tables: Array<{
      table: string
      pluginId: string
      stats: Record<string, unknown> | null
      indexHealth?: Array<{ name: string; error?: string; walBacklog: number; rebuilding: boolean }>
      healthy?: boolean
    }>
  }
  console.log(`Antfly: ${result.enabled ? 'enabled' : 'disabled'}`)
  if (result.tables?.length) {
    for (const t of result.tables) {
      const docs = (t.stats as any)?.num_docs ?? '?'
      const healthTag = t.healthy === false ? ' [unhealthy]'
        : t.indexHealth?.some(i => i.walBacklog > 0) ? ' [enriching]'
        : ''
      console.log(`  ${t.table} (${t.pluginId}): ${docs} docs${healthTag}`)
      if (t.healthy === false && t.indexHealth) {
        for (const idx of t.indexHealth) {
          if (idx.error) console.log(`    ${idx.name}: ERROR — ${idx.error}`)
        }
      }
    }
  }
}

async function cmdDoctor(): Promise<void> {
  const result = await apiGet('/api/plugins/health/doctor?fresh=true') as {
    results: Array<{ check: string; status: string; message: string }>
    summary: { total: number; errors: number; warnings: number }
  }

  const statusIcon: Record<string, string> = { ok: 'OK', warn: 'WARN', error: 'FAIL', fixed: 'FIXED' }

  for (const r of result.results) {
    const icon = statusIcon[r.status] || r.status
    console.log(`  [${icon}] ${r.check}: ${r.message}`)
  }

  console.log('')
  const { total, errors, warnings } = result.summary
  if (errors > 0) {
    console.log(`${errors} errors, ${warnings} warnings out of ${total} checks`)
  } else if (warnings > 0) {
    console.log(`${warnings} warnings out of ${total} checks`)
  } else {
    console.log(`All ${total} checks passed`)
  }
}

// ---------------------------------------------------------------------------
// Agent Rules
// ---------------------------------------------------------------------------

// Orchestrator rules block constants and template are owned by src/core/doctor.ts.
// Imported lazily inside cmdAgentRules so the CLI stays a pure entry point.

async function cmdAgentRules(options: { apply?: boolean; check?: boolean; applyAll?: boolean; checkAll?: boolean } = {}): Promise<void> {
  const { readFileSync, writeFileSync, existsSync } = await import('fs')
  const {
    AGENT_RULES_BLOCK_START,
    AGENT_RULES_BLOCK_END,
    resolveOrchestratorRules,
  } = await import('../src/core/doctor')

  const agentsPath = getOpenClawPath('workspace', 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    console.error(`[FAIL] AGENTS.md not found at ${agentsPath}`)
    process.exit(1)
  }

  const current = readFileSync(agentsPath, 'utf-8')
  const hasBlock = current.includes(AGENT_RULES_BLOCK_START)
  const resolvedContent = await resolveOrchestratorRules()

  if (options.check) {
    if (hasBlock) {
      // Verify content matches
      const startIdx = current.indexOf(AGENT_RULES_BLOCK_START)
      const endIdx = current.indexOf(AGENT_RULES_BLOCK_END)
      if (startIdx === -1 || endIdx === -1) {
        console.log('[WARN] Orchestrator rules block is malformed — run: bakin agent-rules --apply')
        process.exit(1)
      }
      const blockContent = current.slice(startIdx + AGENT_RULES_BLOCK_START.length, endIdx).trim()
      const expected = resolvedContent.trim()
      if (blockContent === expected) {
        console.log('[OK] Orchestrator rules block is present and up to date')
      } else {
        console.log('[WARN] Orchestrator rules block is outdated — run: bakin agent-rules --apply')
        process.exit(1)
      }
    } else {
      console.log('[WARN] Orchestrator rules block not found in AGENTS.md — run: bakin agent-rules --apply')
      process.exit(1)
    }
    return
  }

  if (!options.apply && !options.applyAll && !options.checkAll) {
    console.log('Usage: bakin agent-rules --apply       # Write orchestrator rules block to AGENTS.md')
    console.log('       bakin agent-rules --check       # Check if rules block is present and current')
    console.log('       bakin agent-rules --apply-all   # Apply all managed blocks to all agent AGENTS.md files')
    console.log('       bakin agent-rules --check-all   # Check all managed blocks across all agents')
    return
  }

  // Handle --apply-all and --check-all for all agents
  if (options.applyAll || options.checkAll) {
    const { applyAllManagedBlocks } = await import('../src/core/doctor')
    const results = applyAllManagedBlocks(!!options.applyAll)
    const errors = results.filter(r => r.status === 'error')
    const warnings = results.filter(r => r.status === 'warn')
    const fixes = results.filter(r => r.status === 'fixed')
    const oks = results.filter(r => r.status === 'ok')

    for (const r of results) {
      const icon = r.status === 'ok' ? '[OK]' : r.status === 'fixed' ? '[FIXED]' : r.status === 'warn' ? '[WARN]' : '[ERROR]'
      console.log(`${icon} ${r.check}: ${r.message}`)
    }

    console.log(`\n${oks.length} up to date, ${fixes.length} fixed, ${warnings.length} warnings, ${errors.length} errors`)
    if (errors.length > 0 || warnings.length > 0) process.exit(1)
    return
  }

  const block = `${AGENT_RULES_BLOCK_START}\n${resolvedContent}\n${AGENT_RULES_BLOCK_END}`

  let updated: string
  if (hasBlock) {
    // Replace existing block
    const startIdx = current.indexOf(AGENT_RULES_BLOCK_START)
    const endIdx = current.indexOf(AGENT_RULES_BLOCK_END)
    if (endIdx === -1) {
      console.error('[FAIL] Found start marker but no end marker — AGENTS.md may be corrupt')
      process.exit(1)
    }
    updated = current.slice(0, startIdx) + block + current.slice(endIdx + AGENT_RULES_BLOCK_END.length)
    console.log('[OK] Updated orchestrator rules block in AGENTS.md')
  } else {
    // Append to end of file
    updated = current.trimEnd() + '\n\n' + block + '\n'
    console.log('[OK] Added orchestrator rules block to AGENTS.md')
  }

  writeFileSync(agentsPath, updated, 'utf-8')
}

async function cmdPaths(key?: string): Promise<void> {
  const result = await apiGet(`/api/paths${key ? `?key=${encodeURIComponent(key)}` : ''}`) as Record<string, unknown>

  if (key) {
    // Single path — print just the value (useful for scripting: bakin paths assets)
    console.log(result.path)
  } else {
    const paths = result.paths as Record<string, string>
    const isHome = result.isBakinHome ? '~/.bakin' : './content (not migrated)'
    console.log(`Content dir: ${isHome}`)
    console.log('')
    for (const [k, v] of Object.entries(paths)) {
      console.log(`  ${k.padEnd(12)} ${v}`)
    }
  }
}

async function cmdInit(): Promise<void> {
  const { initBakinHome } = await import('../src/core/content-dir')
  const targetDir = process.env.BAKIN_HOME || undefined
  console.log(`Initializing Bakin home directory${targetDir ? ` at ${targetDir}` : ''}...`)
  const { created, seeded } = initBakinHome(targetDir)

  if (created.length > 0) {
    console.log(`Created ${created.length} directories/files`)
  }
  if (seeded.length > 0) {
    console.log(`Seeded ${seeded.length} default files: ${seeded.join(', ')}`)
  }
  if (created.length === 0 && seeded.length === 0) {
    console.log('Already initialized — nothing to do')
  }
  console.log('Done.')
}

const SERVICE_LABEL = 'com.openclaw.mc'

// ---------------------------------------------------------------------------
// LaunchAgent auto-start — commented out for now, run manually instead.
// To re-enable: uncomment generatePlist, the install path in cmdSetupService,
// and the launchctl path in cmdReboot.
// ---------------------------------------------------------------------------

// function generatePlist(opts: {
//   nodePath: string
//   tsxPath: string
//   serverPath: string
//   workingDir: string
//   stdoutPath: string
//   stderrPath: string
// }): string {
//   return `<?xml version="1.0" encoding="UTF-8"?>
// <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
//   "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
// <plist version="1.0">
// <dict>
//   <key>Label</key>
//   <string>${SERVICE_LABEL}</string>
//   <key>ProgramArguments</key>
//   <array>
//     <string>${opts.nodePath}</string>
//     <string>${opts.tsxPath}</string>
//     <string>${opts.serverPath}</string>
//   </array>
//   <key>EnvironmentVariables</key>
//   <dict>
//     <key>PATH</key>
//     <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
//     <key>NODE_ENV</key>
//     <string>development</string>
//   </dict>
//   <key>WorkingDirectory</key>
//   <string>${opts.workingDir}</string>
//   <key>RunAtLoad</key>
//   <true/>
//   <key>KeepAlive</key>
//   <true/>
//   <key>StandardOutPath</key>
//   <string>${opts.stdoutPath}</string>
//   <key>StandardErrorPath</key>
//   <string>${opts.stderrPath}</string>
// </dict>
// </plist>
// `
// }

async function cmdSetupService(options: { uninstall?: boolean } = {}): Promise<void> {
  const { execSync } = await import('child_process')
  const { existsSync, unlinkSync } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')

  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
  const uid = execSync('id -u', { encoding: 'utf-8' }).trim()

  // Always clean up any existing LaunchAgent
  if (options.uninstall || existsSync(plistPath)) {
    console.log('[..] Removing LaunchAgent...')
    try { execSync(`launchctl bootout gui/${uid} ${plistPath}`, { stdio: 'pipe' }) } catch { /* may not be loaded */ }
    if (existsSync(plistPath)) {
      unlinkSync(plistPath)
      console.log('[OK] Removed plist and stopped service')
    } else {
      console.log('[OK] No LaunchAgent found')
    }
    if (options.uninstall) return
  }

  // --- LaunchAgent install path commented out — run manually for now ---
  // const { writeFileSync, mkdirSync } = await import('fs')
  // const { resolve, dirname } = await import('path')
  // const launchAgentsDir = join(homedir(), 'Library', 'LaunchAgents')
  //
  // const { getSettings } = await import('../src/core/settings')
  // const settings = getSettings()
  // if (!settings.service.enabled) {
  //   console.error('[SKIP] Service management is disabled in settings.')
  //   console.error('  Enable with: bakin settings set service.enabled true')
  //   return
  // }
  //
  // const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
  // console.log(`[..] Detecting paths for ${projectDir}`)
  //
  // let nodePath: string
  // try {
  //   nodePath = execSync('which node', { encoding: 'utf-8' }).trim()
  // } catch {
  //   console.error('[FAIL] Could not find node binary. Is Node.js installed?')
  //   process.exit(1)
  // }
  //
  // const tsxPath = join(projectDir, 'node_modules', '.bin', 'tsx')
  // if (!existsSync(tsxPath)) {
  //   console.error('[FAIL] tsx not found at node_modules/.bin/tsx — run: npm install')
  //   process.exit(1)
  // }
  //
  // const serverPath = join(projectDir, 'server.ts')
  // if (!existsSync(serverPath)) {
  //   console.error('[FAIL] server.ts not found — are you in the bakin project directory?')
  //   process.exit(1)
  // }
  //
  // console.log(`  node:    ${nodePath}`)
  // console.log(`  tsx:     ${tsxPath}`)
  // console.log(`  server:  ${serverPath}`)
  // console.log(`  workdir: ${projectDir}`)
  //
  // try { execSync(`launchctl bootout gui/${uid} ${plistPath}`, { stdio: 'pipe' }) } catch { /* ignore */ }
  //
  // if (!existsSync(launchAgentsDir)) {
  //   mkdirSync(launchAgentsDir, { recursive: true })
  // }
  //
  // const plist = generatePlist({
  //   nodePath,
  //   tsxPath,
  //   serverPath,
  //   workingDir: projectDir,
  //   stdoutPath: join(projectDir, 'mc-server.log'),
  //   stderrPath: join(projectDir, 'mc-server-error.log'),
  // })
  //
  // writeFileSync(plistPath, plist, 'utf-8')
  // console.log(`[OK] Wrote ${plistPath}`)
  //
  // console.log('[..] Loading service...')
  // try {
  //   execSync(`launchctl bootstrap gui/${uid} ${plistPath}`, { stdio: 'pipe' })
  //   console.log('[OK] Service loaded')
  // } catch (err) {
  //   try {
  //     execSync(`launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}`, { stdio: 'pipe' })
  //     console.log('[OK] Service restarted')
  //   } catch {
  //     console.error('[FAIL] Could not load service:', err instanceof Error ? err.message : String(err))
  //     console.error(`  Try manually: launchctl bootstrap gui/${uid} ${plistPath}`)
  //     process.exit(1)
  //   }
  // }
  //
  // try {
  //   execSync(`launchctl list ${SERVICE_LABEL}`, { encoding: 'utf-8', stdio: 'pipe' })
  //   console.log('[OK] Service is running')
  // } catch {
  //   console.log('[WARN] Service loaded but may not be running yet — check: bakin status')
  // }
  //
  // console.log('')
  // console.log('Bakin service installed. It will auto-start on login.')
  // console.log('  Status:    bakin status')
  // console.log('  Uninstall: bakin setup service --uninstall')

  console.log('')
  console.log('LaunchAgent auto-start is disabled. Run Bakin manually:')
  console.log('  cd /Users/dev/go/src/github.com/markhayden/bakin && npx tsx server.ts')
  console.log('')
  console.log('Or use: bakin reboot')
}

async function cmdReboot(): Promise<void> {
  const { execSync } = await import('child_process')
  const { join, resolve, dirname } = await import('path')

  // --- launchctl restart path commented out — manual process management only ---
  // const { existsSync } = await import('fs')
  // const { homedir } = await import('os')
  // const uid = execSync('id -u', { encoding: 'utf-8' }).trim()
  // const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)
  // const isService = existsSync(plistPath)
  //
  // if (isService) {
  //   console.log('[..] Restarting Bakin via launchctl...')
  //   try {
  //     execSync(`launchctl kickstart -k gui/${uid}/${SERVICE_LABEL}`, { stdio: 'pipe' })
  //     console.log('[OK] Bakin restarting')
  //   } catch {
  //     console.log('[..] Kickstart failed, trying bootout + bootstrap...')
  //     try { execSync(`launchctl bootout gui/${uid} ${plistPath}`, { stdio: 'pipe' }) } catch { /* ok */ }
  //     await new Promise(r => setTimeout(r, 1000))
  //     try {
  //       execSync(`launchctl bootstrap gui/${uid} ${plistPath}`, { stdio: 'pipe' })
  //       console.log('[OK] Bakin restarting')
  //     } catch (err) {
  //       console.error('[FAIL] Could not restart:', err instanceof Error ? err.message : String(err))
  //       process.exit(1)
  //     }
  //   }
  // } else {

  // Kill any running Bakin server processes
  console.log('[..] Stopping Bakin server...')
  try {
    const pids = execSync("pgrep -f 'tsx.*server\\.ts'", { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
        }
      }
      console.log('[OK] Sent SIGTERM to Bakin server')
      console.log('[..] Waiting for shutdown...')
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch {
    console.log('[..] No running Bakin process found')
  }

  // Start the server in background
  const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const serverPath = join(projectDir, 'server.ts')
  const logPath = join(projectDir, 'mc-server.log')

  console.log('[..] Starting Bakin server...')
  const { spawn } = await import('child_process')
  const child = spawn('npx', ['tsx', serverPath], {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  })
  child.unref()
  console.log(`[OK] Bakin starting (pid ${child.pid})`)
  console.log(`  Logs: tail -f ${logPath}`)

  // } // end of else branch for non-service path

  // Wait and verify
  console.log('[..] Waiting for server to come up...')
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const res = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { version: string }
        console.log(`[OK] Bakin is up (${data.version})`)
        return
      }
    } catch { /* not ready yet */ }
  }
  console.log('[WARN] Server not responding after 15s — check logs')
}

async function cmdReindex(options: { table?: string; rebuild?: boolean } = {}): Promise<void> {
  let url = '/api/reindex'
  const params: string[] = []
  if (options.table) params.push(`table=${encodeURIComponent(options.table)}`)
  if (options.rebuild) params.push('rebuild=true')
  if (params.length) url += `?${params.join('&')}`

  console.log(`Reindexing ${options.table || 'all content'} to Antfly${options.rebuild ? ' (rebuild indexes)' : ''}...`)
  const result = await apiPost(url) as {
    ok: boolean
    total: number
    errors: number
    enrichmentErrors?: number
    tables: Array<{
      table: string
      indexed: number
      error?: string
      enrichment?: { healthy: boolean; indexes: Array<{ name: string; error?: string; walBacklog: number }> }
    }>
  }
  if (result.tables?.length) {
    for (const t of result.tables) {
      if (t.error) {
        console.log(`  ${t.table}: ERROR — ${t.error}`)
      } else {
        const enrichTag = t.enrichment
          ? t.enrichment.healthy ? '' : ' [enrichment unhealthy]'
          : ''
        console.log(`  ${t.table}: ${t.indexed} documents${enrichTag}`)
      }
    }
  }
  console.log(`Done. ${result.total} total documents indexed.`)
  if ((result.enrichmentErrors ?? 0) > 0) {
    console.log(`WARNING: ${result.enrichmentErrors} table(s) have enrichment errors — check health page for details.`)
  }
}

// ---------------------------------------------------------------------------
// Start / Setup mcporter
// ---------------------------------------------------------------------------

async function cmdStart(): Promise<void> {
  const { resolve, dirname, join } = await import('path')
  const { execSync, spawn } = await import('child_process')

  const projectDir = resolve(dirname(new URL(import.meta.url).pathname), '..')
  const port = Number(process.env.PORT || 3737)

  // Step 1: Setup mcporter
  console.log('[..] Checking mcporter...')
  const mcporter = await import('../src/core/mcporter')

  if (!mcporter.isMcporterInstalled()) {
    console.log('[..] Installing mcporter...')
    if (!mcporter.installMcporter()) {
      console.error('[FAIL] Could not install mcporter. Run manually: npm i -g mcporter')
      process.exit(1)
    }
    console.log('[OK] mcporter installed')
  } else {
    console.log('[OK] mcporter available')
  }

  // Step 2: Sync mcporter config
  console.log('[..] Syncing mcporter config...')
  const changes = mcporter.syncConfig(port)
  if (changes.length > 0) {
    for (const c of changes) console.log(`  ${c}`)
    console.log(`[OK] mcporter config updated (${changes.length} changes)`)
  } else {
    console.log('[OK] mcporter config up to date')
  }

  // Step 3: Kill any existing Bakin server
  console.log('[..] Checking for running Bakin...')
  try {
    const pids = execSync("pgrep -f 'tsx.*server\\.ts'", { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
        }
      }
      console.log('[OK] Stopped existing Bakin server')
      await new Promise(r => setTimeout(r, 2000))
    }
  } catch {
    // No running process
  }

  // Step 4: Start the server
  const serverPath = join(projectDir, 'server.ts')
  console.log('[..] Starting Bakin server...')
  const child = spawn('npx', ['tsx', serverPath], {
    cwd: projectDir,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env },
  })
  child.unref()
  console.log(`[OK] Bakin starting (pid ${child.pid})`)

  // Step 5: Wait for server to come up
  console.log('[..] Waiting for server...')
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 1000))
    try {
      const res = await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(2000) })
      if (res.ok) {
        const data = await res.json() as { version: string }
        console.log(`[OK] Bakin is up (${data.version})`)
        console.log('')
        console.log('MCP endpoints:')
        const settings = await (await fetch(`${BASE_URL}/api/settings`)).json() as { agents?: string[] }
        const agents = (settings as Record<string, unknown>).agents as string[] || []
        for (const agent of agents as string[]) {
          console.log(`  ${agent}: mcporter call bakin-${agent}.<tool> ...`)
        }
        console.log('')
        console.log(`Stats: curl ${BASE_URL}/mcp/stats`)
        console.log(`Audit: tail -f ~/.bakin/audit.jsonl | jq '{event,agent,channel}'`)
        return
      }
    } catch { /* not ready yet */ }
  }
  console.log('[WARN] Server not responding after 15s — check logs')
}

async function cmdLogs(filter?: string): Promise<void> {
  const { spawn, execSync } = await import('child_process')
  const { join } = await import('path')
  const { existsSync } = await import('fs')
  const auditPath = join(process.env.HOME || '~', '.bakin', 'audit.jsonl')

  if (!existsSync(auditPath)) {
    console.error(`Audit log not found: ${auditPath}`)
    console.error('Is Bakin initialized? Run: bakin init')
    process.exit(1)
  }

  // Build jq filter
  let jqFilter = '{ts,event,agent,channel,data}'
  if (filter === 'mcp') jqFilter = 'select(.channel=="mcp") | {ts,event,agent,data}'
  else if (filter === 'rest') jqFilter = 'select(.channel=="rest") | {ts,event,agent,data}'
  else if (filter) jqFilter = `select(.agent=="${filter}" or .channel=="${filter}") | {ts,event,agent,channel,data}`

  // Show last 20 entries first so there's immediate output
  console.log(`Tailing ${auditPath} (filter: ${filter || 'all'})`)
  console.log('--- recent entries ---')
  try {
    execSync(`tail -20 "${auditPath}" | jq '${jqFilter}'`, { stdio: ['ignore', 'inherit', 'ignore'] })
  } catch { /* filter may exclude all 20 lines — that's fine */ }
  console.log('--- live tail (Ctrl-C to stop) ---\n')

  // Now tail -f for new entries (start from end, 0 lines of history to avoid dupes)
  const child = spawn('tail', ['-f', '-n', '0', auditPath], { stdio: ['ignore', 'pipe', 'inherit'] })
  const jq = spawn('jq', ['--unbuffered', jqFilter], { stdio: ['pipe', 'inherit', 'inherit'] })

  child.stdout.pipe(jq.stdin)

  // Clean up on exit
  process.on('SIGINT', () => {
    child.kill()
    jq.kill()
    process.exit(0)
  })

  await new Promise(() => {}) // block until killed
}

async function cmdStop(): Promise<void> {
  const { execSync } = await import('child_process')

  console.log('[..] Stopping Bakin server...')
  try {
    const pids = execSync("pgrep -f 'tsx.*server\\.ts'", { encoding: 'utf-8' }).trim()
    if (pids) {
      for (const pid of pids.split('\n')) {
        if (pid && pid !== String(process.pid)) {
          process.kill(Number(pid), 'SIGTERM')
        }
      }
      console.log('[OK] Sent SIGTERM to Bakin server')

      // Wait and verify it's actually down
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500))
        try {
          await fetch(`${BASE_URL}/api/version`, { signal: AbortSignal.timeout(1000) })
        } catch {
          console.log('[OK] Bakin stopped')
          return
        }
      }
      console.log('[WARN] Server may still be shutting down')
    } else {
      console.log('[OK] No running Bakin process found')
    }
  } catch {
    console.log('[OK] No running Bakin process found')
  }
}

async function cmdSetupMcporter(): Promise<void> {
  const port = Number(process.env.PORT || 3737)
  const mcporter = await import('../src/core/mcporter')

  console.log('[..] Checking mcporter installation...')
  if (!mcporter.isMcporterInstalled()) {
    console.log('[..] Installing mcporter...')
    if (!mcporter.installMcporter()) {
      console.error('[FAIL] Could not install mcporter. Run manually: npm i -g mcporter')
      process.exit(1)
    }
    console.log('[OK] mcporter installed')
  } else {
    console.log('[OK] mcporter already installed')
  }

  console.log('[..] Syncing mcporter config...')
  const changes = mcporter.syncConfig(port)
  if (changes.length > 0) {
    for (const c of changes) console.log(`  ${c}`)
    console.log(`[OK] Config updated`)
  } else {
    console.log('[OK] Config already up to date')
  }

  // Verify
  const status = mcporter.verifyConfig(port)
  console.log('')
  console.log('Agent MCP entries:')
  for (const entry of status.agentEntries) {
    console.log(`  ${entry.correct ? '[OK]' : '[!!]'} ${entry.name} → ${entry.url}`)
  }
  if (status.staleEntries.length > 0) {
    console.log(`\nStale entries removed: ${status.staleEntries.join(', ')}`)
  }

  console.log('')
  console.log('Test with:')
  console.log('  mcporter call bakin-pixel.bakin_get_paths --allow-http')
}

// ---------------------------------------------------------------------------
// CLI router
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// New commands for MCP tool parity
// ---------------------------------------------------------------------------

async function cmdTasksLog(id: string, message: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: CLI_AGENT, message })
  print(result)
}

async function cmdTasksBlock(id: string, reason: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/block`, { id, reason, agent: CLI_AGENT })
  print(result)
}

async function cmdTasksDepend(id: string, dependsOn: string): Promise<void> {
  const result = await apiPost(`/api/plugins/tasks/${id}/dependency`, { id, dependsOn })
  print(result)
}

async function cmdTasksComplete(id: string, summary: string): Promise<void> {
  // Log the summary, then move to done
  await apiPost(`/api/plugins/tasks/${id}/log`, { id, author: CLI_AGENT, message: `Task complete: ${summary}` })
  const result = await apiPost(`/api/plugins/tasks/${id}/move`, { id, to: 'done', agent: CLI_AGENT })
  print(result)
}

async function cmdTasksGet(id: string): Promise<void> {
  const result = await apiGet('/api/plugins/tasks/') as { columns: Record<string, Array<Record<string, unknown>>> }
  const columns = result.columns || {}
  for (const [colName, tasks] of Object.entries(columns)) {
    const task = (tasks as Array<Record<string, unknown>>).find(t => t.id === id)
    if (task) {
      console.log(`Column: ${colName}`)
      print(task)
      return
    }
  }
  console.error(`Task ${id} not found`)
  process.exit(1)
}

async function cmdWorkflowsList(): Promise<void> {
  const result = await apiGet('/api/plugins/workflows/definitions') as { templates?: Array<Record<string, unknown>> }
  const templates = result?.templates || []
  if (templates.length === 0) {
    console.log('No workflow definitions found.')
    return
  }
  printTable(templates, ['filename', 'name', 'description', 'stepCount'])
}

async function cmdWorkflowsStart(taskId: string, workflowId: string): Promise<void> {
  const result = await apiPost('/api/plugins/workflows/instances/start', { taskId, workflowId })
  print(result)
}

async function cmdWorkflowsStep(taskId: string): Promise<void> {
  const result = await apiGet(`/api/plugins/workflows/steps/${encodeURIComponent(taskId)}`)
  print(result)
}

async function cmdWorkflowsSubmit(taskId: string, stepId: string, outputJson: string): Promise<void> {
  let output: Record<string, unknown>
  try {
    output = JSON.parse(outputJson)
  } catch {
    console.error('Invalid JSON for output. Usage: bakin workflows submit <taskId> <stepId> \'{"key":"value"}\'')
    process.exit(1)
  }
  const result = await apiPost(`/api/plugins/workflows/steps/${encodeURIComponent(taskId)}/complete`, { stepId, agentId: CLI_AGENT, output })
  print(result)
}

// ---------------------------------------------------------------------------
// Trash commands
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function daysUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now()
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'expiring'
  return `${days}d`
}

async function cmdTrashList(): Promise<void> {
  const data = await apiGet('/api/plugins/assets/trash') as { assets: Array<{ filename: string; originalFilename: string; type: string; size: number; deletedAt: string; expiresAt: string; metadata: { agent?: string } | null }>; count: number }
  if (data.count === 0) {
    console.log('Trash is empty.')
    return
  }
  console.log(`${data.count} item${data.count !== 1 ? 's' : ''} in trash:\n`)
  const rows = data.assets.map(a => ({
    filename: a.originalFilename,
    type: a.type,
    size: formatBytes(a.size),
    deleted: new Date(a.deletedAt).toLocaleString(),
    expires: daysUntil(a.expiresAt),
    agent: a.metadata?.agent ?? 'unknown',
    trashName: a.filename,
  }))
  printTable(rows, ['filename', 'type', 'size', 'deleted', 'expires', 'agent'])
  console.log(`\nTo restore: bakin trash restore <trashName>`)
  console.log('Use the full trash filename (with __deleted- suffix) from the list above.')
}

async function cmdTrashRestore(filename: string): Promise<void> {
  const data = await apiPost(`/api/plugins/assets/trash/${encodeURIComponent(filename)}/restore`) as { ok: boolean; restoredPath: string }
  console.log(`Restored → ${data.restoredPath}`)
}

async function cmdTrashEmpty(): Promise<void> {
  const check = await apiGet('/api/plugins/assets/trash') as { count: number }
  if (check.count === 0) {
    console.log('Trash is already empty.')
    return
  }
  const data = await apiDelete('/api/plugins/assets/trash') as { ok: boolean; deleted: number }
  console.log(`Permanently deleted ${data.deleted} item${data.deleted !== 1 ? 's' : ''}.`)
}

// ---------------------------------------------------------------------------
// Messaging commands
// ---------------------------------------------------------------------------

function parseFlag(args: string[], flag: string): string | undefined {
  const f = args.find(a => a.startsWith(`--${flag}=`))
  return f ? f.split('=').slice(1).join('=') : undefined
}

async function cmdMessagingList(opts: { month?: string; status?: string; agent?: string; channel?: string }): Promise<void> {
  const params = new URLSearchParams()
  if (opts.month) params.set('month', opts.month)
  if (opts.status) params.set('status', opts.status)
  if (opts.agent) params.set('agent', opts.agent)
  if (opts.channel) params.set('channel', opts.channel)
  const qs = params.toString()
  const result = await apiGet(`/api/plugins/messaging/${qs ? `?${qs}` : ''}`) as { items: Array<Record<string, unknown>> }
  printTable(result.items, ['id', 'title', 'agent', 'status', 'scheduledAt', 'contentType'])
}

async function cmdMessagingGet(id: string): Promise<void> {
  const result = await apiGet(`/api/plugins/messaging/${id}`)
  print(result)
}

async function cmdMessagingCreate(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('--'))
  const title = positional[0]
  const agent = positional[1] || 'chef'
  const scheduledAt = positional[2] || new Date().toISOString()
  if (!title) { console.error('Usage: bakin messaging create <title> [agent] [scheduledAt] [--channels=dc,ig] [--type=recipe] [--tone=calm]'); process.exit(1) }
  const channelsStr = parseFlag(args, 'channels')
  const body: Record<string, unknown> = {
    title,
    agent,
    scheduledAt,
    contentType: parseFlag(args, 'type') || 'tip',
    tone: parseFlag(args, 'tone') || 'conversational',
    brief: parseFlag(args, 'brief') || '',
  }
  if (channelsStr) body.channels = channelsStr.split(',')
  const result = await apiPost('/api/plugins/messaging/', body)
  print(result)
}

async function cmdMessagingUpdate(id: string, args: string[]): Promise<void> {
  const body: Record<string, unknown> = {}
  const title = parseFlag(args, 'title')
  const status = parseFlag(args, 'status')
  const scheduledAt = parseFlag(args, 'scheduledAt')
  const brief = parseFlag(args, 'brief')
  const tone = parseFlag(args, 'tone')
  if (title) body.title = title
  if (status) body.status = status
  if (scheduledAt) body.scheduledAt = scheduledAt
  if (brief) body.brief = brief
  if (tone) body.tone = tone
  const result = await api(`/api/plugins/messaging/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  print(result)
}

async function cmdMessagingDelete(id: string): Promise<void> {
  const result = await apiDelete(`/api/plugins/messaging/${id}`)
  print(result)
}

async function cmdMessagingApprove(id: string): Promise<void> {
  const result = await apiPost(`/api/plugins/messaging/${id}/approve`)
  print(result)
}

async function cmdMessagingReject(id: string, note?: string): Promise<void> {
  const result = await apiPost(`/api/plugins/messaging/${id}/reject`, note ? { note } : undefined)
  print(result)
}

// Session commands
async function cmdSessionList(opts: { status?: string; agent?: string }): Promise<void> {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.agent) params.set('agentId', opts.agent)
  const qs = params.toString()
  const result = await apiGet(`/api/plugins/messaging/sessions${qs ? `?${qs}` : ''}`) as { sessions: Array<Record<string, unknown>> }
  printTable(result.sessions, ['id', 'agentId', 'title', 'status', 'proposalCount', 'approvedCount', 'updatedAt'])
}

async function cmdSessionGet(id: string): Promise<void> {
  const result = await apiGet(`/api/plugins/messaging/sessions/${id}`)
  print(result)
}

async function cmdSessionCreate(agentId: string, title?: string): Promise<void> {
  const body: Record<string, string> = { agentId }
  if (title) body.title = title
  const result = await apiPost('/api/plugins/messaging/sessions', body)
  print(result)
}

async function cmdSessionUpdate(id: string, args: string[]): Promise<void> {
  const body: Record<string, unknown> = {}
  const title = parseFlag(args, 'title')
  if (title) body.title = title
  const result = await api(`/api/plugins/messaging/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  print(result)
}

async function cmdSessionDelete(id: string): Promise<void> {
  const result = await apiDelete(`/api/plugins/messaging/sessions/${id}`)
  print(result)
}

async function cmdSessionMessage(id: string, message: string): Promise<void> {
  const result = await apiPost(`/api/plugins/messaging/sessions/${id}/messages`, { message })
  // This returns an SSE stream; for CLI we just print what we get
  print(result)
}

async function cmdSessionConfirm(id: string): Promise<void> {
  const result = await apiPost(`/api/plugins/messaging/sessions/${id}/confirm`)
  print(result)
}

async function cmdProposalUpdate(sessionId: string, proposalId: string, args: string[]): Promise<void> {
  const body: Record<string, unknown> = {}
  const status = parseFlag(args, 'status')
  const title = parseFlag(args, 'title')
  const note = parseFlag(args, 'note')
  if (status) body.status = status
  if (title) body.title = title
  if (note) body.rejectionNote = note
  // Convenience flags
  if (args.includes('--approve')) body.status = 'approved'
  if (args.includes('--reject')) body.status = 'rejected'
  const result = await api(`/api/plugins/messaging/sessions/${sessionId}/proposals/${proposalId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  print(result)
}

const USAGE = `
Usage: bakin <command> [options]

Commands:
  status                           System health, agents, dispatch timer
  dispatch                         Trigger immediate task dispatch
  tasks list [--column=X]          List tasks (optionally filter by column)
  tasks get <id>                   Get task details
  tasks create <title> [agent]     Create a task (--workflow=<id> or --no-workflow="reason")
  tasks move <id> <column>         Move task to column
  tasks log <id> <message>         Log a progress update
  tasks block <id> <reason>        Block a task with reason
  tasks depend <id> <dependsOn>    Register a task dependency
  tasks complete <id> <summary>    Mark task done with summary
  workflows list                    List available workflow definitions
  workflows start <taskId> <wfId>  Start a workflow for a task
  workflows step <taskId>          Get current workflow step details
  workflows submit <t> <s> <json>  Submit workflow step output
  agents list                      List all agents with status
  agents status <id>               Get detailed agent status
  agents tasks <id>                List tasks assigned to agent
  agents send <id> <message>       Send message to agent
  settings get [key]               Read settings (dot notation for nested)
  settings set <key> <value>       Update a setting
  plugins list                     List installed plugins
  plugins install <path|repo>      Install plugin (local path or github:user/repo)
  plugins remove <id>              Remove an installed plugin
  start                             Start Bakin (setup mcporter + launch server)
  stop                              Stop Bakin server
  logs [filter]                     Tail audit log (filter: mcp, rest, or agent name)
  setup service [--uninstall]       Install/remove macOS LaunchAgent for auto-start
  setup antfly                     Install AntflyDB + enable + reindex (one command)
  setup mcporter                   Install mcporter + sync per-agent MCP config
  paths [key]                      Show content directory paths (keys: home, assets, projects, etc.)
  init                             Initialize ~/.bakin/ directory with defaults
  mkdir                            Create/verify ~/.bakin/ directory tree (replaces init)
  settings init                    Seed ~/.bakin/settings.json with defaults if missing
  check openclaw                   Detect OpenClaw binary + config
  check llm                        Verify at least one LLM provider configured
  check channels                   Verify at least one messaging channel configured
  check all                        Run all onboarding checks, report each
  install antfly                   Install AntflyDB via Homebrew
  install models                   Download Termite ML models (BGE, CLIP, mxbai-rerank)
  install mcporter                 Install mcporter + sync per-agent MCP config
  onboard                          Run full first-run onboarding (all checks + installs)
    --check                          Check-only mode (no installs, exit 0/1/2)
    --yes                            Auto-approve all prompts (for CI/scripts)
    --json                           Emit one JSON line per component to stdout
    --force                          Delete .onboarded marker and replay from scratch
  agent-rules [--apply|--check]    Manage orchestrator rules block in AGENTS.md
  agent-rules --apply-all          Apply all managed blocks to all agent AGENTS.md files
  agent-rules --check-all          Check all managed blocks across all agents
  doctor                           Run health checks (agent sync, skill, gateway, etc.)
  reboot                           Restart Bakin server (works with launchctl or standalone)
  reindex                          Reindex all content to Antfly
  docs                             Print API documentation
  schedule [list]                    List scheduled jobs
  schedule add <name> <sched>       Create a scheduled job (--agent, --prompt)
  schedule pause <jobId>            Pause a job (--until <date>, --skip <n>)
  schedule resume <jobId>           Resume a paused job
  schedule remove <jobId>           Delete a scheduled job
  schedule run <jobId>              Trigger immediate job run
  schedule runs <jobId>             View run history for a job
  trash [list]                       List trashed assets (7-day soft-delete window)
  trash restore <filename>           Restore a trashed asset to its original location
  trash empty                        Permanently delete all items in trash
  messaging list [options]            List messaging items (--month, --status, --agent, --channel)
  messaging get <id>                  Get messaging item details
  messaging create <title> [agent]    Create item (--channels, --type, --tone, --brief)
  messaging update <id> [flags]       Update item (--title, --status, --scheduledAt, --brief, --tone)
  messaging delete <id>               Delete a messaging item
  messaging approve <id>              Approve/schedule a messaging item
  messaging reject <id> [note]        Reject a messaging item
  messaging sessions [options]        List planning sessions (--status, --agent)
  messaging session <id>              Get session details
  messaging session-create <agent>    Create session (optional title as 2nd arg)
  messaging session-update <id>       Update session (--title)
  messaging session-delete <id>       Delete a planning session
  messaging message <id> <text>       Send message to session
  messaging confirm <id>              Confirm plan (creates messaging items from approved proposals)
  messaging proposal <sid> <pid>      Update proposal (--approve, --reject, --status, --title, --note)
  search <query> [options]          Search across indexed content
    --table=<name>                   Filter by table (tasks, decisions, audit, content, assets)
    --agent=<name>                   Filter by agent (e.g. patch, pixel, rolo)
    --limit=<n>                      Max results (default: 10)

Environment:
  BAKIN_URL    Base URL (default: http://localhost:3737)
`

// ---------------------------------------------------------------------------
// Onboarding CLI handlers
// ---------------------------------------------------------------------------

function statusIcon(status: string): string {
  switch (status) {
    case 'ok': return '[OK]'
    case 'warn': return '[WARN]'
    case 'error': return '[FAIL]'
    case 'missing': return '[MISS]'
    case 'broken': return '[FAIL]'
    case 'skipped': return '[SKIP]'
    default: return `[${status.toUpperCase()}]`
  }
}

async function cmdOnboardingMkdir(): Promise<void> {
  const { mkdirComponent } = await import('../src/core/onboarding/mkdir')
  const opts = {
    interactive: Boolean(process.stdout.isTTY),
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }
  const result = await mkdirComponent.install(opts)
  console.log(`${statusIcon(result.status)} ${result.message}`)
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingSettingsInit(): Promise<void> {
  const { settingsComponent } = await import('../src/core/onboarding/settings')
  const opts = {
    interactive: Boolean(process.stdout.isTTY),
    autoApprove: true,
    json: false,
    checkOnly: false,
    force: false,
  }
  const result = await settingsComponent.install(opts)
  console.log(`${statusIcon(result.status)} ${result.message}`)
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboardingCheckSingle(target: 'openclaw' | 'llm' | 'channels'): Promise<void> {
  const componentMap: Record<string, () => Promise<{ check(): Promise<import('../src/core/onboarding/types').CheckResult> }>> = {
    openclaw: async () => (await import('../src/core/onboarding/openclaw')).openclawComponent,
    llm: async () => (await import('../src/core/onboarding/credentials')).llmComponent,
    channels: async () => (await import('../src/core/onboarding/credentials')).channelsComponent,
  }
  const component = await componentMap[target]()
  const result = await component.check()
  console.log(`${statusIcon(result.status)} ${result.message}`)
  if (result.remediation) console.log(`  → ${result.remediation}`)
  if (result.status === 'missing' || result.status === 'error' || result.status === 'broken') process.exit(1)
  if (result.status === 'warn') process.exit(2)
}

async function cmdOnboardingCheckAll(): Promise<void> {
  const { checkAll } = await import('../src/core/onboarding/index')
  const results = await checkAll()
  for (const r of results) {
    console.log(`${statusIcon(r.status)} ${r.name.padEnd(10)} ${r.message}`)
    if (r.remediation) console.log(`  → ${r.remediation}`)
  }
  const hasError = results.some(r => r.status === 'error' || r.status === 'missing' || r.status === 'broken')
  const hasWarn = results.some(r => r.status === 'warn')
  process.exit(hasError ? 1 : hasWarn ? 2 : 0)
}

async function cmdOnboardingInstallSingle(target: string, args: string[]): Promise<void> {
  const componentMap: Record<string, () => Promise<import('../src/core/onboarding/types').OnboardingComponent>> = {
    antfly: async () => (await import('../src/core/onboarding/antfly')).antflyComponent,
    models: async () => (await import('../src/core/onboarding/models')).modelsComponent,
    mcporter: async () => (await import('../src/core/onboarding/mcporter')).mcporterComponent,
  }
  const component = await componentMap[target]()
  const isTTY = Boolean(process.stdout.isTTY)
  const autoApprove = args.includes('--yes')
  const json = args.includes('--json')
  const opts = {
    interactive: isTTY && !json,
    autoApprove: autoApprove || (!isTTY && !json),
    json,
    checkOnly: false,
    force: false,
  }
  const result = await component.install(opts)
  if (json) {
    console.log(JSON.stringify({ component: component.name, status: result.status, message: result.message, durationMs: result.durationMs }))
  } else {
    console.log(`${statusIcon(result.status)} ${result.message}`)
  }
  if (result.status === 'failed') process.exit(1)
}

async function cmdOnboard(args: string[]): Promise<void> {
  const { runOnboard, isOnboarded, loadState } = await import('../src/core/onboarding/index')
  const checkOnly = args.includes('--check')
  const yes = args.includes('--yes')
  const json = args.includes('--json')
  const force = args.includes('--force')
  const isTTY = Boolean(process.stdout.isTTY)

  // Early exit for already-onboarded machines unless --force or --check
  if (!force && !checkOnly && isOnboarded()) {
    const state = loadState()
    if (!json) {
      console.log(`[OK] Already onboarded on ${state?.completedAt?.slice(0, 10) ?? 'unknown date'}.`)
      console.log('     Re-run with --force to replay the full flow.')
    } else {
      console.log(JSON.stringify({ status: 'already_onboarded', completedAt: state?.completedAt }))
    }
    process.exit(0)
  }

  const opts = {
    interactive: isTTY && !json && !checkOnly,
    autoApprove: yes || (!isTTY && !json),
    json,
    checkOnly,
    force,
  }

  const result = await runOnboard(opts)

  if (!json) {
    console.log('')
    for (const o of result.outcomes) {
      console.log(`${statusIcon(o.finalStatus)} ${o.name.padEnd(10)} ${o.message}`)
      if (o.remediation && o.finalStatus !== 'ok') {
        console.log(`  → ${o.remediation}`)
      }
    }
    console.log('')
    if (result.exitCode === 0) {
      console.log('Onboarding complete. Run `pnpm dev` to start Bakin.')
    } else if (result.exitCode === 2) {
      console.log('Onboarding finished with warnings. Bakin will start but some features may be limited.')
      console.log('Run `pnpm dev` to start Bakin.')
    } else {
      console.log('Onboarding failed. Fix the errors above and rerun `bakin onboard`.')
    }
  }

  process.exit(result.exitCode)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE.trim())
    process.exit(0)
  }

  const cmd = args[0]
  const sub = args[1]

  try {
    switch (cmd) {
      case 'status':
        await cmdStatus()
        break

      case 'dispatch':
        await cmdDispatch()
        break

      case 'tasks':
        if (sub === 'list') {
          const colFlag = args.find(a => a.startsWith('--column='))
          await cmdTasksList(colFlag?.split('=')[1])
        } else if (sub === 'get') {
          if (!args[2]) { console.error('Usage: bakin tasks get <id>'); process.exit(1) }
          await cmdTasksGet(args[2])
        } else if (sub === 'create') {
          if (!args[2]) { console.error('Usage: bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow="<reason>"]'); process.exit(1) }
          // Parse flags from remaining args
          const createArgs = args.slice(2)
          const wfFlag = createArgs.find(a => a.startsWith('--workflow='))
          const noWfFlag = createArgs.find(a => a.startsWith('--no-workflow='))
          const positional = createArgs.filter(a => !a.startsWith('--'))
          const createTitle = positional[0]
          const createAssignee = positional[1]
          const createWorkflowId = wfFlag?.split('=').slice(1).join('=')
          const createSkipReason = noWfFlag?.split('=').slice(1).join('=')
          if (!createTitle) { console.error('Usage: bakin tasks create <title> [agent] [--workflow=<id>] [--no-workflow="<reason>"]'); process.exit(1) }
          await cmdTasksCreate(createTitle, createAssignee, createWorkflowId, createSkipReason)
        } else if (sub === 'move') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks move <id> <column>'); process.exit(1) }
          await cmdTasksMove(args[2], args[3])
        } else if (sub === 'log') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks log <id> <message>'); process.exit(1) }
          await cmdTasksLog(args[2], args.slice(3).join(' '))
        } else if (sub === 'block') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks block <id> <reason>'); process.exit(1) }
          await cmdTasksBlock(args[2], args.slice(3).join(' '))
        } else if (sub === 'depend') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks depend <id> <dependsOn>'); process.exit(1) }
          await cmdTasksDepend(args[2], args[3])
        } else if (sub === 'complete') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin tasks complete <id> <summary>'); process.exit(1) }
          await cmdTasksComplete(args[2], args.slice(3).join(' '))
        } else {
          console.error(`Unknown tasks subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'workflows':
        if (sub === 'list') {
          await cmdWorkflowsList()
        } else if (sub === 'start') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin workflows start <taskId> <workflowId>'); process.exit(1) }
          await cmdWorkflowsStart(args[2], args[3])
        } else if (sub === 'step') {
          if (!args[2]) { console.error('Usage: bakin workflows step <taskId>'); process.exit(1) }
          await cmdWorkflowsStep(args[2])
        } else if (sub === 'submit') {
          if (!args[2] || !args[3] || !args[4]) { console.error('Usage: bakin workflows submit <taskId> <stepId> \'<json>\''); process.exit(1) }
          await cmdWorkflowsSubmit(args[2], args[3], args[4])
        } else {
          console.error(`Unknown workflows subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'agents':
        if (sub === 'list') {
          await cmdAgentsList()
        } else if (sub === 'status') {
          if (!args[2]) { console.error('Usage: bakin agents status <id>'); process.exit(1) }
          await cmdAgentsStatus(args[2])
        } else if (sub === 'tasks') {
          if (!args[2]) { console.error('Usage: bakin agents tasks <id>'); process.exit(1) }
          await cmdAgentsTasks(args[2])
        } else if (sub === 'send') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin agents send <id> <message>'); process.exit(1) }
          await cmdAgentsSend(args[2], args.slice(3).join(' '))
        } else {
          console.error(`Unknown agents subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'settings':
        if (sub === 'get') {
          await cmdSettingsGet(args[2])
        } else if (sub === 'set') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin settings set <key> <value>'); process.exit(1) }
          await cmdSettingsSet(args[2], args[3])
        } else if (sub === 'init') {
          await cmdOnboardingSettingsInit()
        } else {
          console.error(`Unknown settings subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'plugins':
        if (sub === 'list') {
          await cmdPluginsList()
        } else if (sub === 'install') {
          if (!args[2]) { console.error('Usage: bakin plugins install <path|github:user/repo>'); process.exit(1) }
          await cmdPluginsInstall(args[2])
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: bakin plugins remove <id>'); process.exit(1) }
          await cmdPluginsRemove(args[2])
        } else {
          console.error(`Unknown plugins subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'start':
        await cmdStart()
        break

      case 'stop':
        await cmdStop()
        break

      case 'logs':
        await cmdLogs(args[1])
        break

      case 'setup':
        if (sub === 'service') {
          const uninstall = args.includes('--uninstall')
          await cmdSetupService({ uninstall })
        } else if (sub === 'antfly') {
          console.error('[deprecated] `bakin setup antfly` is now `bakin install antfly`. Delegating...')
          await cmdOnboardingInstallSingle('antfly', args)
        } else if (sub === 'mcporter') {
          console.error('[deprecated] `bakin setup mcporter` is now `bakin install mcporter`. Delegating...')
          await cmdOnboardingInstallSingle('mcporter', args)
        } else {
          console.error(`Unknown setup target: ${sub}`)
          console.error('Available: bakin setup service | bakin setup antfly | bakin setup mcporter')
          process.exit(1)
        }
        break

      case 'paths':
        await cmdPaths(args[1])
        break

      case 'agent-rules': {
        const apply = args.includes('--apply')
        const check = args.includes('--check')
        const applyAll = args.includes('--apply-all')
        const checkAll = args.includes('--check-all')
        await cmdAgentRules({ apply, check, applyAll, checkAll })
        break
      }

      case 'mkdir':
        await cmdOnboardingMkdir()
        break

      case 'check':
        if (sub === 'openclaw' || sub === 'llm' || sub === 'channels') {
          await cmdOnboardingCheckSingle(sub)
        } else if (sub === 'all') {
          await cmdOnboardingCheckAll()
        } else {
          console.error(`Unknown check target: ${sub}`)
          console.error('Available: bakin check openclaw | llm | channels | all')
          process.exit(1)
        }
        break

      case 'install':
        if (sub === 'antfly' || sub === 'models' || sub === 'mcporter') {
          await cmdOnboardingInstallSingle(sub, args)
        } else {
          console.error(`Unknown install target: ${sub}`)
          console.error('Available: bakin install antfly | models | mcporter')
          process.exit(1)
        }
        break

      case 'onboard':
        await cmdOnboard(args)
        break

      case 'init':
        console.error('[deprecated] `bakin init` is now `bakin mkdir`. Delegating...')
        await cmdOnboardingMkdir()
        break

      case 'doctor':
        await cmdDoctor()
        break

      case 'reboot':
      case 'restart':
        await cmdReboot()
        break

      case 'reindex': {
        const reindexOpts: { table?: string; rebuild?: boolean } = {}
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith('--table=')) reindexOpts.table = args[i].split('=')[1]
          else if (args[i] === '--table' && args[i + 1]) reindexOpts.table = args[++i]
          else if (args[i] === '--rebuild') reindexOpts.rebuild = true
        }
        await cmdReindex(reindexOpts)
        break
      }

      case 'docs':
        await cmdDocs()
        break

      case 'search': {
        const searchOpts: { table?: string; limit?: number; agent?: string; facets?: string } = {}
        const queryParts: string[] = []
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith('--table=')) searchOpts.table = args[i].split('=')[1]
          else if (args[i] === '--table' && args[i + 1]) searchOpts.table = args[++i]
          else if (args[i].startsWith('--agent=')) searchOpts.agent = args[i].split('=')[1]
          else if (args[i] === '--agent' && args[i + 1]) searchOpts.agent = args[++i]
          else if (args[i].startsWith('--limit=')) searchOpts.limit = Number(args[i].split('=')[1])
          else if (args[i] === '--limit' && args[i + 1]) searchOpts.limit = Number(args[++i])
          else if (args[i].startsWith('--facets=')) searchOpts.facets = args[i].split('=')[1]
          else if (args[i] === '--facets' && args[i + 1]) searchOpts.facets = args[++i]
          else queryParts.push(args[i])
        }
        if (!queryParts.length) { console.error('Usage: bakin search <query> [--table=tasks] [--limit=10] [--facets=status,agent]'); process.exit(1) }
        await cmdSearch(queryParts.join(' '), searchOpts)
        break
      }

      case 'search:stats':
        await cmdSearchStats()
        break

      case 'trash':
        if (!sub || sub === 'list') {
          await cmdTrashList()
        } else if (sub === 'restore') {
          if (!args[2]) { console.error('Usage: bakin trash restore <filename>'); process.exit(1) }
          await cmdTrashRestore(args[2])
        } else if (sub === 'empty') {
          await cmdTrashEmpty()
        } else {
          console.error(`Unknown trash subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'schedule':
        if (!sub || sub === 'list') {
          await cmdScheduleList({ agent: args.includes('--agent') ? args[args.indexOf('--agent') + 1] : undefined })
        } else if (sub === 'add') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin schedule add <name> <schedule> [--agent <id>] [--prompt <text>]'); process.exit(1) }
          const agentIdx = args.indexOf('--agent')
          const promptIdx = args.indexOf('--prompt')
          await cmdScheduleAdd({
            name: args[2],
            schedule: args[3],
            agent: agentIdx > -1 ? args[agentIdx + 1] : undefined,
            prompt: promptIdx > -1 ? args.slice(promptIdx + 1).join(' ') : undefined,
          })
        } else if (sub === 'pause') {
          if (!args[2]) { console.error('Usage: bakin schedule pause <jobId> [--until <date>] [--skip <n>]'); process.exit(1) }
          const untilIdx = args.indexOf('--until')
          const skipIdx = args.indexOf('--skip')
          await cmdSchedulePause(args[2], {
            until: untilIdx > -1 ? args[untilIdx + 1] : undefined,
            skip: skipIdx > -1 ? Number(args[skipIdx + 1]) : undefined,
          })
        } else if (sub === 'resume') {
          if (!args[2]) { console.error('Usage: bakin schedule resume <jobId>'); process.exit(1) }
          await cmdScheduleResume(args[2])
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: bakin schedule remove <jobId>'); process.exit(1) }
          await cmdScheduleRemove(args[2])
        } else if (sub === 'run') {
          if (!args[2]) { console.error('Usage: bakin schedule run <jobId>'); process.exit(1) }
          await cmdScheduleRun(args[2])
        } else if (sub === 'runs') {
          if (!args[2]) { console.error('Usage: bakin schedule runs <jobId>'); process.exit(1) }
          await cmdScheduleRuns(args[2], { limit: 20 })
        } else {
          console.error(`Unknown schedule subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'messaging':
        if (!sub || sub === 'list') {
          await cmdMessagingList({
            month: parseFlag(args, 'month'),
            status: parseFlag(args, 'status'),
            agent: parseFlag(args, 'agent'),
            channel: parseFlag(args, 'channel'),
          })
        } else if (sub === 'get') {
          if (!args[2]) { console.error('Usage: bakin messaging get <id>'); process.exit(1) }
          await cmdMessagingGet(args[2])
        } else if (sub === 'create') {
          await cmdMessagingCreate(args.slice(2))
        } else if (sub === 'update') {
          if (!args[2]) { console.error('Usage: bakin messaging update <id> [--title=X --status=Y]'); process.exit(1) }
          await cmdMessagingUpdate(args[2], args.slice(3))
        } else if (sub === 'delete') {
          if (!args[2]) { console.error('Usage: bakin messaging delete <id>'); process.exit(1) }
          await cmdMessagingDelete(args[2])
        } else if (sub === 'approve') {
          if (!args[2]) { console.error('Usage: bakin messaging approve <id>'); process.exit(1) }
          await cmdMessagingApprove(args[2])
        } else if (sub === 'reject') {
          if (!args[2]) { console.error('Usage: bakin messaging reject <id> [note]'); process.exit(1) }
          await cmdMessagingReject(args[2], args[3])
        } else if (sub === 'sessions') {
          await cmdSessionList({
            status: parseFlag(args, 'status'),
            agent: parseFlag(args, 'agent'),
          })
        } else if (sub === 'session') {
          if (!args[2]) { console.error('Usage: bakin messaging session <id>'); process.exit(1) }
          await cmdSessionGet(args[2])
        } else if (sub === 'session-create') {
          if (!args[2]) { console.error('Usage: bakin messaging session-create <agentId> [title]'); process.exit(1) }
          await cmdSessionCreate(args[2], args[3])
        } else if (sub === 'session-update') {
          if (!args[2]) { console.error('Usage: bakin messaging session-update <id> --title=X'); process.exit(1) }
          await cmdSessionUpdate(args[2], args.slice(3))
        } else if (sub === 'session-delete') {
          if (!args[2]) { console.error('Usage: bakin messaging session-delete <id>'); process.exit(1) }
          await cmdSessionDelete(args[2])
        } else if (sub === 'message') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin messaging message <sessionId> <text>'); process.exit(1) }
          await cmdSessionMessage(args[2], args.slice(3).join(' '))
        } else if (sub === 'confirm') {
          if (!args[2]) { console.error('Usage: bakin messaging confirm <sessionId>'); process.exit(1) }
          await cmdSessionConfirm(args[2])
        } else if (sub === 'proposal') {
          if (!args[2] || !args[3]) { console.error('Usage: bakin messaging proposal <sessionId> <proposalId> [--approve|--reject|--status=X]'); process.exit(1) }
          await cmdProposalUpdate(args[2], args[3], args.slice(4))
        } else {
          console.error(`Unknown messaging subcommand: ${sub}`)
          process.exit(1)
        }
        break

      default:
        console.error(`Unknown command: ${cmd}`)
        console.log(USAGE.trim())
        process.exit(1)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
      console.error('Error: Cannot connect to Bakin. Is the server running?')
      console.error(`  Tried: ${BASE_URL}`)
    } else {
      console.error('Error:', err instanceof Error ? err.message : String(err))
    }
    process.exit(1)
  }
}

main()
