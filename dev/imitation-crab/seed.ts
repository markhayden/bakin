/**
 * Filesystem seeder — creates the configured mock home with all fixture data.
 * Idempotent: skips if directory already exists (use --force to re-seed).
 */
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync, appendFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initBakinHome, resetContentDir } from '../../packages/core/src/content-dir'
import { claimCronFire, attachCronTask, markCronFireSkipped } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'
import { getMockHome } from './env'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')

export { getMockHome }

export function seed(force = false): void {
  const mockHome = getMockHome()

  if (existsSync(mockHome) && !force) {
    console.log(`[seed] ${mockHome} already exists — skipping (use --force to re-seed)`)
    return
  }

  if (force) {
    rmSync(mockHome, { recursive: true, force: true })
  }

  // Resolve every Bakin path (and the execution ledger db) to the mock home for
  // the rest of this seed — never to real ~/.bakin. Set BEFORE any ledger write.
  process.env.BAKIN_HOME = mockHome
  resetContentDir()

  console.log(`[seed] Creating ${mockHome}`)

  // Create Bakin content structure (assets/, workflows/, settings.json, etc.)
  initBakinHome(mockHome)

  // Create directory structure
  mkdirSync(join(mockHome, 'agents', 'main', 'agent'), { recursive: true })
  mkdirSync(join(mockHome, 'cron', 'runs'), { recursive: true })
  mkdirSync(join(mockHome, 'workspace'), { recursive: true })
  mkdirSync(join(mockHome, 'bin'), { recursive: true })

  // Copy fixtures
  seedOpenClawConfig(mockHome)
  cpSync(join(FIXTURES_DIR, 'auth-profiles.json'), join(mockHome, 'agents', 'main', 'agent', 'auth-profiles.json'))
  cpSync(join(FIXTURES_DIR, 'jobs.json'), join(mockHome, 'cron', 'jobs.json'))

  // Copy run history
  cpSync(join(FIXTURES_DIR, 'runs'), join(mockHome, 'cron', 'runs'), { recursive: true })

  // Copy main workspace
  cpSync(join(FIXTURES_DIR, 'workspace'), join(mockHome, 'workspace'), { recursive: true })

  // Copy Bakin-specific mock content (workflow defs, instances, assets)
  const bakinFixtures = join(FIXTURES_DIR, 'bakin')
  if (existsSync(bakinFixtures)) {
    cpSync(bakinFixtures, mockHome, { recursive: true })
  }

  // Copy subagent workspaces
  const subagents = ['pixel', 'rolo', 'jessica', 'patch']
  for (const agent of subagents) {
    const src = join(FIXTURES_DIR, 'workspaces', agent)
    const dest = join(mockHome, 'workspaces', agent)
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true })
    }
  }

  // Seed avatar images and session transcripts for all agents
  seedAvatars(mockHome)
  seedSessionJsonl(mockHome)

  // Seed Bakin-owned task-store data.
  seedTasks(mockHome)

  // Seed Bakin-owned schedules + their ledger fire history (run-history UI).
  seedSchedules(mockHome)
  seedScheduleFires()

  // Create a sample gateway log for today
  seedGatewayLog()

  // Seed audit entries for watchdog recoveries into ~/.bakin/audit.jsonl
  seedAuditLog(mockHome)

  // Write .onboarded marker so the server doesn't gate on onboarding
  seedOnboardedMarker(mockHome)

  // Symlink external plugins from bakin-bits-official
  seedPluginSymlinks(mockHome)

  console.log(`[seed] Done — ${mockHome} ready`)
}

function seedOpenClawConfig(mockHome: string): void {
  const config = JSON.parse(readFileSync(join(FIXTURES_DIR, 'openclaw.json'), 'utf-8')) as {
    agents?: { defaults?: { workspace?: string } }
  }
  config.agents ??= {}
  config.agents.defaults ??= {}
  config.agents.defaults.workspace = join(mockHome, 'workspace')
  writeFileSync(join(mockHome, 'openclaw.json'), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

function seedTasks(mockHome: string): void {
  const tasks = JSON.parse(readFileSync(join(FIXTURES_DIR, 'tasks.json'), 'utf-8')) as Array<{
    id: string
    createdAt?: string
  }>
  const tasksRoot = join(mockHome, 'tasks')

  for (const task of tasks) {
    const shard = (task.createdAt || new Date().toISOString()).slice(0, 7)
    const dir = join(tasksRoot, shard)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `task-${task.id}.json`), JSON.stringify(task, null, 2) + '\n', 'utf-8')
  }

  console.log(`[seed] Bakin task store seeded (${tasks.length} tasks)`)
}

