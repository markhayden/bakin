/**
 * Read-only CLI TTY commands — runtime/agent commands and agent-package
 * commands: dispatch/send confirmations, rosters, agent detail and task
 * lists, package lists and actions. Split from readonly-commands.test.ts (B7).
 */
import { describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupTtyCliHarness } from './helpers/tty-cli-harness'

// These flows are HTTP-only (fetch is mocked), but the isolation mocks are
// mandatory insurance: nothing this test transitively imports may ever
// resolve the real ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-readonly-agents-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const harness = setupTtyCliHarness({ defaultFetchJson: { ok: true } })
const { fetchMock, output, setStdoutIsTTY, jsonResponse } = harness

describe('read-only CLI TTY commands — agents and packages', () => {
  it('renders runtime action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, ts: '2026-05-18T09:00:00.000Z' }))
    process.argv = ['bun', 'cli/bakin.ts', 'dispatch']
    await main()
    expect(output()).toContain('Runtime action')
    expect(output()).toContain('Triggered immediate task dispatch.')
    expect(output()).toContain('RESULT')
    expect(output()).not.toContain('"ok": true')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, reply: 'Message accepted' }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'send', 'patch', 'Check the build']
    await main()
    expect(output()).toContain('Runtime action')
    expect(output()).toContain('Sent message to patch.')
    expect(output()).toContain('Message accepted')
    expect(output()).not.toContain('"reply"')
  })

  it('renders the agent roster with the shared TUI screen', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      agents: [
        { id: 'main', name: 'Main Agent', status: 'online', model: 'gpt-5.5' },
        { id: 'patch', name: 'Patch', status: 'working', model: 'gpt-5.5' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list']
    await main()
    expect(output()).toContain('Agents')
    expect(output()).toContain('MODEL')
    expect(output()).toContain('Main Agent')
    expect(output()).not.toContain('○ main:')
  })

  it('renders agent status detail with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'patch',
      name: 'Patch',
      role: 'Engineer',
      model: 'gpt-5.5',
      workspacePath: '/tmp/patch',
      soul: '# Patch Soul\n',
      identity: '# Identity\n',
      rules: '',
      tools: null,
      heartbeatMd: '# Heartbeat\nWorking on docs',
      subagentPerms: ['docs'],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'status', 'patch']
    await main()
    expect(output()).toContain('Agent Status')
    expect(output()).toContain('agent: patch')
    expect(output()).toContain('PROFILE')
    expect(output()).toContain('Patch')
    expect(output()).toContain('WORKSPACE')
    expect(output()).not.toContain('"workspacePath"')
  })

  it('honors --json for taxonomy list commands even in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      agents: [
        { id: 'pixel', name: 'Pixel', status: 'online', model: 'openai-codex/gpt-5.5' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list', '--json']
    await main()
    expect(output()).toContain('"agents": [')
    expect(output()).toContain('"id": "pixel"')
    expect(output()).not.toContain('ROSTER')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      plugins: [
        { id: 'tasks', name: 'Tasks', version: '2.1.0', source: 'core', status: 'active' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'plugins', 'list', '--check', '--json']
    await main()
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/plugins/manifest?check=1')
    expect(output()).toContain('"plugins": [')
    expect(output()).toContain('"id": "tasks"')
    expect(output()).not.toContain('Installed plugins')
    expect(output()).not.toContain('SOURCE')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      packages: [
        { id: 'shared-skills', kind: 'skill-pack', version: '1.0.0', refCount: 0, dependents: [] },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'list', '--json']
    await main()
    expect(output()).toContain('"packages": [')
    expect(output()).toContain('"id": "shared-skills"')
    expect(output()).not.toContain('INSTALLED PACKAGES')
  })

  it('renders package-oriented list commands with shared TUI screens in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      agents: [
        { agentId: 'patch', state: 'managed', packageId: 'bakin.patch', version: '1.2.0' },
        { agentId: 'docs', state: 'managed', packageId: 'bakin.docs', entry: { version: '1.1.0' } },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list', '--packages']
    await main()
    expect(output()).toContain('Agent Packages')
    expect(output()).toContain('VERSION')
    expect(output()).toContain('PACKAGE')
    expect(output()).toContain('bakin.patch')
    expect(output()).toContain('1.2.0')
    expect(output()).toContain('1.1.0')
    expect(output()).not.toContain('Agents (package state):')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      packageId: 'bakin.patch',
      lessons: [
        { lessonId: 'handoff', title: 'Handoff Notes', tags: ['workflow'], enabled: true },
        { lessonId: 'release', title: 'Release Notes', tags: [], enabled: false },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'lessons', 'list', 'patch']
    await main()
    expect(output()).toContain('Agent Lessons')
    expect(output()).toContain('LESSON')
    expect(output()).toContain('handoff')
    expect(output()).not.toContain('Lessons for patch')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      packages: [
        { id: 'bakin.patch', kind: 'agent', version: '1.0.0', refCount: 2, dependents: ['patch', 'docs'] },
        { id: 'lessons', kind: 'lesson-pack', version: '1.0.0', refCount: 0, dependents: [] },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'list']
    await main()
    expect(output()).toContain('Packages')
    expect(output()).toContain('DEPENDENTS')
    expect(output()).toContain('lessons')
    expect(output()).not.toContain('bakin.patch')
    expect(output()).not.toContain('Installed packages:')
  })

  it('prints agent package versions in plain output outside a TTY', async () => {
    setStdoutIsTTY(false)
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      agents: [
        { agentId: 'patch', state: 'managed', packageId: 'bakin.patch', version: '1.2.0' },
        { agentId: 'docs', state: 'managed', packageId: 'bakin.docs', entry: { version: '1.1.0' } },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'list', '--packages']

    await main()

    expect(output()).toContain('Agents (package state):')
    expect(output()).toContain('patch')
    expect(output()).toContain('1.2.0')
    expect(output()).toContain('docs')
    expect(output()).toContain('1.1.0')
  })

  it('renders package action confirmations with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.patch',
        kind: 'agent',
        createdAgent: true,
        adopted: false,
        dependencies: [],
        skipped: [],
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'install', 'github:markhayden/bakin-patch']
    await main()
    expect(output()).toContain('Package action')
    expect(output()).toContain('Installed agent package bakin.patch.')
    expect(output()).toContain('Created runtime agent.')
    expect(output()).not.toContain('"packageId"')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.patch',
        lessonId: 'style',
        enabled: false,
        changed: true,
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'lessons', 'disable', 'patch', 'style']
    await main()
    expect(output()).toContain('Package action')
    expect(output()).toContain('Disabled lesson style for patch.')
    expect(output()).not.toContain('"enabled": false')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      result: {
        packageId: 'bakin.patch',
        lessonId: 'style',
        enabled: true,
        changed: true,
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'lessons', 'enable', 'patch', 'style', '--json']
    await main()
    expect(output()).toContain('"enabled": true')
    expect(output()).not.toContain('Package action')

    harness.log.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      receipt: {
        agentId: 'bakin.workflow',
        state: 'managed',
        checkOnly: false,
        package: { id: 'bakin.workflow', versionBefore: '1.0.0', versionAfter: '1.1.0', commitBefore: 'a', commitAfter: 'b', fetched: true, changed: true },
        blocks: [],
        projections: [],
        skipped: [],
        verification: { status: 'ok', findings: [] },
      },
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'packages', 'sync', 'bakin.workflow']
    await main()
    expect(output()).toContain('Package action')
    expect(output()).toContain('Synced package bakin.workflow — verification ok.')
    expect(output()).toContain('1.0.0 -> 1.1.0')
    expect(output()).not.toContain('"versionBefore"')
  })

  it('renders agent task lists with the shared TUI screen in a TTY', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      tasks: [
        { id: 'task-1', title: 'Write docs', column: 'todo' },
        { id: 'task-2', title: 'Waiting on review', column: 'blocked' },
      ],
    }))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'tasks', 'patch']
    await main()

    expect(output()).toContain('Agent Tasks')
    expect(output()).toContain('agent: patch')
    expect(output()).toContain('TASKS')
    expect(output()).toContain('Write docs')
    expect(output()).not.toContain('id      title')
  })

  it('renders the combined agent doctor report in a TTY (#385)', async () => {
    const { main } = await import('../../cli/bakin')

    // cmdAgentsDoctor fires four GETs in order: scan, context, effort, timeline.
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      scannedAt: '2026-07-05T00:00:00Z',
      findings: [{ type: 'block-stale', severity: 'warn', autoFixable: true, message: 'AGENTS.md managed block is stale', file: 'AGENTS.md', staleInputs: ['in-place-edit'] }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      report: { dispatch: { estimatedMaxTaskBytes: 80_000 }, workspace: { available: true, totalBytes: 40_960 } },
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      window: '24h',
      scannedAt: null,
      agents: [{
        agent: 'pixel', windowTokens: 2_100_000, windowCostUsdMicros: 40_000, runs: 14, completions: 0,
        tokenApplicableRuns: 14, tokenMeteredRuns: 14, tokenAggregateRepresentable: true,
        costedRuns: 14, costAggregateRepresentable: true,
        tokensPerCompletion: null, totalObservedTokens: null, unattributedTokens: null,
        flags: [{ kind: 'effort-no-outcome', message: "'pixel' used 2.1M tokens across 14 run(s) in 24h but completed no tasks — check its timeline" }],
      }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      agent: 'pixel',
      window: '24h',
      events: [{
        type: 'run', ts: 1_750_000_000_000, runId: 'task:t1:d1', taskId: 't1', taskTitle: 'resize hero images',
        seq: 1, status: 'settled', settleReason: 'turn-ok', startedAt: 1_750_000_000_000, settledAt: 1_750_000_192_000,
        durationMs: 192_000, model: 'sonnet-5', inputTokens: 41_000, outputTokens: 2_100, totalTokens: 43_100,
        costUsdMicros: 40_000, logs: [], logsTruncated: false,
      }],
    }))

    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'doctor', 'pixel']
    await main()

    expect(output()).toContain('Agent doctor — pixel')
    expect(output()).toContain('block-stale')
    expect(output()).toContain('effort-no-outcome')
    expect(output()).toContain('resize hero images')
    expect(output()).toContain('turn-ok')
  })

  it('labels partial agent-doctor token and cost evidence as unavailable', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      scannedAt: '2026-07-05T00:00:00Z',
      findings: [],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      report: { dispatch: { estimatedMaxTaskBytes: 80_000 }, workspace: { available: true, totalBytes: 40_960 } },
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      window: '24h',
      scannedAt: '2026-07-05T00:00:00Z',
      agents: [{
        agent: 'pixel',
        windowTokens: null,
        windowCostUsdMicros: null,
        runs: 2,
        tokenApplicableRuns: 2,
        tokenMeteredRuns: 1,
        tokenAggregateRepresentable: true,
        costedRuns: 0,
        costAggregateRepresentable: true,
        completions: 1,
        tokensPerCompletion: null,
        totalObservedTokens: 900_000,
        unattributedTokens: null,
        flags: [],
      }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, events: [] }))

    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'doctor', 'pixel']
    await main()

    expect(output()).toContain('Bakin tokens unavailable (1 of 2 token-bearing calls metered)')
    expect(output()).toContain('tracked cost unavailable (0 of 2 runs priced)')
    expect(output()).toContain('Burn flags unavailable because token metering is incomplete.')
    expect(output()).not.toContain('No burn flags in the window.')
    expect(output()).not.toContain('Bakin 0 tok')
  })

  it('does not present legacy agent-doctor subtotals as complete evidence', async () => {
    const { main } = await import('../../cli/bakin')

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      scannedAt: '2026-07-05T00:00:00Z',
      findings: [],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: true,
      report: { dispatch: { estimatedMaxTaskBytes: 80_000 }, workspace: { available: true, totalBytes: 40_960 } },
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      window: '24h',
      scannedAt: '2026-07-05T00:00:00Z',
      agents: [{
        agent: 'pixel',
        windowTokens: 900_000,
        windowCostUsdMicros: 40_000,
        runs: 2,
        completions: 1,
        tokensPerCompletion: 900_000,
        totalObservedTokens: 1_000_000,
        unattributedTokens: 100_000,
        flags: [],
      }],
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true, events: [] }))

    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'doctor', 'pixel']
    await main()

    expect(output()).toContain('Bakin tokens unavailable (coverage unavailable)')
    expect(output()).toContain('tracked cost unavailable (coverage unavailable)')
    expect(output()).toContain('Burn flags unavailable because token metering is incomplete.')
    expect(output()).not.toContain('Bakin 900k tok')
    expect(output()).not.toContain('tracked cost $0.0400')
    expect(output()).not.toContain('900k tok/completion')
  })

  it('agent doctor degrades per-section when endpoints fail, and --json prints raw', async () => {
    const { main } = await import('../../cli/bakin')

    // All four endpoints unreachable.
    for (let i = 0; i < 4; i++) fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'doctor', 'pixel']
    await main()
    expect(output()).toContain('Agent doctor — pixel')
    expect(output()).toContain('unavailable')

    harness.log.mockClear()
    setStdoutIsTTY(false)
    for (let i = 0; i < 4; i++) fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    process.argv = ['bun', 'cli/bakin.ts', 'agents', 'doctor', 'pixel', '--json']
    await main()
    expect(output()).toContain('"agentId": "pixel"')
    setStdoutIsTTY(true)
  })
})
