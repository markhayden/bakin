/**
 * bakin_exec_team_message duplicate-worker guard.
 *
 * Live-test incident (task d1b213a5): main created+dispatched a task, then
 * team-messaged the assignee about it — the unthreaded message landed in the
 * agent's main session, which did the whole job a second time (two billed
 * generates). The guard hard-refuses a message that references a task the
 * TARGET agent is already running, and audits the block.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-team-msg-guard-${Date.now()}`)

// ES imports are hoisted above mock.module — set env so home guards do not trip.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ db: join(testDir, 'bakin.db') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../../src/core/mcporter', () => ({
  syncConfig: mock(() => []),
}))

// In-memory ledger fake — tests control which task has a live run, and can
// simulate ledger unavailability (the guard must fail CLOSED).
class FakeLedgerUnavailableError extends Error {}
const liveRuns = new Map<string, { runId: string; agent: string; startedAt: number }>()
let ledgerDown = false
mock.module('../../../src/core/execution-ledger', () => ({
  LedgerUnavailableError: FakeLedgerUnavailableError,
  listRunsByAgent: () => [],
  getLiveRun: (taskId: string) => {
    if (ledgerDown) throw new FakeLedgerUnavailableError('ledger op failed: getLiveRun')
    const run = liveRuns.get(taskId)
    return run ? { runId: run.runId, taskId, agent: run.agent, startedAt: run.startedAt, status: 'running' } : null
  },
}))

const sendMessageToAgent = mock(async () => ({ ok: true, reply: 'delivered' }))
mock.module('../../../src/core/agents', () => ({ sendMessageToAgent }))

const audits: Array<{ event: string; agent: string; data: Record<string, unknown> }> = []
mock.module('../../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, agent: string, data: Record<string, unknown>) => {
    audits.push({ event, agent, data })
  },
  queryAuditEvents: () => [],
}))

import { activatePlugin, findTool, callTool } from '../test-helpers'
const teamPlugin = (await import('../../../plugins/team/index')).default as typeof import('../../../plugins/team/index').default
import type { ActivatedPlugin } from '../test-helpers'

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(join(testDir, 'plugin-settings'), { recursive: true })
  writeFileSync(join(testDir, 'plugin-settings', 'team.json'), JSON.stringify({ displaySettings: {}, teams: [] }))
  activated = await activatePlugin(teamPlugin, testDir)
})

beforeEach(() => {
  liveRuns.clear()
  ledgerDown = false
  audits.length = 0
  sendMessageToAgent.mockClear()
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('bakin_exec_team_message duplicate-worker guard', () => {
  const tool = () => findTool(activated.execTools, 'bakin_exec_team_message')!

  it('refuses a message referencing a task the target agent is already running, and audits', async () => {
    liveRuns.set('d1b213a5', { runId: 'task:d1b213a5:d1', agent: 'pixel', startedAt: Date.now() - 40_000 })

    const result = await callTool(tool(), {
      agentId: 'pixel',
      message: 'Task d1b213a5 is assigned to you: create the cat image and report back.',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/already working task d1b213a5/i)
    expect(result.error).toMatch(/duplicate worker/i)
    expect(sendMessageToAgent).not.toHaveBeenCalled()
    expect(audits).toContainEqual(expect.objectContaining({
      event: 'team.message_blocked',
      data: expect.objectContaining({ agentId: 'pixel', taskId: 'd1b213a5', runId: 'task:d1b213a5:d1' }),
    }))
  })

  it('delivers when the referenced live run belongs to a different agent', async () => {
    liveRuns.set('d1b213a5', { runId: 'task:d1b213a5:d1', agent: 'pixel', startedAt: Date.now() })

    const result = await callTool(tool(), {
      agentId: 'rolo',
      message: 'FYI pixel is on d1b213a5 — please prep the video for after.',
    })

    expect(result.ok).toBe(true)
    expect(sendMessageToAgent).toHaveBeenCalledTimes(1)
    expect(audits).toHaveLength(0)
  })

  it('delivers when the referenced task has no live run (settled/unknown)', async () => {
    const result = await callTool(tool(), {
      agentId: 'pixel',
      message: 'Nice work on d1b213a5 — the client loved it.',
    })

    expect(result.ok).toBe(true)
    expect(sendMessageToAgent).toHaveBeenCalledTimes(1)
  })

  it('delivers a message with no task-shaped tokens untouched', async () => {
    const result = await callTool(tool(), {
      agentId: 'pixel',
      message: 'Quick check-in: how is the style guide shaping up?',
    })

    expect(result.ok).toBe(true)
    expect(sendMessageToAgent).toHaveBeenCalledTimes(1)
  })

  it('fails CLOSED with a structured refusal when the ledger is unavailable', async () => {
    ledgerDown = true

    const result = await callTool(tool(), {
      agentId: 'pixel',
      message: 'Heads up on d1b213a5 — please double-check the output.',
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cannot verify/i)
    expect(result.error).toMatch(/duplicate worker/i)
    expect(sendMessageToAgent).not.toHaveBeenCalled()
  })

  it('still delivers token-free messages while the ledger is unavailable', async () => {
    ledgerDown = true

    const result = await callTool(tool(), {
      agentId: 'pixel',
      message: 'No task talk here, just saying hi.',
    })

    expect(result.ok).toBe(true)
    expect(sendMessageToAgent).toHaveBeenCalledTimes(1)
  })

  it('checks every distinct token, not just the first ten', async () => {
    // 11 distinct hex tokens; the live-run task is the last one.
    const decoys = Array.from({ length: 10 }, (_, i) => `aaaa000${i}`)
    liveRuns.set('d1b213a5', { runId: 'task:d1b213a5:d1', agent: 'pixel', startedAt: Date.now() })

    const result = await callTool(tool(), {
      agentId: 'pixel',
      message: `Context hashes: ${decoys.join(' ')} — and please start on d1b213a5 now.`,
    })

    expect(result.ok).toBe(false)
    expect(sendMessageToAgent).not.toHaveBeenCalled()
  })
})