// IDs reused by seedScheduleFires so the run history is internally consistent.
const SCHED = {
  standup: 'sch_demo_standup',
  hourly: 'sch_demo_hourly',
  weekly: 'sch_demo_weekly',
} as const

function seedSchedules(mockHome: string): void {
  const now = new Date().toISOString()
  // createdAt = now so startup catch-up won't fire historical occurrences into
  // `blocked` on every boot (it skips occurrences predating createdAt). The
  // seeded cron_fires below provide the visible history; live ticks go forward.
  const base = {
    isBakinJob: true as const,
    source: 'bakin' as const,
    owner: 'main',
    requireTriage: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    tz: 'America/Denver',
    createdAt: now,
    updatedAt: now,
  }
  const jobs = {
    [SCHED.standup]: {
      ...base,
      jobId: SCHED.standup,
      displayName: 'Morning Standup',
      agentId: 'main',
      taskPrompt: 'Summarize what each agent is working on today.',
      taskTitle: 'Standup {date}',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: true,
      allowOverlap: false,
      lastTaskId: 'task-td-001',
    },
    [SCHED.hourly]: {
      ...base,
      jobId: SCHED.hourly,
      displayName: 'Hourly Inbox Sync',
      agentId: 'rolo',
      taskPrompt: 'Pull new inbox items and triage them.',
      taskTitle: 'Inbox sync {date}',
      schedule: { kind: 'cron', expr: '0 * * * *' },
      enabled: true,
      allowOverlap: false, // overruns serialize → overlap skips (seeded below)
      lastTaskId: 'task-ip-001',
    },
    [SCHED.weekly]: {
      ...base,
      jobId: SCHED.weekly,
      displayName: 'Weekly Report (paused)',
      agentId: 'rolo',
      taskPrompt: 'Compile the weekly engagement report.',
      taskTitle: 'Weekly report {date}',
      schedule: { kind: 'cron', expr: '0 8 * * 1' },
      enabled: false,
      paused: true,
      pauseReason: 'manual',
      allowOverlap: false,
    },
  }
  const dir = join(mockHome, 'schedule')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'sidecar.json'), JSON.stringify({ version: 1, jobs }, null, 2) + '\n', 'utf-8')
  console.log(`[seed] Bakin schedules seeded (${Object.keys(jobs).length} jobs)`)
}

/**
 * Seed cron_fires history so the run-history UI shows real fires + skips with
 * reasons. Targets the mock home's bakin.db (BAKIN_HOME was pinned above).
 */
function seedScheduleFires(): void {
  const HOUR = 3_600_000
  const now = Date.now()
  // Each entry: minutes-ago → a created (with task) or skipped (with reason) fire.
  type Fire = { job: string; agoH: number; task?: string; skip?: string }
  const fires: Fire[] = [
    { job: SCHED.standup, agoH: 49, task: 'task-td-001' },
    { job: SCHED.standup, agoH: 25, task: 'task-td-002' },
    { job: SCHED.standup, agoH: 1, task: 'task-td-003' },
    { job: SCHED.hourly, agoH: 4, task: 'task-ip-001' },
    { job: SCHED.hourly, agoH: 3, skip: 'overlap' }, // prior run still active
    { job: SCHED.hourly, agoH: 2, task: 'task-ip-002' },
    { job: SCHED.hourly, agoH: 1, skip: 'overlap' },
    { job: SCHED.weekly, agoH: 168, task: 'task-bl-001' },
    { job: SCHED.weekly, agoH: 0.5, skip: 'paused' }, // fired while paused
  ]
  for (const f of fires) {
    const firedAt = now - f.agoH * HOUR
    const occurrence = new Date(firedAt).toISOString()
    const runId = `${f.job}:${occurrence}`
    const claim = claimCronFire(f.job, runId, firedAt, 'pending', firedAt)
    if (!claim.claimed) continue
    if (f.skip) markCronFireSkipped(f.job, runId, f.skip)
    else if (f.task) attachCronTask(f.job, runId, f.task)
  }
  closeDb() // release the handle; the spawned server opens its own connection
  console.log(`[seed] Schedule run history seeded (${fires.length} fires)`)
}

