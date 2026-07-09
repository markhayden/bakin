import { afterEach, describe, expect, it } from 'bun:test'
import type { AppServices } from '@bakin/core/app-services'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { createImitationCrabHarness, type ImitationCrabHarness } from '../../dev/imitation-crab/harness'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'
import { maybeGetAppServices, setAppServices } from '../../src/core/app-services'
import { llmComponent, channelsComponent } from '../../src/core/onboarding/credentials'
import { runtimeComponent } from '../../src/core/onboarding/runtime'

type AppServicesGlobal = typeof globalThis & {
  __bakinAppServices?: AppServices
}

function restoreAppServices(previous: AppServices | undefined): void {
  if (previous) {
    setAppServices(previous)
  } else {
    delete (globalThis as AppServicesGlobal).__bakinAppServices
  }
}

function readRuntimeConfig(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, 'openclaw.json'), 'utf-8')) as Record<string, unknown>
}

function writeRuntimeConfig(home: string, config: Record<string, unknown>): void {
  writeFileSync(join(home, 'openclaw.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf-8')
  resetOpenClawConfigCache()
}

describe('imitation-crab onboarding contract', () => {
  let harness: ImitationCrabHarness | null = null
  let previousServices: AppServices | undefined

  afterEach(async () => {
    await harness?.close()
    harness = null
    restoreAppServices(previousServices)
    previousServices = undefined
    resetOpenClawConfigCache()
  })

  async function openHarness(): Promise<ImitationCrabHarness> {
    previousServices = maybeGetAppServices()
    harness = await createImitationCrabHarness({ chatMode: 'echo' })
    setAppServices(harness.services)
    return harness
  }

  it('passes runtime, LLM, and channel onboarding checks against seeded fixtures', async () => {
    await openHarness()

    await expect(runtimeComponent.check()).resolves.toEqual(expect.objectContaining({
      status: 'ok',
      details: expect.objectContaining({ runtime: 'openclaw', mainAgentId: 'main' }),
    }))
    await expect(llmComponent.check()).resolves.toEqual(expect.objectContaining({
      status: 'ok',
      details: expect.objectContaining({ providers: ['anthropic'] }),
    }))
    await expect(channelsComponent.check()).resolves.toEqual(expect.objectContaining({
      status: 'ok',
      details: expect.objectContaining({ channels: ['discord'] }),
    }))
  })

  it('reports a broken runtime check when the seeded roster loses main', async () => {
    const { env } = await openHarness()
    const config = readRuntimeConfig(env.home) as {
      agents?: { list?: Array<{ id?: string }> }
    }
    const main = config.agents?.list?.find((agent) => agent.id === 'main')
    if (!main) throw new Error('Fixture invariant failed: main agent is missing')
    main.id = 'crab'
    writeRuntimeConfig(env.home, config as Record<string, unknown>)

    const result = await runtimeComponent.check()
    expect(result.status).toBe('broken')
    expect(result.message).toContain("id 'main'")
  })

  it('warns when the seeded LLM auth profile file becomes malformed', async () => {
    const { env } = await openHarness()
    writeFileSync(join(env.home, 'agents', 'main', 'agent', 'auth-profiles.json'), 'not-json {{{', 'utf-8')

    // P2.2: a malformed file reads as zero usable providers via
    // credentialStatus — same warn contract, provider-absence message.
    const result = await llmComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('No LLM provider')
  })

  it('warns when the seeded channel config is removed', async () => {
    const { env } = await openHarness()
    const config = readRuntimeConfig(env.home)
    delete config.channels
    writeRuntimeConfig(env.home, config)

    const result = await channelsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('No messaging channel')
  })
})
