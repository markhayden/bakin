/**
 * Teeth proof: the conformance suite must FAIL a non-conforming adapter.
 * One intentionally-broken adapter violates the messaging/stream pins (no
 * sessionId, double-done + trailing chunk, untyped errors, abort resolving
 * instead of rejecting, toolCalling-access mismatch), and PER-LIE broken
 * adapters cover each capability/behavior branch separately (delivery
 * 'native' without channels, a lying-but-non-empty sessions stub, a lying
 * ping, a text-tapping onActivity, non-idempotent provisioning) — an
 * all-in-one liar would trip the FIRST branch and leave the rest unproven.
 * The checks are invoked directly (they throw on violation) — same functions
 * the describe/it wrapper runs, so a check that goes toothless fails here.
 */
import { describe, it, expect, mock, afterAll } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-runtime-conf-teeth-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { ChatChunk, MessageArgs } from '../../../packages/core/src/adapters/runtime'
import { createMockRuntimeAdapter, mockCron } from '../../../packages/core/src/adapters/runtime/testing'
import { runtimeConformanceChecks, type RuntimeConformanceTarget } from './conformance'

/** Every violation in one adapter: the anti-conformance fixture. */
function createBrokenAdapter() {
  const base = createMockRuntimeAdapter()
  const broken = {
    ...base,
    messaging: {
      // No metadata at all — violates the threaded-sessionId pin.
      send: async () => ({ id: 'broken-1' }),
      // Tool turns yield an UNCLASSIFIED chunk type (classified-chunks pin);
      // plain turns yield double-done + a trailing chunk (done-exactly-once
      // pin). Split per content so each violation fires on ITS OWN branch —
      // plain-turn streams are classified-checked too, so a shared garbage
      // chunk would mask the done-count violation.
      stream: async function* (args: MessageArgs): AsyncIterable<ChatChunk> {
        if (args.content.includes('[[tool]]')) {
          yield { type: 'garbage', content: 'not a chunk type' } as unknown as ChatChunk
          yield { type: 'done' }
          return
        }
        yield { type: 'text', content: 'broken' }
        yield { type: 'done' }
        yield { type: 'done' }
        yield { type: 'text', content: 'after done' }
      },
    },
    agents: {
      ...base.agents,
      // Mutating a missing agent throws a PLAIN Error — violates the typed
      // not_found CRUD pin.
      update: async (agentId: string) => { throw new Error(`no such agent ${agentId}`) },
    },
    // Capability LIE (this fixture's branch): a toolCalling access that
    // disagrees with describeToolAccess(). The other honesty branches get
    // their own per-lie adapters below.
    capabilities: async () => ({
      ...(await base.capabilities()),
      toolCalling: { mode: 'native' as const, access: { style: 'in-process' as const } },
    }),
  }
  return broken
}

function brokenTarget(): RuntimeConformanceTarget {
  const runtime = createBrokenAdapter()
  return {
    runtime,
    agentId: 'main',
    newThreadId: () => `teeth:${randomUUID()}`,
    // Rejects with a PLAIN Error — violates the typed-taxonomy pin.
    failingSend: () => Promise.reject(new Error('untyped explosion')),
    // Abort "settles" by RESOLVING — violates the aborted-kind pin.
    startAbortableTurn: () => ({ settled: Promise.resolve({ id: 'broken-2' }) }),
    prepareToolTurn: () => 'teeth: [[tool]]',
    // "Failing" stream that THROWS mid-iteration — violates the
    // iterator-never-throws pin.
    failingStream: async function* (): AsyncIterable<ChatChunk> {
      yield { type: 'text', content: 'about to explode' }
      throw new Error('iterator explosion')
    },
  }
}

