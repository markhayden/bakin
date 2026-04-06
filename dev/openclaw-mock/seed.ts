/**
 * Filesystem seeder — creates ~/.imitationcrab/ with all fixture data.
 * Idempotent: skips if directory already exists (use --force to re-seed).
 */
import { existsSync, mkdirSync, cpSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MOCK_HOME = join(homedir(), '.imitationcrab')
const FIXTURES_DIR = join(__dirname, 'fixtures')

export function getMockHome(): string {
  return MOCK_HOME
}

export function seed(force = false): void {
  if (existsSync(MOCK_HOME) && !force) {
    console.log(`[seed] ${MOCK_HOME} already exists — skipping (use --force to re-seed)`)
    return
  }

  console.log(`[seed] Creating ${MOCK_HOME}`)

  // Create directory structure
  mkdirSync(join(MOCK_HOME, 'agents', 'main', 'agent'), { recursive: true })
  mkdirSync(join(MOCK_HOME, 'cron', 'runs'), { recursive: true })
  mkdirSync(join(MOCK_HOME, 'flows'), { recursive: true })
  mkdirSync(join(MOCK_HOME, 'workspace'), { recursive: true })
  mkdirSync(join(MOCK_HOME, 'bin'), { recursive: true })

  // Copy fixtures
  cpSync(join(FIXTURES_DIR, 'openclaw.json'), join(MOCK_HOME, 'openclaw.json'))
  cpSync(join(FIXTURES_DIR, 'auth-profiles.json'), join(MOCK_HOME, 'agents', 'main', 'agent', 'auth-profiles.json'))
  cpSync(join(FIXTURES_DIR, 'jobs.json'), join(MOCK_HOME, 'cron', 'jobs.json'))

  // Copy run history
  cpSync(join(FIXTURES_DIR, 'runs'), join(MOCK_HOME, 'cron', 'runs'), { recursive: true })

  // Copy main workspace
  cpSync(join(FIXTURES_DIR, 'workspace'), join(MOCK_HOME, 'workspace'), { recursive: true })

  // Copy subagent workspaces
  const subagents = ['pixel', 'rolo', 'basil', 'scout', 'nemo', 'zen', 'patch']
  for (const agent of subagents) {
    const src = join(FIXTURES_DIR, 'workspaces', agent)
    const dest = join(MOCK_HOME, 'workspaces', agent)
    if (existsSync(src)) {
      cpSync(src, dest, { recursive: true })
    }
  }

  // Create SQLite database with seed data
  seedDatabase()

  // Create a sample gateway log for today
  seedGatewayLog()

  console.log(`[seed] Done — ${MOCK_HOME} ready`)
}

function seedDatabase(): void {
  try {
    const Database = require('better-sqlite3')
    const dbPath = join(MOCK_HOME, 'flows', 'registry.sqlite')
    const db = new Database(dbPath)
    const sql = readFileSync(join(FIXTURES_DIR, 'seed.sql'), 'utf-8')
    db.exec(sql)
    db.close()
    console.log('[seed] SQLite database seeded')
  } catch (err) {
    console.warn('[seed] Could not seed SQLite (better-sqlite3 may not be available):', (err as Error).message)
  }
}

function seedGatewayLog(): void {
  const { writeFileSync } = require('fs')
  const today = new Date().toISOString().slice(0, 10)
  const logDir = join('/tmp', 'openclaw')
  mkdirSync(logDir, { recursive: true })
  const logPath = join(logDir, `openclaw-${today}.log`)
  if (!existsSync(logPath)) {
    const sampleLog = [
      `${new Date().toISOString()} [INFO] Gateway started (mock)`,
      `${new Date().toISOString()} [INFO] Loaded 8 agents from config`,
      `${new Date().toISOString()} [INFO] Listening on :18789`,
    ].join('\n') + '\n'
    writeFileSync(logPath, sampleLog)
    console.log(`[seed] Gateway log created at ${logPath}`)
  }
}

// Run directly: npx tsx dev/openclaw-mock/seed.ts [--force]
if (import.meta.url === `file://${process.argv[1]}`) {
  const force = process.argv.includes('--force')
  seed(force)
}
