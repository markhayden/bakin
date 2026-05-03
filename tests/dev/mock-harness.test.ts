import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { createImitationCrabHarness, prepareImitationCrabEnvironment, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'

describe('imitation-crab harness', () => {
  let harness: ImitationCrabHarness | null = null

  afterEach(async () => {
    await harness?.close()
    harness = null
  })

  it('prepares an isolated mock home, CLI shim, and normalized main workspace', () => {
    const env = prepareImitationCrabEnvironment()
    try {
      expect(process.env.BAKIN_HOME).toBe(env.home)
      expect(process.env.OPENCLAW_HOME).toBe(env.home)
      expect(process.env.OPENCLAW_PATH).toBe(env.shimPath)
      expect(existsSync(env.shimPath)).toBe(true)

      const config = JSON.parse(readFileSync(`${env.home}/openclaw.json`, 'utf-8'))
      expect(config.agents.defaults.workspace).toBe(`${env.home}/workspace`)
    } finally {
      env.cleanup()
      env.restoreEnv()
    }
  })

  it('creates AppServices backed by seeded Imitation Crab runtime fixtures', async () => {
    harness = await createImitationCrabHarness({ chatMode: 'echo' })

    const { runtime, tasks } = harness.services

    await expect(runtime.ping()).resolves.toBe(true)
    await expect(runtime.messaging.send({
      agentId: 'pixel',
      content: 'Check the harness',
    })).resolves.toEqual(expect.objectContaining({
      content: '[mock:Pixel] Check the harness',
    }))

    const agents = await runtime.agents.list()
    expect(agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(['main', 'pixel', 'patch']))
    expect(agents.find((agent) => agent.id === 'main')?.metadata?.workspacePath).toBe(`${harness.env.home}/workspace`)

    const mainSoul = await runtime.agents.readWorkspaceFile('main', 'SOUL.md')
    expect(mainSoul?.content).toContain('Crab')

    const patchSoul = await runtime.agents.readWorkspaceFile('patch', 'SOUL.md')
    expect(patchSoul?.content).toContain('Patch')

    const jobs = await runtime.cron.list()
    expect(jobs.map((job) => job.id)).toEqual(expect.arrayContaining(['daily-brief', 'weekly-review']))

    const taskList = await tasks.list()
    expect(taskList.length).toBeGreaterThan(10)
  })
})
