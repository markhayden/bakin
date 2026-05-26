import { describe, it, expect, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getMockHome, seed } from '../../dev/imitation-crab/seed'

describe('mock seed', () => {
  let tempHome: string | undefined
  const originalEnv = { ...process.env }

  afterEach(() => {
    if (tempHome && existsSync(tempHome)) {
      rmSync(tempHome, { recursive: true, force: true })
    }
    tempHome = undefined
    process.env = { ...originalEnv }
  })

  function configureTempHome(): string {
    tempHome = mkdtempSync(join(tmpdir(), 'bakin-imitation-crab-'))
    process.env.IMITATION_CRAB_HOME = tempHome
    process.env.BAKIN_HOME = tempHome
    return tempHome
  }

  it('seeds the expected directory structure into the configured mock home', () => {
    const home = configureTempHome()

    seed(true)

    expect(getMockHome()).toBe(home)
    expect(existsSync(join(home, 'openclaw.json'))).toBe(true)
    expect(existsSync(join(home, 'agents', 'main', 'agent', 'auth-profiles.json'))).toBe(true)
    expect(existsSync(join(home, 'cron', 'jobs.json'))).toBe(true)
    expect(existsSync(join(home, 'workspace', 'SOUL.md'))).toBe(true)
    expect(existsSync(join(home, 'workspace', 'IDENTITY.md'))).toBe(true)
    expect(existsSync(join(home, 'workspace', 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(home, 'workspace', 'TOOLS.md'))).toBe(true)
    expect(existsSync(join(home, 'workflows', 'definitions', 'approval-copy.yaml'))).toBe(true)
    expect(existsSync(join(home, 'workflows', 'definitions', 'approval-image.yaml'))).toBe(true)
    expect(existsSync(join(home, 'workflows', 'definitions', 'approval-bundle.yaml'))).toBe(true)
    expect(existsSync(join(home, 'workflows', 'instances', 'task-rv-002.json'))).toBe(true)
    expect(existsSync(join(home, 'workflows', 'instances', 'task-rv-003.json'))).toBe(true)
    expect(existsSync(join(home, 'workflows', 'instances', 'task-rv-004.json'))).toBe(true)
    expect(existsSync(join(home, 'assets', 'store', '2026-04', '20260406-trail-status-concept-a1b2c3d4.svg'))).toBe(true)
  })

  it('seeds canonical asset store with images and sidecars', () => {
    const home = configureTempHome()
    seed(true)
    const storeDir = join(home, 'assets', 'store', '2026-04')
    const files = existsSync(storeDir) ? require('fs').readdirSync(storeDir) as string[] : []
    const assets = files.filter((f: string) => !f.endsWith('.meta.json'))
    const sidecars = files.filter((f: string) => f.endsWith('.meta.json'))
    expect(assets.length).toBeGreaterThanOrEqual(19)
    expect(sidecars.length).toBe(assets.length)
  })

  it('force reseed removes stale files before copying fixtures', () => {
    const home = configureTempHome()
    const stalePath = join(home, 'stale.txt')
    writeFileSync(stalePath, 'stale', 'utf-8')

    seed(true)

    expect(existsSync(stalePath)).toBe(false)
    expect(existsSync(join(home, 'openclaw.json'))).toBe(true)
  })

  it('fixture openclaw.json has valid agent roster', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const config = JSON.parse(readFileSync(join(fixturesDir, 'openclaw.json'), 'utf-8'))

    expect(config.agents.list).toHaveLength(5)
    const ids = config.agents.list.map((a: { id: string }) => a.id)
    expect(ids).toContain('main')
    expect(ids).toContain('pixel')
    expect(ids).toContain('rolo')
    expect(ids).toContain('jessica')
    expect(ids).toContain('patch')

    // Each agent has identity
    for (const agent of config.agents.list) {
      expect(agent.identity).toBeDefined()
      expect(agent.identity.name).toBeTruthy()
      expect(agent.identity.emoji).toBeTruthy()
    }
  })

  it('fixture openclaw.json has gateway and channel config', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const config = JSON.parse(readFileSync(join(fixturesDir, 'openclaw.json'), 'utf-8'))

    expect(config.gateway.auth.token).toBeTruthy()
    expect(config.channels.discord.token).toBeTruthy()
    expect(config.skills.entries).toBeDefined()
  })

  it('fixture jobs.json has valid cron jobs', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const data = JSON.parse(readFileSync(join(fixturesDir, 'jobs.json'), 'utf-8'))

    expect(data.version).toBe(1)
    expect(data.jobs.length).toBeGreaterThanOrEqual(2)
    for (const job of data.jobs) {
      expect(job.id).toBeTruthy()
      expect(job.name).toBeTruthy()
      expect(job.schedule).toBeDefined()
    }
  })

  it('fixture tasks.json creates Bakin task-store tasks', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const tasks = JSON.parse(readFileSync(join(fixturesDir, 'tasks.json'), 'utf-8')) as Array<{
      column: string
      workflowId?: string
      execution?: { flowId?: string | null }
    }>
    const columns = new Set(tasks.map(task => task.column))
    const workflowIds = new Set(tasks.map(task => task.workflowId).filter(Boolean))

    expect(tasks.length).toBeGreaterThan(10)

    // Verify we have tasks in different states
    expect(columns).toContain('backlog')
    expect(columns).toContain('todo')
    expect(columns).toContain('inProgress')
    expect(columns).toContain('review')
    expect(columns).toContain('blocked')
    expect(columns).toContain('done')
    expect(columns).toContain('archived')
    expect(workflowIds).toContain('approval-copy')
    expect(workflowIds).toContain('approval-image')
    expect(workflowIds).toContain('approval-bundle')
    expect(tasks.every(task => task.execution?.flowId === null)).toBe(true)
  })

  it('approval workflow fixtures are pending approval with representative output types', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures', 'bakin', 'workflows', 'instances')
    const copy = JSON.parse(readFileSync(join(fixturesDir, 'task-rv-002.json'), 'utf-8'))
    const image = JSON.parse(readFileSync(join(fixturesDir, 'task-rv-003.json'), 'utf-8'))
    const bundle = JSON.parse(readFileSync(join(fixturesDir, 'task-rv-004.json'), 'utf-8'))

    expect(copy.status).toBe('pending_approval')
    expect(copy.stepStates['draft-copy'].output.caption).toBeTruthy()
    expect(copy.stepStates['draft-copy'].output.body).toContain('## Trail Notes')

    expect(image.status).toBe('pending_approval')
    expect(image.stepStates['recommend-image'].output.image_filename).toMatch(/\.\w+$/)
    expect(image.stepStates['recommend-image'].output.recommendation_markdown).toContain('### Why this direction works')

    expect(bundle.status).toBe('pending_approval')
    expect(bundle.stepStates['package-bundle'].output.summary_markdown).toContain('## Launch Recommendation')
    expect(bundle.stepStates['package-bundle'].output.handoff.owner_decision).toBeTruthy()
  })

  it('has workspace files for all subagents', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const subagents = ['pixel', 'rolo', 'jessica', 'patch']

    for (const agent of subagents) {
      const wsDir = join(fixturesDir, 'workspaces', agent)
      expect(existsSync(join(wsDir, 'IDENTITY.md')), `${agent} missing IDENTITY.md`).toBe(true)
      expect(existsSync(join(wsDir, 'SOUL.md')), `${agent} missing SOUL.md`).toBe(true)
    }
  })

  it('has avatar fixtures for all agents', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const agents = ['main', 'pixel', 'rolo', 'jessica', 'patch']
    for (const agent of agents) {
      const avatarPath = join(fixturesDir, 'avatars', `${agent}.jpg`)
      expect(existsSync(avatarPath), `${agent} missing avatar fixture`).toBe(true)
    }
  })

  it('seeds avatar files into agent directories', () => {
    const home = configureTempHome()
    seed(true)
    const agents = ['main', 'pixel', 'rolo', 'jessica', 'patch']
    for (const agent of agents) {
      const avatarPath = join(home, 'agents', agent, 'avatar.jpg')
      expect(existsSync(avatarPath), `${agent} missing seeded avatar`).toBe(true)
    }
  })
})
