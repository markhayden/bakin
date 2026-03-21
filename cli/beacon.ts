#!/usr/bin/env npx tsx
/**
 * Beacon CLI — command-line interface for Beacon mission control.
 * All commands are thin wrappers around the Beacon HTTP API.
 */

const BASE_URL = process.env.BEACON_URL || 'http://localhost:3737'

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

  console.log('=== Beacon Status ===')
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
  // Read tasks from the API - for now we parse the taskboard file
  const result = await apiGet('/api/plugins/tasks/board') as { columns: Record<string, Array<Record<string, unknown>>> }
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

async function cmdTasksCreate(title: string, assignee?: string): Promise<void> {
  const body: Record<string, string> = { title }
  if (assignee) body.assignee = assignee
  const result = await apiPost('/api/tasks/create', body)
  print(result)
}

async function cmdTasksMove(id: string, to: string): Promise<void> {
  const result = await apiPost('/api/tasks/move', { id, to })
  print(result)
}

async function cmdAgentsList(): Promise<void> {
  const result = await apiGet('/api/agents') as { agents: Array<Record<string, unknown>> }
  for (const agent of result.agents) {
    const active = (agent.activeTasks as Array<{ title: string }>)?.length || 0
    const lastAct = agent.lastActivity ? ` (last: ${agent.lastActivity})` : ''
    console.log(`  ${agent.id}: ${active} active tasks${lastAct}`)
  }
}

async function cmdAgentsSend(agentId: string, message: string): Promise<void> {
  const result = await apiPost(`/api/agents/${agentId}/message`, { message })
  print(result)
}

async function cmdAgentsStatus(agentId: string): Promise<void> {
  const result = await apiGet(`/api/agents/${agentId}/status`)
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
  console.log('[..] Enabling Antfly in Beacon settings...')
  try {
    await apiPost('/api/settings', { antfly: { enabled: true, url: 'http://localhost:8080/api/v1' } })
    console.log('[OK] Antfly enabled')
  } catch {
    console.log('[WARN] Could not reach Beacon API — is the server running?')
    console.log('  Start Beacon first: npm run dev')
    console.log('  Then re-run: beacon setup antfly')
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
    console.log('[WARN] Reindex failed — Antfly may still be starting. Try: beacon reindex')
  }

  console.log('')
  console.log('Antfly setup complete! Beacon will auto-start Antfly on boot.')
  console.log('  Search:     beacon search "your query"')
  console.log('  Dashboard:  http://localhost:11433')
  console.log('  Reindex:    beacon reindex')
}

async function cmdSearch(query: string, options: { table?: string; limit?: number; agent?: string } = {}): Promise<void> {
  let url = `/api/search?q=${encodeURIComponent(query)}`
  if (options.table) url += `&table=${encodeURIComponent(options.table)}`
  if (options.agent) url += `&agent=${encodeURIComponent(options.agent)}`
  if (options.limit) url += `&limit=${options.limit}`
  const result = await apiGet(url)
  print(result)
}