function seedGatewayLog(): void {
  const today = new Date().toISOString().slice(0, 10)
  const logDir = join('/tmp', 'openclaw')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `openclaw-${today}.log`)
  if (!existsSync(logPath)) {
    const sampleLog = [
      `${new Date().toISOString()} [INFO] Gateway started (mock)`,
      `${new Date().toISOString()} [INFO] Loaded 5 agents from config`,
      `${new Date().toISOString()} [INFO] Listening on :18789`,
    ].join('\n') + '\n'
    writeFileSync(logPath, sampleLog)
    console.log(`[seed] Gateway log created at ${logPath}`)
  }
}

function seedAuditLog(mockHome: string): void {
  const bakinHome = process.env.BAKIN_HOME || mockHome
  const auditPath = join(bakinHome, 'audit.jsonl')

  // Watchdog recovery audit entries matching the seeded tasks
  const entries = [
    { ts: '2026-04-05T08:45:00Z', event: 'task.auto_recovered', agent: 'watchdog', data: { id: 'task-td-004', title: 'Resize product photos for email template', agent: 'pixel', minutesStuck: 153 } },
    { ts: '2026-04-05T17:22:00Z', event: 'task.auto_recovered', agent: 'watchdog', data: { id: 'task-ip-003', title: 'Compile weekly engagement metrics report', agent: 'rolo', minutesStuck: 202 } },
  ]

  const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n'

  // Append rather than overwrite — other seed steps or prior runs may have written entries
  try {
    if (!existsSync(bakinHome)) mkdirSync(bakinHome, { recursive: true })
    appendFileSync(auditPath, lines)
    console.log(`[seed] Audit log entries appended to ${auditPath}`)
  } catch (err) {
    console.warn('[seed] Could not seed audit log:', (err as Error).message)
  }
}

function seedAvatars(mockHome: string): void {
  const avatarsDir = join(FIXTURES_DIR, 'avatars')
  const agents = ['main', 'pixel', 'rolo', 'jessica', 'patch']
  for (const agent of agents) {
    const src = join(avatarsDir, `${agent}.jpg`)
    if (!existsSync(src)) continue
    const destDir = join(mockHome, 'agents', agent)
    mkdirSync(destDir, { recursive: true })
    cpSync(src, join(destDir, 'avatar.jpg'))
  }
  console.log(`[seed] Avatars seeded for ${agents.length} agents`)
}

function seedSessionJsonl(mockHome: string): void {
  const sessionsFixtures = join(FIXTURES_DIR, 'sessions')
  const agents = ['main', 'pixel', 'rolo', 'jessica', 'patch']
  for (const agent of agents) {
    const src = join(sessionsFixtures, agent, 'latest.jsonl')
    if (!existsSync(src)) continue
    const destDir = join(mockHome, 'agents', agent, 'sessions')
    mkdirSync(destDir, { recursive: true })
    cpSync(src, join(destDir, 'latest.jsonl'))
  }
  console.log(`[seed] Session transcripts seeded for ${agents.length} agents`)
}

function seedPluginSymlinks(mockHome: string): void {
  const projectRoot = join(__dirname, '..', '..')
  const bitsDir = process.env.BAKIN_BITS_DIR || join(projectRoot, '..', 'bakin-bits-official')
  const plugins = ['messaging', 'projects']

  if (!existsSync(join(bitsDir, 'plugins', 'messaging', 'bakin-plugin.json'))) {
    console.warn(`[seed] bakin-bits-official not found at ${bitsDir} — skipping plugin symlinks`)
    return
  }

  const pluginsDir = join(mockHome, 'plugins')
  mkdirSync(pluginsDir, { recursive: true })

  for (const id of plugins) {
    const target = join(bitsDir, 'plugins', id)
    const link = join(pluginsDir, id)
    if (existsSync(link)) continue
    symlinkSync(target, link, 'dir')
  }

  console.log(`[seed] Plugin symlinks created (${plugins.join(', ')})`)
}

function seedOnboardedMarker(mockHome: string): void {
  const markerPath = join(mockHome, '.onboarded')
  const marker = {
    version: 3,
    completedAt: new Date().toISOString(),
    bakinVersion: '0.0.0-dev',
    components: {
      directories: 'ok',
      runtime: 'ok',
      search: 'ok',
      channels: 'skipped',
    },
  }
  writeFileSync(markerPath, JSON.stringify(marker, null, 2), 'utf-8')
  console.log(`[seed] Onboarding marker written`)
}

// Run directly: bun run dev/imitation-crab/seed.ts [--force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force')
  seed(force)
}