/** A target whose messaging recipes are never exercised — for member/shape pins only. */
function quietTarget(runtime: RuntimeConformanceTarget['runtime']): RuntimeConformanceTarget {
  return {
    runtime,
    agentId: 'main',
    newThreadId: () => `teeth-quiet:${randomUUID()}`,
    failingSend: () => Promise.reject(new Error('unused')),
    startAbortableTurn: () => ({ settled: Promise.resolve({ id: 'unused' }) }),
    prepareToolTurn: () => 'teeth-quiet: [[tool]]',
    failingStream: async function* (): AsyncIterable<ChatChunk> {
      yield { type: 'text', content: 'unused' }
    },
  }
}

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('conformance suite teeth (broken adapter must fail every check)', () => {
  it('fails the contextStats sanity check when a reading exceeds the window (the 109% class)', async () => {
    const base = createMockRuntimeAdapter()
    const lying = {
      ...base,
      sessions: {
        ...base.sessions,
        // The billing-aggregate lie: tokens over the window, and a
        // never-used thread that "reads" instead of returning null.
        contextStats: async () => ({
          tokens: 296_551,
          contextWindow: 272_000,
          compactionThreshold: null,
        }),
      },
    }
    const target: RuntimeConformanceTarget = {
      runtime: lying,
      agentId: 'main',
      newThreadId: () => `teeth-ctx:${randomUUID()}`,
      failingSend: () => Promise.reject(new Error('unused')),
      startAbortableTurn: () => ({ settled: Promise.resolve({ id: 'unused' }) }),
      prepareToolTurn: () => 'teeth-ctx: [[tool]]',
      failingStream: async function* (): AsyncIterable<ChatChunk> {
        yield { type: 'text', content: 'unused' }
      },
    }
    await expect(
      runtimeConformanceChecks.contextStatsReportsSaneValues(target, { contextStats: 'present' }),
    ).rejects.toThrow(/exceeds contextWindow/)
    // And a throwing-stub "absence" must fail the declaration check.
    await expect(
      runtimeConformanceChecks.contextStatsMemberMatchesDeclaration(target, { contextStats: 'absent' }),
    ).rejects.toThrow(/member omission/)
  })

  it('fails the credentials declaration check on a throwing stub, and the status-only check on a leaked field', async () => {
    const base = createMockRuntimeAdapter()
    // A throwing stub is NOT absence — the member exists.
    const stubbed = {
      ...base,
      credentials: { providers: async () => { throw new Error('unsupported') } },
    }
    await expect(
      runtimeConformanceChecks.credentialsMemberMatchesDeclaration(quietTarget(stubbed), { credentials: 'absent' }),
    ).rejects.toThrow(/member omission/)
    // Declared present but omitted.
    await expect(
      runtimeConformanceChecks.credentialsMemberMatchesDeclaration(quietTarget(base), { credentials: 'present' }),
    ).rejects.toThrow(/omits the member/)
    // A secret riding on an entry — however it is spelled — fails the status-only pin.
    const leaking = {
      ...base,
      credentials: {
        providers: async () => ({
          providers: [{ providerId: 'openai', configured: true, apiKey: 'sk-live-should-never-cross' }],
          evidence: 'complete' as const,
        }),
      },
    }
    await expect(runtimeConformanceChecks.credentialInventoryIsStatusOnly(quietTarget(leaking)))
      .rejects.toThrow(/undeclared field 'apiKey'/)
    // Dishonest evidence.
    const vague = {
      ...base,
      credentials: { providers: async () => ({ providers: [], evidence: 'probably' as unknown as 'complete' }) },
    }
    await expect(runtimeConformanceChecks.credentialInventoryIsStatusOnly(quietTarget(vague)))
      .rejects.toThrow(/evidence must be/)
  })

  it('fails the models.resolveId declaration check on a throwing stub, and the honesty check on a guessing resolver', async () => {
    const base = createMockRuntimeAdapter()
    const stubbed = { ...base, models: { ...base.models, resolveId: async () => { throw new Error('unsupported') } } }
    await expect(
      runtimeConformanceChecks.resolveIdMemberMatchesDeclaration(quietTarget(stubbed), { resolveId: 'absent' }),
    ).rejects.toThrow(/member omission/)
    await expect(
      runtimeConformanceChecks.resolveIdMemberMatchesDeclaration(quietTarget(base), { resolveId: 'present' }),
    ).rejects.toThrow(/omits the member/)
    // A resolver that maps EVERYTHING onto the first catalog row would let a dead selection pass as live.
    const guessing = { ...base, models: { ...base.models, resolveId: async () => 'mock/conformance-model' } }
    await expect(runtimeConformanceChecks.resolveIdIsHonest(quietTarget(guessing)))
      .rejects.toThrow(/must be null for a reference no turn could run/)
    // A resolver that rewrites a listed id is not the runtime's catalog.
    const rewriting = { ...base, models: { ...base.models, resolveId: async () => null } }
    await expect(runtimeConformanceChecks.resolveIdIsHonest(quietTarget(rewriting)))
      .rejects.toThrow(/must return the listed id verbatim/)
  })

  it('fails the restartAdvice declaration check on a throwing stub, and the shape check on malformed advice', async () => {
    const base = createMockRuntimeAdapter()
    const stubbed = { ...base, restartAdvice: () => { throw new Error('unsupported') } }
    await expect(
      runtimeConformanceChecks.restartAdviceMemberMatchesDeclaration(quietTarget(stubbed), { restartAdvice: 'absent' }),
    ).rejects.toThrow(/member omission/)
    await expect(
      runtimeConformanceChecks.restartAdviceMemberMatchesDeclaration(quietTarget(base), { restartAdvice: 'present' }),
    ).rejects.toThrow(/omits the member/)
    const malformed = {
      ...base,
      restartAdvice: () => ({ needed: 'yes' as unknown as boolean, action: { label: 'Restart', kind: 'reboot' as unknown as 'restart-runtime' } }),
    }
    await expect(runtimeConformanceChecks.restartAdviceIsWellFormed(quietTarget(malformed)))
      .rejects.toThrow(/needed must be a boolean/)
  })

  it('fails the threaded-sessionId check', async () => {
    await expect(runtimeConformanceChecks.threadedSendReturnsSessionId(brokenTarget()))
      .rejects.toThrow(/conformance violation: threaded send returned no metadata.sessionId/)
  })

  it('fails the abort-kind check', async () => {
    await expect(runtimeConformanceChecks.abortSettlesAsAbortedKind(brokenTarget()))
      .rejects.toThrow(/conformance violation: aborted turn resolved/)
  })

  it('fails the typed-errors check', async () => {
    await expect(runtimeConformanceChecks.failuresAreTypedRuntimeErrors(brokenTarget()))
      .rejects.toThrow(/conformance violation: messaging rejection is not a RuntimeError/)
  })

  it('fails the stream done-exactly-once check', async () => {
    await expect(runtimeConformanceChecks.streamDoneExactlyOnceAndLast(brokenTarget()))
      .rejects.toThrow(/conformance violation: stream yielded 2 done chunks/)
  })

  it('fails the classified-chunks check on an unclassified chunk type', async () => {
    await expect(runtimeConformanceChecks.toolTurnStreamsClassifiedStructuredChunks(brokenTarget()))
      .rejects.toThrow(/conformance violation: stream yielded unclassified chunk type 'garbage'/)
  })

  it('fails the terminal-failure check when the iterator throws', async () => {
    await expect(runtimeConformanceChecks.streamTerminalFailureIsTypedErrorChunk(brokenTarget()))
      .rejects.toThrow(/conformance violation: failing stream THREW/)
  })

  it('fails the capability-honesty check on a toolCalling-access mismatch', async () => {
    await expect(runtimeConformanceChecks.capabilitiesAreHonest(brokenTarget()))
      .rejects.toThrow(/conformance violation: capabilities\(\)\.toolCalling\.access .* disagrees with describeToolAccess\(\)/)
  })

  it('fails the unknown-agent not_found check on a plain-Error mutation', async () => {
    await expect(runtimeConformanceChecks.unknownAgentCrudIsTypedNotFound(brokenTarget()))
      .rejects.toThrow(/conformance violation: messaging rejection is not a RuntimeError/)
  })

  // ── Per-lie capability/behavior teeth: one broken adapter per branch, so
  // every honesty branch is individually proven fail-able (an all-in-one
  // liar trips the first branch and stops there). ──────────────────────────

  it("fails capability honesty when delivery is 'native' without a channels surface", async () => {
    const runtime = createMockRuntimeAdapter({
      // Lie: delivery native — but the minimal default mock has NO channels.
      capabilities: async () => ({
        ...(await createMockRuntimeAdapter().capabilities()),
        delivery: { mode: 'native' as const },
      }),
    })
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.capabilitiesAreHonest(target))
      .rejects.toThrow(/conformance violation: capabilities\(\) declares delivery 'native' but the channels surface is absent/)
  })

  it("fails capability honesty when delivery is 'shimmed' without a channels surface", async () => {
    const runtime = createMockRuntimeAdapter({
      // Lie: delivery shimmed (bridge-configured claim) — but no channels.
      capabilities: async () => ({
        ...(await createMockRuntimeAdapter().capabilities()),
        delivery: { mode: 'shimmed' as const },
      }),
    })
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.capabilitiesAreHonest(target))
      .rejects.toThrow(/conformance violation: capabilities\(\) declares delivery 'shimmed' but the channels surface is absent/)
  })

  it('fails capability honesty on a lying-but-non-empty sessions stub', async () => {
    const runtime = createMockRuntimeAdapter()
    // Lie: list returns SOMETHING, but never the session the turn created —
    // the exact pre-T28 stub class the pin exists to ban.
    runtime.sessions.list = async (agentId?: string) => [
      { id: 'stub-session', agentId: agentId ?? 'main' },
    ]
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.capabilitiesAreHonest(target))
      .rejects.toThrow(/conformance violation: .*sessions\.list is missing the session a completed threaded turn just created/)
  })

  it("fails isolation honesty when 'isolated' is declared but runWorkspace is ignored", async () => {
    // Lie: declares isolated, but the underlying send never touches the
    // handed directory — the probe finds no trace.
    const runtime = createMockRuntimeAdapter({
      capabilities: async () => ({
        ...(await createMockRuntimeAdapter().capabilities()),
        concurrency: { sameAgentTurns: 'isolated' as const },
      }),
    })
    const target = {
      ...honestTargetShell(runtime),
      prepareIsolatedTurnProbe: () => ({
        content: 'teeth: isolation probe',
        verify: () => false,
      }),
    }
    await expect(runtimeConformanceChecks.sameAgentIsolationHonesty(target))
      .rejects.toThrow(/left no trace in concurrent turn A's handed runWorkspace/)
  })

  it("fails isolation honesty when 'isolated' is declared with no probe at all", async () => {
    const runtime = createMockRuntimeAdapter({
      capabilities: async () => ({
        ...(await createMockRuntimeAdapter().capabilities()),
        concurrency: { sameAgentTurns: 'isolated' as const },
      }),
    })
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.sameAgentIsolationHonesty(target))
      .rejects.toThrow(/provides no isolation probe — isolation claims must be provable/)
  })

  it('fails usage parity when send reports usage but the stream done omits it', async () => {
    const runtime = createMockRuntimeAdapter()
    // Lie: send() bills tokens…
    const realSend = runtime.messaging.send.bind(runtime.messaging)
    runtime.messaging.send = async (args) => ({
      ...(await realSend(args)),
      usage: { input: 10, output: 5, total: 15 },
    })
    // …but the stream's done chunk carries none (Pi's pre-fix behavior).
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.streamDoneCarriesUsageWhereSendDoes(target))
      .rejects.toThrow(/conformance violation: send\(\) reports usage but the stream done chunk carries none/)
  })

  it('fails thinking honesty when a declared level fails turns', async () => {
    const runtime = createMockRuntimeAdapter()
    // Lie: declares 'max' but a turn at that level blows up (a declared-but-
    // broken level — the exact class the pin exists to ban).
    const realSend = runtime.messaging.send.bind(runtime.messaging)
    runtime.messaging.send = async (args) => {
      if (args.thinking === 'max') throw new Error('unsupported thinking level')
      return realSend(args)
    }
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.thinkingLevelHonesty(target))
      .rejects.toThrow(/conformance violation: declared thinking level 'max' failed a turn/)
  })

  it('fails per-turn model honesty when a declared-true runtime rejects overrides (#880)', async () => {
    const runtime = createMockRuntimeAdapter()
    // Lie: perTurnModel stays true (the mock default) but any turn carrying
    // a model is refused — the OpenClaw 2026.9.5 operator.admin class.
    const realSend = runtime.messaging.send.bind(runtime.messaging)
    runtime.messaging.send = async (args) => {
      if (args.model) throw new Error('provider/model overrides are not authorized for this caller.')
      return realSend(args)
    }
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.perTurnModelHonesty(target))
      .rejects.toThrow(/conformance violation: declared perTurnModel=true but a turn carrying model/)
  })

  it('skips per-turn model honesty for an HONEST perTurnModel=false runtime (#880)', async () => {
    const runtime = createMockRuntimeAdapter()
    const support = runtime.models.routingSupport()
    runtime.models.routingSupport = () => ({ ...support, perTurnModel: false })
    // Sends carrying a model would fail — but the check must never send one.
    runtime.messaging.send = async (args) => {
      if (args.model) throw new Error('should not have sent a model override')
      return { id: 'ok', content: 'ok' }
    }
    const target = { ...honestTargetShell(runtime) }
    await runtimeConformanceChecks.perTurnModelHonesty(target) // resolves = skip-with-reason
  })

  it('fails the ping check when an unserveable runtime reports true', async () => {
    const runtime = createMockRuntimeAdapter()
    const target = {
      ...honestTargetShell(runtime),
      // Lie: "unserveable" instance whose ping still says true.
      makeUnserveableRuntime: () => ({ ping: async () => true }),
    }
    await expect(runtimeConformanceChecks.pingReflectsServeability(target))
      .rejects.toThrow(/conformance violation: ping\(\) returned true on an unserveable runtime/)
  })

  it('fails the tap check when onActivity receives text chunks', async () => {
    const runtime = createMockRuntimeAdapter()
    const send = runtime.messaging.send.bind(runtime.messaging)
    runtime.messaging = {
      ...runtime.messaging,
      // Lie: taps a TEXT chunk (text rides messaging.stream, never the tap).
      send: async (args) => {
        args.onActivity?.({ type: 'tool', data: { phase: 'call', toolName: 'mock_tool', callId: 'c1', status: 'running' } })
        args.onActivity?.({ type: 'text', content: 'leaked prose' })
        return send({ ...args, onActivity: undefined })
      },
    }
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.onActivityTapsToolAndStatusOnly(target))
      .rejects.toThrow(/conformance violation: onActivity tapped a 'text' chunk/)
  })

  it('fails the recursive-enumeration check on a top-level-only listing', async () => {
    const runtime = createMockRuntimeAdapter()
    const list = runtime.agents.listWorkspaceFiles.bind(runtime.agents)
    // Lie: only top-level files are enumerated (the pre-D5 OpenClaw shape).
    runtime.agents = {
      ...runtime.agents,
      listWorkspaceFiles: async (agentId: string) => (await list(agentId)).filter((p) => !p.includes('/')),
    }
    const target = { ...honestTargetShell(runtime) }
    await expect(runtimeConformanceChecks.workspaceFileEnumerationIsRecursive(target))
      .rejects.toThrow(/conformance violation: listWorkspaceFiles omitted nested/)
  })

  it('fails the write-free-initialize check when initialize writes into the home', async () => {
    const runtime = createMockRuntimeAdapter()
    const freshHome = join(tmpdir(), `bakin-teeth-init-${randomUUID()}`)
    const target = {
      ...honestTargetShell(runtime),
      makeFreshInitScenario: () => ({
        homeDir: freshHome,
        // Lie: initialization seeds state into the home (a write).
        initialize: async () => {
          mkdirSync(freshHome, { recursive: true })
          writeFileSync(join(freshHome, 'seeded.json'), '{"agents":["main"]}')
        },
        cleanup: () => rmSync(freshHome, { recursive: true, force: true }),
      }),
    }
    await expect(runtimeConformanceChecks.initializeIsWriteFree(target))
      .rejects.toThrow(/conformance violation: initialize\(\) wrote to the adapter home/)
  })

  it('fails the cron-declaration check when a declared-absent adapter exposes the member', async () => {
    const lying = { ...createMockRuntimeAdapter(), cron: mockCron() }
    await expect(runtimeConformanceChecks.cronMemberMatchesDeclaration({ ...brokenTarget(), runtime: lying }, { cron: 'absent' }))
      .rejects.toThrow(/conformance violation: cron declared absent/)
  })

  it('fails the cron-declaration check when a declared-present adapter omits the member', async () => {
    await expect(runtimeConformanceChecks.cronMemberMatchesDeclaration({ ...brokenTarget(), runtime: createMockRuntimeAdapter() }, { cron: 'present' }))
      .rejects.toThrow(/conformance violation: cron declared present/)
  })

  it('fails the cron round-trip on a stateless lie (created job missing from list)', async () => {
    const statelessCron = { ...mockCron(), list: async () => [] }
    const runtime = { ...createMockRuntimeAdapter(), cron: statelessCron }
    await expect(runtimeConformanceChecks.cronCrudRoundTrip({ ...brokenTarget(), runtime }))
      .rejects.toThrow(/conformance violation: created cron job is missing from cron\.list\(\)/)
  })

  it('fails the cron round-trip when get of a missing job throws instead of returning null', async () => {
    const throwingCron = { ...mockCron(), get: async (id: string) => { throw new Error(`boom ${id}`) } }
    const runtime = { ...createMockRuntimeAdapter(), cron: throwingCron }
    await expect(runtimeConformanceChecks.cronCrudRoundTrip({ ...brokenTarget(), runtime }))
      .rejects.toThrow()
  })

  it('fails the cron round-trip when update of a missing job resolves a fabricated row', async () => {
    const base = mockCron()
    const fabricatingCron = {
      ...base,
      update: async (id: string, patch: { schedule?: string }) => {
        const existing = await base.get(id)
        if (existing) return base.update(id, patch)
        return { id, name: id, schedule: patch.schedule ?? '* * * * *', command: '', enabled: true }
      },
    }
    const runtime = { ...createMockRuntimeAdapter(), cron: fabricatingCron }
    await expect(runtimeConformanceChecks.cronCrudRoundTrip({ ...brokenTarget(), runtime }))
      .rejects.toThrow(/conformance violation: cron\.update of a missing job resolved/)
  })

  it('fails the provisioning check when a second provision changes durable state', async () => {
    const runtime = createMockRuntimeAdapter()
    let provisionCount = 0
    runtime.provisionToolAccess = async () => {
      provisionCount += 1
    }
    const target = {
      ...honestTargetShell(runtime),
      // Lie: every provision run mutates observable durable state.
      observeProvisionedState: () => provisionCount,
    }
    await expect(runtimeConformanceChecks.provisionToolAccessIsIdempotent(target))
      .rejects.toThrow(/conformance violation: a second provisionToolAccess changed durable state/)
  })
})

/** A conforming target shell around `runtime` — per-lie cases break ONE thing. */
function honestTargetShell(runtime: ReturnType<typeof createMockRuntimeAdapter>): RuntimeConformanceTarget {
  return {
    runtime,
    agentId: 'main',
    newThreadId: () => `teeth:${randomUUID()}`,
    failingSend: () => runtime.messaging.send({ agentId: 'main', content: 'teeth [[fail]]' }),
    expectedFailingKind: 'runtime_failed',
    startAbortableTurn: () => {
      const controller = new AbortController()
      const settled = runtime.messaging.send({ agentId: 'main', content: 'abort me', signal: controller.signal })
      controller.abort('teeth')
      return { settled }
    },
    prepareToolTurn: () => 'teeth: [[tool]]',
    failingStream: () => runtime.messaging.stream({ agentId: 'main', content: 'teeth [[fail]]' }),
  }
}
