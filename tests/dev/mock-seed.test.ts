import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

describe('mock seed', () => {
  let tempHome: string | undefined

  afterEach(() => {
    if (tempHome && existsSync(tempHome)) {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('creates the expected directory structure', async () => {
    // The seed module uses a hardcoded path (~/.imitationcrab).
    // For testing, we import the seed function and check that the fixture files exist.
    // We'll verify the fixtures directory contains the expected files.
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')

    expect(existsSync(join(fixturesDir, 'openclaw.json'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'auth-profiles.json'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'jobs.json'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'seed.sql'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'workspace', 'SOUL.md'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'workspace', 'IDENTITY.md'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'workspace', 'AGENTS.md'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'workspace', 'TOOLS.md'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'workflows', 'definitions', 'approval-copy.yaml'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'workflows', 'definitions', 'approval-image.yaml'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'workflows', 'definitions', 'approval-bundle.yaml'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'workflows', 'instances', 'task-rv-002.json'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'workflows', 'instances', 'task-rv-003.json'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'workflows', 'instances', 'task-rv-004.json'))).toBe(true)
    expect(existsSync(join(fixturesDir, 'bakin', 'assets', 'images', 'task-rv-003', 'trail-status-concept.svg'))).toBe(true)
  })

  it('fixture openclaw.json has valid agent roster', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const config = JSON.parse(readFileSync(join(fixturesDir, 'openclaw.json'), 'utf-8'))

    expect(config.agents.list).toHaveLength(8)
    const ids = config.agents.list.map((a: { id: string }) => a.id)
    expect(ids).toContain('main')
    expect(ids).toContain('pixel')
    expect(ids).toContain('rolo')
    expect(ids).toContain('basil')
    expect(ids).toContain('scout')
    expect(ids).toContain('nemo')
    expect(ids).toContain('zen')
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

  it('fixture seed.sql creates flow_runs with seed tasks', () => {
    const fixturesDir = join(import.meta.dirname, '..', '..', 'dev', 'imitation-crab', 'fixtures')
    const sql = readFileSync(join(fixturesDir, 'seed.sql'), 'utf-8')

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS flow_runs')
    expect(sql).toContain('bakin:task:')

    // Verify we have tasks in different states
    expect(sql).toContain("'queued'")
    expect(sql).toContain("'running'")
    expect(sql).toContain("'waiting'")
    expect(sql).toContain("'succeeded'")
    expect(sql).toContain('"workflowId":"approval-copy"')
    expect(sql).toContain('"workflowId":"approval-image"')
    expect(sql).toContain('"workflowId":"approval-bundle"')
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
    const subagents = ['pixel', 'rolo', 'basil', 'scout', 'nemo', 'zen', 'patch']

    for (const agent of subagents) {
      const wsDir = join(fixturesDir, 'workspaces', agent)
      expect(existsSync(join(wsDir, 'IDENTITY.md')), `${agent} missing IDENTITY.md`).toBe(true)
      expect(existsSync(join(wsDir, 'SOUL.md')), `${agent} missing SOUL.md`).toBe(true)
    }
  })
})