async function cmdDoctor(): Promise<void> {
  const result = await apiGet('/api/doctor') as {
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

async function cmdReindex(): Promise<void> {
  console.log('Reindexing all content to Antfly...')
  const result = await apiPost('/api/reindex') as { ok: boolean; indexed: number }
  console.log(`Done. ${result.indexed} documents indexed.`)
}

// ---------------------------------------------------------------------------
// CLI router
// ---------------------------------------------------------------------------
const USAGE = `
Usage: beacon <command> [options]

Commands:
  status                           System health, agents, dispatch timer
  dispatch                         Trigger immediate task dispatch
  tasks list [--column=X]          List tasks (optionally filter by column)
  tasks create <title> [agent]     Create a new task
  tasks move <id> <column>         Move task to column
  agents list                      List all agents with status
  agents status <id>               Get detailed agent status
  agents tasks <id>                List tasks assigned to agent
  agents send <id> <message>       Send message to agent
  settings get [key]               Read settings (dot notation for nested)
  settings set <key> <value>       Update a setting
  plugins list                     List installed plugins
  plugins install <path|repo>      Install plugin (local path or github:user/repo)
  plugins remove <id>              Remove an installed plugin
  setup antfly                     Install AntflyDB + enable + reindex (one command)
  doctor                           Run health checks (agent sync, skill, gateway, etc.)
  reindex                          Reindex all content to Antfly
  docs                             Print API documentation
  search <query> [options]          Search across indexed content
    --table=<name>                   Filter by table (tasks, decisions, audit, content, assets)
    --agent=<name>                   Filter by agent (e.g. patch, pixel, rolo)
    --limit=<n>                      Max results (default: 10)

Environment:
  BEACON_URL    Base URL (default: http://localhost:3737)
`

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
        } else if (sub === 'create') {
          if (!args[2]) { console.error('Usage: beacon tasks create <title> [agent]'); process.exit(1) }
          await cmdTasksCreate(args[2], args[3])
        } else if (sub === 'move') {
          if (!args[2] || !args[3]) { console.error('Usage: beacon tasks move <id> <column>'); process.exit(1) }
          await cmdTasksMove(args[2], args[3])
        } else {
          console.error(`Unknown tasks subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'agents':
        if (sub === 'list') {
          await cmdAgentsList()
        } else if (sub === 'status') {
          if (!args[2]) { console.error('Usage: beacon agents status <id>'); process.exit(1) }
          await cmdAgentsStatus(args[2])
        } else if (sub === 'tasks') {
          if (!args[2]) { console.error('Usage: beacon agents tasks <id>'); process.exit(1) }
          await cmdAgentsTasks(args[2])
        } else if (sub === 'send') {
          if (!args[2] || !args[3]) { console.error('Usage: beacon agents send <id> <message>'); process.exit(1) }
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
          if (!args[2] || !args[3]) { console.error('Usage: beacon settings set <key> <value>'); process.exit(1) }
          await cmdSettingsSet(args[2], args[3])
        } else {
          console.error(`Unknown settings subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'plugins':
        if (sub === 'list') {
          await cmdPluginsList()
        } else if (sub === 'install') {
          if (!args[2]) { console.error('Usage: beacon plugins install <path|github:user/repo>'); process.exit(1) }
          await cmdPluginsInstall(args[2])
        } else if (sub === 'remove') {
          if (!args[2]) { console.error('Usage: beacon plugins remove <id>'); process.exit(1) }
          await cmdPluginsRemove(args[2])
        } else {
          console.error(`Unknown plugins subcommand: ${sub}`)
          process.exit(1)
        }
        break

      case 'setup':
        if (sub === 'antfly') {
          await cmdSetupAntfly()
        } else {
          console.error(`Unknown setup target: ${sub}`)
          console.error('Available: beacon setup antfly')
          process.exit(1)
        }
        break

      case 'doctor':
        await cmdDoctor()
        break

      case 'reindex':
        await cmdReindex()
        break

      case 'docs':
        await cmdDocs()
        break

      case 'search': {
        const searchOpts: { table?: string; limit?: number; agent?: string } = {}
        const queryParts: string[] = []
        for (let i = 1; i < args.length; i++) {
          if (args[i].startsWith('--table=')) searchOpts.table = args[i].split('=')[1]
          else if (args[i] === '--table' && args[i + 1]) searchOpts.table = args[++i]
          else if (args[i].startsWith('--agent=')) searchOpts.agent = args[i].split('=')[1]
          else if (args[i] === '--agent' && args[i + 1]) searchOpts.agent = args[++i]
          else if (args[i].startsWith('--limit=')) searchOpts.limit = Number(args[i].split('=')[1])
          else if (args[i] === '--limit' && args[i + 1]) searchOpts.limit = Number(args[++i])
          else queryParts.push(args[i])
        }
        if (!queryParts.length) { console.error('Usage: beacon search <query> [--table=content] [--agent=patch] [--limit=10]'); process.exit(1) }
        await cmdSearch(queryParts.join(' '), searchOpts)
        break
      }

      default:
        console.error(`Unknown command: ${cmd}`)
        console.log(USAGE.trim())
        process.exit(1)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
      console.error('Error: Cannot connect to Beacon. Is the server running?')
      console.error(`  Tried: ${BASE_URL}`)
    } else {
      console.error('Error:', err instanceof Error ? err.message : String(err))
    }
    process.exit(1)
  }
}

main()
