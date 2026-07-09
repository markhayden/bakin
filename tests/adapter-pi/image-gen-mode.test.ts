/**
 * Pi capabilities().imageGen (P4.1) — the honest mode ladder:
 *   codex OAuth present → 'native'
 *   only a Bakin direct-provider key → 'shimmed'
 *   neither → 'unavailable'
 */
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-pi-imagegen-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = pathJoin(testDir, 'bakin')

import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({
  getContentDir: () => pathJoin(testDir, 'bakin'),
  getBakinPaths: () => ({ home: pathJoin(testDir, 'bakin'), db: pathJoin(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

const agentDir = pathJoin(testDir, 'pi', 'agent')

/** Unsigned JWT carrying the chatgpt_account_id claim codexImageAuth demands. */
function fakeCodexJwt(): string {
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [
    b64({ alg: 'none' }),
    b64({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } }),
    'sig',
  ].join('.')
}

function seedAuth(auth: Record<string, unknown>): void {
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(pathJoin(agentDir, 'auth.json'), JSON.stringify(auth))
  writeFileSync(pathJoin(agentDir, 'models.json'), JSON.stringify({ providers: {} }))
  resetPiHome()
  resetModelRegistry()
}

const ENV_KEYS = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'] as const
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]] as const))

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  for (const key of ENV_KEYS) delete process.env[key]
})

afterAll(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(testDir, { recursive: true, force: true })
})

describe('Pi imageGen mode (P4.1)', () => {
  test("codex OAuth present → 'native'", async () => {
    seedAuth({ 'openai-codex': { type: 'oauth', access: fakeCodexJwt(), refresh: 'r' } })
    const adapter = createPiRuntimeAdapter()
    expect((await adapter.capabilities()).imageGen.mode).toBe('native')
  })

  test("no codex, Bakin openai key → 'shimmed'", async () => {
    seedAuth({})
    process.env.OPENAI_API_KEY = 'sk-shim'
    const adapter = createPiRuntimeAdapter()
    expect((await adapter.capabilities()).imageGen.mode).toBe('shimmed')
  })

  test("no codex, no keys → 'unavailable'", async () => {
    seedAuth({})
    const adapter = createPiRuntimeAdapter()
    expect((await adapter.capabilities()).imageGen.mode).toBe('unavailable')
  })
})
