/**
 * Filesystem seeder — creates the configured mock home with all fixture data.
 * Idempotent: skips if directory already exists (use --force to re-seed).
 */
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync, appendFileSync } from 'fs'
import { execSync } from 'child_process'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initBakinHome, resetContentDir } from '../../packages/core/src/content-dir'
import {
  attachCronTask,
  claimCronFire,
  claimRun,
  loseRun,
  markCronFireSkipped,
  recordRunCost,
  settleRun,
  supersedeStaleRun,
} from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'
import { getMockHome } from './env'
import { seedUsageSessions } from './seed-usage-sessions'
import { seedVersionedAssets } from './seed-assets'
import { seedBrands } from './seed-brands'
import { seedChats } from './seed-chat'
import { seedTeamContent } from './seed-team'
import { seedEnrichAgent } from './seed-enrich'
import { seedMessagingCalendar } from './seed-messaging'

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
    // The wipe below takes the antfly data dir with it. If the OS-supervised
    // engine is running against this home, it must be BOUNCED after the wipe
    // — otherwise it keeps serving deleted inodes: some tables 500, others
    // 404, drains stall, and blue/green rebuilds park ("green never
    // converged"). Stop it first; the post-wipe restart happens below.
    stopAntflyServiceIfPresent()
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

  // Usage-history transcripts (relative dates → all 3 windows populate),
  // versioned assets with enrichment states, personas + lessons + webp avatar.
  seedUsageSessions(mockHome)
  seedVersionedAssets(mockHome)
  seedBrands(mockHome)
  seedChats(mockHome)
  seedTeamContent(mockHome)
  seedEnrichAgent(mockHome)
  seedMessagingCalendar(mockHome)

  // Seed Bakin-owned task-store data.
  seedTasks(mockHome)

  // Seed Bakin-owned schedules + their ledger fire history (run-history UI).
  seedSchedules(mockHome)
  seedScheduleFires()
  seedTaskRuns()
  seedModelsSettings(mockHome)

  // Create a sample gateway log for today
  seedGatewayLog()

  // Seed audit entries for watchdog recoveries into ~/.bakin/audit.jsonl
  seedAuditLog(mockHome)

  // Write .onboarded marker so the server doesn't gate on onboarding
  seedOnboardedMarker(mockHome)

  // Symlink external plugins from bakin-bits-official
  seedPluginSymlinks(mockHome)

  // If the OS-supervised antfly service exists, restart it so it opens the
  // freshly wiped data dir instead of serving pre-wipe inodes.
  restartAntflyServiceIfPresent()

  console.log(`[seed] Done — ${mockHome} ready`)
}

// ─── Antfly service coordination (darwin best-effort) ────────────────────────
// The mock home's engine runs under launchd (io.bakin.antfly). Wiping its
// data dir under a live engine leaves it serving deleted inodes — every
// force-reseed must stop-before-wipe and restart-after-seed. All calls are
// best-effort: no service (CI/Linux/child-mode) is fine.

const ANTFLY_SERVICE = 'io.bakin.antfly'

function antflyPlistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${ANTFLY_SERVICE}.plist`)
}

/**
 * True only when the LaunchAgent's --data-dir points inside the mock home.
 * A service serving another home (real ~/.bakin, the docker rig) is left
 * strictly alone — the wipe doesn't touch its data, so no bounce is needed.
 */
function antflyServiceTargetsMockHome(): boolean {
  if (process.platform !== 'darwin') return false
  const plist = antflyPlistPath()
  if (!existsSync(plist)) return false
  try {
    return readFileSync(plist, 'utf-8').includes(getMockHome())
  } catch {
    return false
  }
}

function antflyServiceLoaded(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execSync(`launchctl list ${ANTFLY_SERVICE}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function stopAntflyServiceIfPresent(): void {
  if (!antflyServiceTargetsMockHome() || !antflyServiceLoaded()) return
  try {
    execSync(`launchctl bootout gui/$(id -u)/${ANTFLY_SERVICE}`, { stdio: 'ignore', shell: '/bin/bash' })
    console.log('[seed] antfly service stopped for the wipe')
  } catch {
    console.warn('[seed] could not stop antfly service — a stale engine may need `launchctl kickstart -k` after seeding')
  }
}

