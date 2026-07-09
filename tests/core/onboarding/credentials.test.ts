/**
 * Tests for the credentials onboarding component (LLM + channels).
 *
 * P2.2: the component reads through the runtime-neutral credentialStatus()
 * contract — credential-shape PARSING is adapter-owned and tested in
 * tests/adapter-openclaw/credential-status.test.ts. Here we verify:
 *   - ok/warn mapping from the reported provider/channel names
 *   - honest warn when credentialStatus throws
 *   - channels check reports ok-by-design on a channel-less runtime
 *   - install() for both subcomponents is a hard noop
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-onboarding-creds-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

let llmProviders: string[] = []
let channelNames: string[] = []
let statusThrows = false
let hasChannelLayer = true

const runtime = {
  get channels() {
    return hasChannelLayer ? { list: async () => [] } : undefined
  },
  credentialStatus: async () => {
    if (statusThrows) throw new Error('status boom')
    return { llmProviders, channels: channelNames }
  },
}

mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => ({ runtime }),
  createAppServices: async () => ({ runtime }),
}))
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => ({ runtime }),
  createAppServices: async () => ({ runtime }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { llmComponent, channelsComponent } from '../../../src/core/onboarding/credentials'

const opts = { interactive: false, autoApprove: true, json: false, checkOnly: false, force: false }

beforeEach(() => {
  llmProviders = []
  channelNames = []
  statusThrows = false
  hasChannelLayer = true
})

describe('llm.check()', () => {
  it('warns when no provider has usable credentials', async () => {
    const result = await llmComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('No LLM provider')
    expect(result.remediation).toContain('runtime adapter')
  })

  it('reports ok listing the configured providers', async () => {
    llmProviders = ['anthropic', 'openai-codex']
    const result = await llmComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('anthropic')
    expect(result.message).toContain('openai-codex')
    expect(result.details?.providers).toEqual(['anthropic', 'openai-codex'])
  })

  it('warns honestly when credentialStatus throws', async () => {
    statusThrows = true
    const result = await llmComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('Could not read')
  })
})

describe('llm.install()', () => {
  it('is a noop that returns the runtime docs URL', async () => {
    const result = await llmComponent.install(opts)
    expect(result.status).toBe('noop')
    expect(result.message).toContain('runtime adapter')
  })
})

describe('channels.check()', () => {
  it('warns when no channel has usable credentials', async () => {
    const result = await channelsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('No messaging channel')
  })

  it('reports ok listing the configured channels', async () => {
    channelNames = ['discord', 'slack']
    const result = await channelsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.details?.channels).toEqual(['discord', 'slack'])
  })

  it('reports ok-by-design on a runtime without a channel layer (P2.1)', async () => {
    hasChannelLayer = false
    const result = await channelsComponent.check()
    expect(result.status).toBe('ok')
    expect(result.message).toContain('no channel layer')
  })

  it('warns honestly when credentialStatus throws', async () => {
    statusThrows = true
    const result = await channelsComponent.check()
    expect(result.status).toBe('warn')
    expect(result.message).toContain('Could not read')
  })
})

describe('channels.install()', () => {
  it('is a noop that returns the runtime docs URL', async () => {
    const result = await channelsComponent.install(opts)
    expect(result.status).toBe('noop')
    expect(result.message).toContain('runtime adapter')
  })
})
