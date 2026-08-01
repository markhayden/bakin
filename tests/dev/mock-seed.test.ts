import { describe, it, expect, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, lstatSync } from 'fs'
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

  /** All seeded asset dirs across the relative-dated YYYY-MM shards. */
  function listSeededAssetDirs(home: string): string[] {
    const fs = require('fs') as typeof import('fs')
    const storeRoot = join(home, 'assets', 'store')
    if (!existsSync(storeRoot)) return []
    return fs.readdirSync(storeRoot).flatMap((shard) => {
      const shardDir = join(storeRoot, shard)
      if (!fs.statSync(shardDir).isDirectory()) return []
      return fs.readdirSync(shardDir).map((id) => join(shardDir, id))
    })
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
    // Versioned-asset store (post-#457) — shards are relative to seed time.
    const trailConcept = listSeededAssetDirs(home).find((d) => d.endsWith('-trail-status-concept-a1b2c3d4'))
    expect(trailConcept).toBeTruthy()
  })

  it('seeds the versioned asset store: manifests + version files, no legacy sidecars', () => {
    const home = configureTempHome()
    seed(true)
    const fs = require('fs') as typeof import('fs')
    const assetDirs = listSeededAssetDirs(home)
    expect(assetDirs.length).toBeGreaterThanOrEqual(19)
    for (const dir of assetDirs) {
      expect(existsSync(join(dir, 'manifest.json')), `${dir} missing manifest.json`).toBe(true)
      const manifest = JSON.parse(fs.readFileSync(join(dir, 'manifest.json'), 'utf-8')) as {
        assetId: string
        currentVersion: number
        versions: Array<{ file: string }>
      }
      expect(manifest.versions.length).toBeGreaterThanOrEqual(1)
      for (const v of manifest.versions) {
        expect(existsSync(join(dir, v.file)), `${dir} missing version file ${v.file}`).toBe(true)
      }
      const entries = fs.readdirSync(dir)
      expect(entries.some((f) => f.endsWith('.meta.json')), `${dir} carries a legacy sidecar`).toBe(false)
    }
    // Raw inbox drops stay unmanaged (explicit-import demo).
    expect(fs.readdirSync(join(home, 'assets', 'inbox')).length).toBeGreaterThanOrEqual(2)
  })

  it('seeds representative brand records for list and detail UI review', () => {
    const home = configureTempHome()
    seed(true)
    const fs = require('fs') as typeof import('fs')
    const brandsRoot = join(home, 'brands')
    const ids = fs.readdirSync(brandsRoot)
      .filter((id) => existsSync(join(brandsRoot, id, 'brand.json')))
      .sort()
    const manifests = ids.map((id) =>
      JSON.parse(readFileSync(join(brandsRoot, id, 'brand.json'), 'utf-8')) as {
        id: string
        draft?: boolean
        logos: Array<{ assetId: string }>
        source?: { repo: string }
      },
    )

    expect(ids).toEqual([
      'copper-and-bloom',
      'daybreak-studio',
      'harvest-and-hearth',
      'northstar-trails',
    ])
    expect(manifests.some((brand) => brand.draft)).toBe(true)
    expect(manifests.some((brand) => !brand.draft)).toBe(true)
    expect(manifests.some((brand) => brand.logos.length > 0)).toBe(true)
    expect(manifests.some((brand) => brand.logos.length === 0)).toBe(true)
    expect(manifests.some((brand) => brand.source?.repo)).toBe(true)
    expect(existsSync(join(brandsRoot, 'harvest-and-hearth', 'guidelines', 'voice.md'))).toBe(true)
    expect(existsSync(join(brandsRoot, 'northstar-trails', 'lessons', 'weather-first.md'))).toBe(true)
  })

  it('seeds representative chats for launcher, rail, transcript, tool, and attachment review', () => {
    const home = configureTempHome()
    seed(true)
    const chatRoot = join(home, 'chat')
    const index = JSON.parse(readFileSync(join(chatRoot, 'index.json'), 'utf-8')) as {
      chats: Array<{ id: string; agentId: string; pinned: boolean; unreadCount: number }>
    }

    expect(index.chats.length).toBeGreaterThanOrEqual(3)
    expect(index.chats.some((chat) => chat.pinned)).toBe(true)
    expect(index.chats.some((chat) => chat.unreadCount > 0)).toBe(true)
    expect(new Set(index.chats.map((chat) => chat.agentId)).size).toBeGreaterThanOrEqual(3)

    const transcripts = index.chats.flatMap((chat) =>
      readFileSync(join(chatRoot, `${chat.id}.jsonl`), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind: string; attachments?: unknown[] }),
    )
    expect(transcripts.some((row) => row.kind === 'tool')).toBe(true)
    expect(transcripts.some((row) => row.kind === 'error')).toBe(true)
    expect(transcripts.some((row) => row.attachments?.length)).toBe(true)
  })

  it('seeds plugin symlinks when bakin-bits-official is available', () => {
    const home = configureTempHome()
    seed(true)
    const pluginsDir = join(home, 'plugins')
    if (existsSync(pluginsDir)) {
      for (const id of ['messaging', 'projects']) {
        const link = join(pluginsDir, id)
        if (existsSync(link)) {
          expect(lstatSync(link).isSymbolicLink()).toBe(true)
          expect(existsSync(join(link, 'bakin-plugin.json'))).toBe(true)
        }
      }
    }
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
    // The legacy BakinTask.execution slice was deleted with the dead
    // runtime.tasks.* adapter surface — fixtures must not carry it.
    expect(tasks.some((task) => 'execution' in task)).toBe(false)
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