function restartAntflyServiceIfPresent(): void {
  if (!antflyServiceTargetsMockHome()) return
  const plist = antflyPlistPath()
  try {
    if (!antflyServiceLoaded()) {
      execSync(`launchctl bootstrap gui/$(id -u) ${JSON.stringify(plist)}`, { stdio: 'ignore', shell: '/bin/bash' })
    }
    execSync(`launchctl kickstart -k gui/$(id -u)/${ANTFLY_SERVICE}`, { stdio: 'ignore', shell: '/bin/bash' })
    console.log('[seed] antfly service restarted on the fresh data dir')
  } catch {
    console.warn('[seed] could not restart antfly service — run `launchctl kickstart -k gui/$UID/io.bakin.antfly` manually')
  }
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

/**
 * Seed `runs` history so the per-task Run History UI shows real attempts.
 * All rows are TERMINAL (settled/lost/superseded) — a seeded 'running' row
 * would be flipped to 'lost' by the boot sweep, and faking "running" with
 * nothing live is misleading. Targets the mock home (BAKIN_HOME pinned above).
 */
function seedTaskRuns(): void {
  const MIN = 60_000
  const now = Date.now()
  const boot = 'seed-boot'
  const rid = (task: string, seq: number) => `task:${task}:d${seq}`

  // The common case: one clean attempt.
  claimRun({ runId: rid('task-dn-001', 1), taskId: 'task-dn-001', seq: 1, agent: 'pixel', bootId: boot, now: now - 120 * MIN })
  settleRun(rid('task-dn-001', 1), 'turn-ok', now - 118 * MIN)

  // A single settled attempt on an in-progress task.
  claimRun({ runId: rid('task-ip-001', 1), taskId: 'task-ip-001', seq: 1, agent: 'pixel', bootId: boot, now: now - 30 * MIN })
  settleRun(rid('task-ip-001', 1), 'turn-ok', now - 26 * MIN)

  // The "why did this dispatch 3×" story (matches its task.auto_recovered audit):
  // #1 died mid-session → #2 went stale and was superseded → #3 finished.
  const T = 'task-ip-003'
  claimRun({ runId: rid(T, 1), taskId: T, seq: 1, agent: 'rolo', bootId: boot, now: now - 210 * MIN })
  loseRun(rid(T, 1), 'session-death', now - 205 * MIN)
  claimRun({ runId: rid(T, 2), taskId: T, seq: 2, agent: 'rolo', bootId: boot, now: now - 200 * MIN })
  supersedeStaleRun(T, now - 200 * MIN + 1, now - 198 * MIN) // d2 heartbeat stale → superseded
  claimRun({ runId: rid(T, 3), taskId: T, seq: 3, agent: 'rolo', bootId: boot, now: now - 50 * MIN })
  settleRun(rid(T, 3), 'turn-ok', now - 47 * MIN)

  const spendRows = [
    { runId: 'seed:spend:workflow-sonnet', taskId: 'task-dn-001', agent: 'pixel', model: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', lane: 'metered' as const, workClass: 'workflow', inputTokens: 18_000, outputTokens: 4_000, costUsdMicros: 410_000, ago: 35 },
    { runId: 'seed:spend:scheduled-haiku', taskId: 'task-ip-001', agent: 'jessica', model: 'anthropic/claude-haiku-4-5', provider: 'anthropic', lane: 'metered' as const, workClass: 'scheduled', inputTokens: 9_000, outputTokens: 1_500, costUsdMicros: 44_000, ago: 70 },
    { runId: 'seed:spend:manual-gpt', taskId: 'task-ip-003', agent: 'patch', model: 'openai/gpt-5.4', provider: 'openai', lane: 'metered' as const, workClass: 'manual', inputTokens: 22_000, outputTokens: 5_000, costUsdMicros: 520_000, ago: 110 },
    { runId: 'seed:spend:chat-codex', agent: 'main', model: 'openai-codex/gpt-5.4', provider: 'openai-codex', lane: 'subscription' as const, workClass: 'chat', inputTokens: 14_000, outputTokens: 3_000, costUsdMicros: null, ago: 150 },
    { runId: 'seed:spend:recovery-gemini', taskId: 'task-ip-003', agent: 'rolo', model: 'google/gemini-2.5-pro', provider: 'google', lane: 'metered' as const, workClass: 'recovery', inputTokens: 28_000, outputTokens: 6_000, costUsdMicros: 350_000, ago: 260 },
    { runId: 'seed:spend:decomposition-opus', taskId: 'task-bl-001', agent: 'main', model: 'anthropic/claude-opus-4-6', provider: 'anthropic', lane: 'metered' as const, workClass: 'decomposition', inputTokens: 31_000, outputTokens: 8_000, costUsdMicros: 970_000, ago: 420 },
    { runId: 'seed:spend:title-mini', agent: 'main', model: 'openai/gpt-4.1-mini', provider: 'openai', lane: 'metered' as const, workClass: 'auto-title', inputTokens: 2_000, outputTokens: 300, costUsdMicros: 9_000, ago: 760 },
    { runId: 'seed:spend:enrichment-flash', agent: 'pixel', model: 'google/gemini-2.5-flash', provider: 'google', lane: 'metered' as const, workClass: 'enrichment', inputTokens: 7_000, outputTokens: 900, costUsdMicros: 12_000, ago: 1_100 },
    { runId: 'seed:spend:relay-codex', agent: 'patch', model: 'openai-codex/gpt-5.3-codex', provider: 'openai-codex', lane: 'subscription' as const, workClass: 'relay', inputTokens: 24_000, outputTokens: 4_000, costUsdMicros: null, ago: 1_600 },
    { runId: 'seed:spend:direct-sonnet', agent: 'jessica', model: 'anthropic/claude-sonnet-4', provider: 'anthropic', lane: 'metered' as const, workClass: 'direct-send', inputTokens: 12_000, outputTokens: 2_200, costUsdMicros: 190_000, ago: 2_200 },
    { runId: 'seed:spend:team-qwen', taskId: 'task-td-004', agent: 'rolo', model: 'openrouter/qwen-2.5-72b', provider: 'openrouter', lane: 'metered' as const, workClass: 'team', inputTokens: 17_000, outputTokens: 2_800, costUsdMicros: 80_000, ago: 5_000 },
    { runId: 'seed:spend:workflow-older', taskId: 'task-rv-001', agent: 'pixel', model: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', lane: 'metered' as const, workClass: 'workflow', inputTokens: 42_000, outputTokens: 9_000, costUsdMicros: 840_000, ago: 12_000 },
  ]

  for (const row of spendRows) {
    recordRunCost({
      workClass: row.workClass,
      runId: row.runId,
      taskId: row.taskId,
      agent: row.agent,
      model: row.model,
      provider: row.provider,
      lane: row.lane,
      usageKind: 'tokens',
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.inputTokens + row.outputTokens,
      costUsdMicros: row.costUsdMicros,
      occurredAt: now - row.ago * MIN,
    })
  }

  closeDb()
  console.log(`[seed] Task run history seeded (3 tasks, 5 runs, ${spendRows.length} spend rows)`)
}

function seedModelsSettings(mockHome: string): void {
  const settingsDir = join(mockHome, 'plugin-settings')
  mkdirSync(settingsDir, { recursive: true })
  writeFileSync(
    join(settingsDir, 'models.json'),
    JSON.stringify({
      budget: {
        rules: [
          {
            scope: 'global',
            lane: 'metered',
            dailyCap: 10,
            monthlyCap: 100,
            warnPct: 0.8,
            atCap: 'defer',
          },
          {
            scope: 'agent',
            scopeId: 'pixel',
            lane: 'subscription',
            monthlyCap: 250_000,
            warnPct: 0.8,
            atCap: 'defer',
          },
        ],
      },
    }, null, 2),
    'utf-8',
  )
  console.log('[seed] Models budget settings seeded (2 rules)')
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
