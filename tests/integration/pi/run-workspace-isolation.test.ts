/**
 * Per-run workspace isolation on the REAL Pi adapter (same-agent-concurrency
 * D2/T3.1): runWorkspace moves ONLY the tool-execution cwd — project context
 * and skills stay workspace-discovered; seeded symlinks route memory writes
 * back to the workspace; rename-severed links are recovered at settle;
 * scratch stays isolated; git checkouts are never seeded. Zero LLM tokens
 * (fake provider).
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

// The Pi SDK calls global fetch; the happy-dom preload replaces it with a
// browser emulation that breaks real sockets — restore Bun's native fetch.
globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-pi-runws-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome, getAgentWorkspaceDir } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { seedRunWorkspace } from '../../../packages/adapter-pi/src/run-workspace'
import { startFakeProvider, type FakeProvider, type FakeTurnScript } from './fake-provider'

let provider: FakeProvider
const adapter = createPiRuntimeAdapter()
let threadSeq = 0
let runSeq = 0

function seedProvider(scripts: FakeTurnScript[]): FakeProvider {
  provider?.stop()
  provider = startFakeProvider(scripts)
  const agentDir = join(testDir, 'pi', 'agent')
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: {
        name: 'FakeAI',
        baseUrl: provider.url,
        api: 'openai-completions',
        models: [{
          id: 'fake-model',
          name: 'Fake Model',
          input: ['text'],
          reasoning: false,
          contextWindow: 100000,
          maxTokens: 8000,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }))
  resetModelRegistry()
  return provider
}

function newRunDir(): string {
  const dir = join(testDir, 'bakin', 'run-workspaces', 'main', `run-${++runSeq}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** One bash-tool turn: scripted toolCall, then a reply. */
function bashTurnScripts(command: string): FakeTurnScript[] {
  return [
    { when: 'initial', steps: [{ toolCall: { name: 'bash', args: { command } } }] },
    { when: 'after-tool', steps: [{ text: 'done' }], usage: { prompt: 4, completion: 2 } },
  ]
}

async function runIsolatedBashTurn(command: string, runWorkspace: string): Promise<void> {
  seedProvider(bashTurnScripts(command))
  await adapter.messaging.send({
    agentId: 'main',
    content: 'isolation test turn',
    threadId: `iso:${++threadSeq}`,
    runWorkspace,
  })
}

beforeAll(async () => {
  resetPiHome()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    fakeai: { type: 'api_key', key: 'fake-key' },
  }))
  await adapter.initialize({
    contentDir: join(testDir, 'bakin'),
    settings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
  })
  await adapter.provisionToolAccess()
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
  await adapter.agents.writeWorkspaceFile('main', { path: 'SOUL.md', content: 'You are the isolation test soul.' })
  await adapter.agents.writeWorkspaceFile('main', { path: 'AGENTS.md', content: 'AGENT-CONTEXT-MARKER-7f3a — layered context sentinel.' })
  await adapter.agents.writeWorkspaceFile('main', { path: 'MEMORY.md', content: 'memory v1' })
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi run-workspace isolation', () => {
  test('layered context (workspace AGENTS.md) reaches an isolated turn byte-for-byte', async () => {
    const runDir = newRunDir()
    await runIsolatedBashTurn('true', runDir)
    // The loader is workspace-pinned: the run-dir cwd must not cost the turn
    // its AGENTS.md context.
    const wire = JSON.stringify(provider.requests)
    expect(wire).toContain('AGENT-CONTEXT-MARKER-7f3a')
  })

  test('tool execution actually happens in the run dir; scratch never leaks to the workspace', async () => {
    const runDir = newRunDir()
    await runIsolatedBashTurn('pwd > where.txt && echo scratch > notes-scratch.md', runDir)
    // realpath both sides: macOS tmpdirs ride the /var → /private/var symlink.
    expect(realpathSync(readFileSync(join(runDir, 'where.txt'), 'utf-8').trim())).toBe(realpathSync(runDir))
    // notes-scratch.md has no workspace counterpart — stays isolated scratch.
    expect(existsSync(join(runDir, 'notes-scratch.md'))).toBe(true)
    expect(existsSync(join(getAgentWorkspaceDir('main'), 'notes-scratch.md'))).toBe(false)
  })

  test('cwd-relative memory writes flow through the seeded symlink to the workspace', async () => {
    const runDir = newRunDir()
    await runIsolatedBashTurn('echo "memory v2" > MEMORY.md', runDir)
    expect(readFileSync(join(getAgentWorkspaceDir('main'), 'MEMORY.md'), 'utf-8').trim()).toBe('memory v2')
    // The link survives an open()-style write.
    expect(lstatSync(join(runDir, 'MEMORY.md')).isSymbolicLink()).toBe(true)
  })

  test('a rename-severed memory link is recovered at settle (LWW copy-back)', async () => {
    const runDir = newRunDir()
    await runIsolatedBashTurn('printf "memory v3" > .m.tmp && mv .m.tmp MEMORY.md', runDir)
    // mv replaced the symlink with a regular file — settle recovery copies
    // the bytes back so the write is never stranded.
    expect(lstatSync(join(runDir, 'MEMORY.md')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(getAgentWorkspaceDir('main'), 'MEMORY.md'), 'utf-8')).toBe('memory v3')
  })

  test('a git-checkout runWorkspace is never seeded (bound-task boundary)', () => {
    const worktree = join(testDir, 'fake-worktree')
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere')
    seedRunWorkspace('main', worktree)
    expect(existsSync(join(worktree, 'MEMORY.md'))).toBe(false)
    expect(existsSync(join(worktree, 'AGENTS.md'))).toBe(false)
  })

  test('seeding is idempotent across reopen of the same run dir', () => {
    const runDir = newRunDir()
    seedRunWorkspace('main', runDir)
    seedRunWorkspace('main', runDir)
    expect(lstatSync(join(runDir, 'SOUL.md')).isSymbolicLink()).toBe(true)
  })
})
